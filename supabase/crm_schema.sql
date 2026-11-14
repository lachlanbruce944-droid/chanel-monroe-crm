-- ============================================================================
-- Chanel Monroe CRM — live Supabase schema (project "makeup-website")
-- Applied as migrations: crm_schema, crm_staff_self_update.
-- Kept here as the reference for the future iOS app. Re-running on the same
-- project will fail because the tables already exist.
-- ============================================================================

-- Tables (all have id uuid pk, created_at, updated_at, and extra jsonb for any
-- app field without its own column):
--   crm_staff      user_id → auth.users, name, email, role owner|assistant
--   crm_settings   id text pk, value jsonb            (profile, invoiceCounter …)
--   crm_services   name, category, price, duration_mins, active, sort
--   crm_clients    first_name, last_name, email, phone, instagram, birthday, skin_type,
--                  allergies, shades, notes, marketing_ok, source
--   crm_bookings   client_id, stage (enquiry→complete), status open|lost, lost_reason, source,
--                  website_enquiry_id → public.enquiries, event_type, event_date, ready_by,
--                  start_time, location, party_size, lines jsonb, travel_fee, discount,
--                  deposit_amount, answers jsonb, call_at, call_notes, call_logged_at, stage_changed_at
--   crm_payments   booking_id, client_id, type deposit|final|other, amount, method, paid_at, reference
--   crm_invoices   booking_id, client_id, type deposit|final, number, items jsonb, total, gst,
--                  status draft|sent|paid|void, issued_at, due_at, paid_at
--   crm_reminders  booking_id, client_id, kind, title, due_at, template_key, channel, status, closed_at
--   crm_photos     booking_id, client_id, kind inspo|before|after|day, caption, file_name,
--                  taken_at, storage_path   (files in private bucket crm-photos/<id>.jpg)
--   crm_reviews    booking_id, client_id, rating 1-5, text, source, consent_to_share, received_at
--   crm_activity   booking_id, client_id, user_id, type, text, at

-- Security model
--   * RLS on every crm_* table: only signed-in users listed in crm_staff can read/write
--     (policy "staff full access" using public.is_crm_staff()).
--   * anon has no access to any crm_* table.
--   * crm_claim_owner(): the first account to sign in becomes owner; later accounts wait.
--   * crm_add_staff(email): owner grants access to an existing account.
--   * Staff may update only their own display name in crm_staff.
--   * Bucket crm-photos is private; staff-only policies on storage.objects.

-- Website → CRM
--   Trigger enquiries_to_crm AFTER INSERT ON public.enquiries runs
--   public.crm_from_website_enquiry() (security definer):
--     1. match client by email (or create one), fill blank phone / skin / allergies
--     2. create a booking at stage 'enquiry' with the website answers in answers.website
--        (look, extras, reference photos, beauty team, estimate, travel)
--     3. log activity + a "reply today" reminder (due 9pm Brisbane time)
--   Errors are caught and logged as warnings so the website form never fails.

-- Full SQL of the trigger function (abridged copy of the migration):
create or replace function public.crm_from_website_enquiry() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_client uuid; v_booking uuid; v_first text; v_last text; v_name text;
  v_party int; v_lines jsonb := '[]'; v_due timestamptz;
begin
  begin
    v_name := btrim(coalesce(new.name, ''));
    v_first := nullif(split_part(v_name, ' ', 1), '');
    v_last := nullif(btrim(substr(v_name, length(coalesce(v_first,'')) + 1)), '');
    if coalesce(btrim(new.email), '') <> '' then
      select id into v_client from crm_clients where lower(email) = lower(btrim(new.email)) order by created_at limit 1;
    end if;
    if v_client is null then
      insert into crm_clients (first_name, last_name, email, phone, skin_type, allergies, marketing_ok, source)
      values (coalesce(v_first, 'Website'), v_last, nullif(btrim(new.email), ''), new.phone, new.skin_type,
              nullif(new.allergies, 'None'), coalesce(new.mailing_list_opt_in, false), 'Website enquiry')
      returning id into v_client;
    else
      update crm_clients set phone = coalesce(nullif(phone, ''), new.phone),
        skin_type = coalesce(nullif(skin_type, ''), new.skin_type),
        allergies = coalesce(nullif(allergies, ''), nullif(new.allergies, 'None')), updated_at = now()
      where id = v_client;
    end if;
    v_party := greatest(1, coalesce(nullif(regexp_replace(coalesce(new.quantity, ''), '\D', '', 'g'), '')::int, 1));
    if coalesce(new.estimate_total, 0) > 0 then
      v_lines := jsonb_build_array(jsonb_build_object('serviceId', null, 'qty', 1, 'price', new.estimate_total,
        'name', 'Website estimate' || case when new.estimate_is_from then ' (from)' else '' end || ' — ' || coalesce(new.look_name, new.category_name, 'makeup')));
    end if;
    insert into crm_bookings (client_id, stage, status, source, website_enquiry_id, event_type, event_date,
      ready_by, start_time, location, party_size, lines, answers)
    values (v_client, 'enquiry', 'open', 'Website (' || coalesce(new.source, 'web') || ')', new.id,
      coalesce(new.category_name, new.category), new.event_date,
      case when new.time_type = 'ready_by' then new.time end,
      case when new.time_type is distinct from 'ready_by' then new.time end,
      new.location, v_party, v_lines,
      jsonb_build_object('trial', coalesce(new.bridal_trial, ''), 'look', concat_ws(' · ', new.category_name, new.look_name, new.sub_style),
        'notes', coalesce(new.notes, ''), 'skinType', coalesce(new.skin_type, ''), 'allergies', coalesce(new.allergies, ''), 'heardFrom', 'Website',
        'website', jsonb_build_object('enquiryId', new.id, 'category', new.category_name, 'look', new.look_name, 'subStyle', new.sub_style,
          'quantity', new.quantity, 'timeType', new.time_type, 'lashes', new.lashes, 'patchTest', new.patch_test,
          'lessonFocus', new.lesson_focus, 'extras', new.extra_services, 'refs', new.refs, 'affiliates', new.affiliates,
          'estimate', new.estimate_total, 'estimateIsFrom', new.estimate_is_from, 'deposit', new.deposit_estimate,
          'travelKm', new.travel_km_estimate, 'travelIncluded', new.travel_included, 'travelFee', new.travel_fee_estimate,
          'mailingList', new.mailing_list_opt_in)))
    returning id into v_booking;
    insert into crm_activity (booking_id, client_id, type, text) values (v_booking, v_client, 'enquiry', 'New enquiry from the website');
    v_due := ((now() at time zone 'Australia/Brisbane')::date + time '21:00') at time zone 'Australia/Brisbane';
    if v_due < now() then v_due := now() + interval '2 hours'; end if;
    insert into crm_reminders (booking_id, client_id, kind, title, due_at, template_key, channel, status)
    values (v_booking, v_client, 'reply', 'Reply to ' || coalesce(v_first, 'new client') || '''s enquiry', v_due, 'enquiry_reply', 'email', 'pending');
  exception when others then
    raise warning 'CRM sync failed for enquiry %: %', new.id, sqlerrm;
  end;
  return new;
end $$;
