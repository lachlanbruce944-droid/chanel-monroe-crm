-- Use the same occupancy calculation and transaction lock for website and staff writes.
create or replace function public.crm_reservation_ranges(b public.crm_bookings)
returns table (slot_kind text, occupied tstzrange)
language sql stable set search_path = '' as $$
  with timing as (
    select coalesce(nullif(b.extra->>'calendarStart','')::timestamptz,
      (b.event_date+b.start_time) at time zone 'Australia/Brisbane',
      ((b.event_date+b.ready_by) at time zone 'Australia/Brisbane')-interval '3 hours') as starts
  )
  select 'makeup', tstzrange(starts, coalesce(nullif(b.extra->>'calendarEnd','')::timestamptz,
    starts + interval '3 hours') + make_interval(mins => greatest(0,coalesce((b.extra->>'calendarBufferMins')::integer,60))), '[)')
  from timing where starts is not null
  union all
  select 'makeup', tstzrange(b.event_date::timestamp at time zone 'Australia/Brisbane',
    (b.event_date+1)::timestamp at time zone 'Australia/Brisbane', '[)')
  from timing where starts is null and b.event_date is not null and b.stage in ('booked','day')
  union all
  select 'call', tstzrange(b.call_at,b.call_at + interval '15 minutes','[)')
  where b.call_at is not null and b.call_logged_at is null
$$;

create or replace function public.crm_reservation_active(b public.crm_bookings)
returns boolean language sql stable set search_path = '' as $$
  select b.status <> 'lost' and not (
    b.website_enquiry_id is not null and b.stage = 'enquiry'
    and b.created_at + interval '48 hours' <= now()
  )
$$;

create or replace function public.crm_enquiry_slot_free(slot_start timestamptz,slot_end timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select not exists (
    select 1 from public.crm_bookings b cross join lateral public.crm_reservation_ranges(b) r
    where public.crm_reservation_active(b) and r.occupied && tstzrange(slot_start,slot_end,'[)')
  )
$$;

create or replace function public.crm_guard_reservation_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not public.crm_reservation_active(new) then return new; end if;
  -- Public intake inserts a provisional row. Its AFTER hooks validate the final ranges.
  if tg_op='INSERT' and pg_trigger_depth()>1 and exists (select 1 from public.enquiries e where e.id=new.website_enquiry_id and e.consult_requested_at is not null) then return new; end if;
  if tg_op='UPDATE' and public.crm_reservation_active(old)
    and (new.event_date,new.start_time,new.ready_by,new.call_at,new.call_logged_at,
         new.extra->>'calendarStart',new.extra->>'calendarEnd',new.extra->>'calendarBufferMins')
     is not distinct from
        (old.event_date,old.start_time,old.ready_by,old.call_at,old.call_logged_at,
         old.extra->>'calendarStart',old.extra->>'calendarEnd',old.extra->>'calendarBufferMins')
    and (new.stage in ('booked','day')) = (old.stage in ('booked','day')) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('crm-consultation-calendar'));
  if exists (
    select 1 from public.crm_reservation_ranges(new) candidate
    cross join public.crm_reservation_ranges(new) other
    where candidate.slot_kind='call' and other.slot_kind='makeup' and candidate.occupied && other.occupied
  ) or exists (
    select 1 from public.crm_reservation_ranges(new) candidate
    cross join public.crm_bookings b
    cross join lateral public.crm_reservation_ranges(b) occupied
    where b.id <> new.id and public.crm_reservation_active(b) and candidate.occupied && occupied.occupied
  ) then raise exception 'This time conflicts with an active CRM reservation, including its buffer'; end if;
  return new;
end $$;

drop trigger if exists zz_crm_guard_reservation_write on public.crm_bookings;
create trigger zz_crm_guard_reservation_write before insert or update on public.crm_bookings
for each row execute function public.crm_guard_reservation_write();
revoke all on function public.crm_reservation_ranges(public.crm_bookings),
  public.crm_reservation_active(public.crm_bookings), public.crm_guard_reservation_write()
from public, anon, authenticated;

-- Intake and CRM materialisation share the transaction. An error rolls back the receipt.
CREATE OR REPLACE FUNCTION public.crm_from_website_enquiry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client uuid; v_candidate uuid; v_booking uuid; v_first text; v_last text; v_name text;
  v_party int; v_lines jsonb := '[]'; v_due timestamptz;
begin
    v_name := btrim(coalesce(new.name, ''));
    v_first := nullif(split_part(v_name, ' ', 1), '');
    v_last := nullif(btrim(substr(v_name, length(coalesce(v_first,'')) + 1)), '');

    if coalesce(btrim(new.email), '') <> '' then
      select id into v_candidate from crm_clients where lower(email) = lower(btrim(new.email)) order by created_at, id limit 1;
    end if;
      insert into crm_clients (first_name, last_name, email, phone, skin_type, allergies, marketing_ok, source)
      values (coalesce(v_first, 'Website'), v_last, nullif(btrim(new.email), ''), new.phone, new.skin_type,
              nullif(new.allergies, 'None'), coalesce(new.mailing_list_opt_in, false), 'Website enquiry')
      returning id into v_client;

    v_party := greatest(1, coalesce(substring(coalesce(new.quantity, '') from '[0-9]+')::int, 1));
    if coalesce(new.estimate_total, 0) > 0 then
      v_lines := jsonb_build_array(jsonb_build_object(
        'serviceId', null, 'qty', 1, 'price', new.estimate_total,
        'name', 'Website estimate' || case when new.estimate_is_from then ' (from)' else '' end || ' — ' || coalesce(new.look_name, new.category_name, 'makeup')));
    end if;

    insert into crm_bookings (client_id, stage, status, source, website_enquiry_id, event_type, event_date,
      ready_by, start_time, location, party_size, lines, extra, answers)
    values (v_client, 'enquiry', 'open', 'Website (' || coalesce(new.source, 'web') || ')', new.id,
      coalesce(new.category_name, new.category), new.event_date,
      case when new.time_type = 'ready_by' then new.time end,
      case when new.time_type is distinct from 'ready_by' then new.time end,
      new.location, v_party, v_lines,
      case when new.consult_requested_at is null then '{}'::jsonb else jsonb_build_object(
        'calendarStart', new.calendar_event#>>'{start,dateTime}',
        'calendarEnd', new.calendar_event#>>'{end,dateTime}',
        'calendarBufferMins', new.viewing->'buffer_mins') end,
      jsonb_build_object(
        'trial', coalesce(new.bridal_trial, ''),
        'look', concat_ws(' · ', new.category_name, new.look_name, new.sub_style),
        'notes', coalesce(new.notes, ''),
        'skinType', coalesce(new.skin_type, ''), 'allergies', coalesce(new.allergies, ''),
        'heardFrom', 'Website',
        'website', jsonb_build_object(
          'enquiryId', new.id, 'candidateClientId', v_candidate, 'category', new.category_name, 'look', new.look_name, 'subStyle', new.sub_style,
          'quantity', new.quantity, 'timeType', new.time_type, 'lashes', new.lashes, 'patchTest', new.patch_test,
          'lessonFocus', new.lesson_focus, 'extras', new.extra_services, 'refs', new.refs, 'affiliates', new.affiliates,
          'estimate', new.estimate_total, 'estimateIsFrom', new.estimate_is_from, 'deposit', new.deposit_estimate,
          'travelKm', new.travel_km_estimate, 'travelIncluded', new.travel_included, 'travelFee', new.travel_fee_estimate,
          'mailingList', new.mailing_list_opt_in)))
    returning id into v_booking;

    insert into crm_activity (booking_id, client_id, type, text)
    values (v_booking, v_client, 'enquiry', case when v_candidate is null then 'New enquiry from the website'
      else 'New website enquiry · possible existing client email. Check the match before transferring details.' end);

    v_due := ((now() at time zone 'Australia/Brisbane')::date + time '21:00') at time zone 'Australia/Brisbane';
    if v_due < now() then v_due := now() + interval '2 hours'; end if;
    insert into crm_reminders (booking_id, client_id, kind, title, due_at, template_key, channel, status)
    values (v_booking, v_client, 'reply', 'Reply to ' || coalesce(v_first, 'new client') || '''s enquiry', v_due, 'enquiry_reply', 'email', 'pending');
  return new;
end $function$;

-- Resolve access to an attached photo through the existing, private bucket.
drop policy if exists "CRM staff can read enquiry selfies" on storage.objects;
drop policy if exists crm_staff_read_website_selfies on storage.objects;
create policy crm_staff_read_website_selfies on storage.objects for select to authenticated
using (bucket_id='selfies' and public.is_crm_staff() and exists (
  select 1 from public.enquiries e where e.selfie_path=storage.objects.name
));

-- The enquiry is the durable receipt outbox. Recover after browser close and transient failures.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
alter table public.enquiries
  add column if not exists emailed_business_at timestamptz,
  add column if not exists emailed_client_at timestamptz,
  add column if not exists email_error text,
  add column if not exists receipt_next_attempt_at timestamptz;

create or replace function public.crm_retry_enquiry_receipts()
returns void language plpgsql security definer set search_path = '' as $$
declare endpoint text; dispatched integer;
begin
  endpoint := current_setting('app.enquiry_receipt_url', true);
  if endpoint is null or endpoint='' then return; end if;
  with due as (
    select e.id from public.enquiries e
    where e.created_at > now() - interval '23 hours'
      and (e.emailed_business_at is null or (nullif(e.email,'') is not null and e.emailed_client_at is null))
      and e.receipt_next_attempt_at <= now()
    order by e.receipt_next_attempt_at limit 25 for update skip locked
  ), claimed as (
    update public.enquiries e set receipt_next_attempt_at=now()+interval '15 minutes'
    from due where e.id=due.id returning e.id
  )
  select count(net.http_post(
    url := endpoint,
    body := jsonb_build_object('id',id),
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 15000
  )) into dispatched from claimed;
end;
$$;
revoke all on function public.crm_retry_enquiry_receipts() from public, anon, authenticated;

create or replace function public.crm_queue_enquiry_receipt()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.receipt_next_attempt_at := now() + interval '5 minutes';
  return new;
end $$;
drop trigger if exists crm_queue_enquiry_receipt on public.enquiries;
create trigger crm_queue_enquiry_receipt before insert on public.enquiries
for each row execute function public.crm_queue_enquiry_receipt();

select cron.schedule('crm-enquiry-receipt-retry','*/5 * * * *',
  'select public.crm_retry_enquiry_receipts()');

-- Provision the initial owner explicitly using an existing authenticated user's ID.
revoke execute on function public.crm_claim_owner(text) from public, anon, authenticated;

alter table public.enquiries add column if not exists receipt_fingerprint text;
create or replace function public.crm_validate_chat_calendar()
returns trigger language plpgsql security definer set search_path='' as $$
declare a timestamptz; z timestamptz; local_start timestamp; phone_local timestamp;
 m integer:=180; b integer:=60; n integer; service text; fingerprint text; previous text;
begin
 if tg_when='AFTER' then
   if new.consult_requested_at is null then return new; end if;
   update public.crm_bookings set extra=coalesce(extra,'{}')||jsonb_build_object(
    'calendarStart',new.calendar_event#>>'{start,dateTime}','calendarEnd',new.calendar_event#>>'{end,dateTime}',
    'calendarBufferMins',(new.viewing->>'buffer_mins')::integer)
   where website_enquiry_id=new.id and call_at=new.consult_requested_at;
   if not found then raise exception 'ENQUIRY_CALENDAR_NOT_SAVED'; end if;
   return new;
 end if;
 perform pg_advisory_xact_lock(hashtext('crm-consultation-calendar'));
 fingerprint := encode(sha256(convert_to((to_jsonb(new) - array[
   'created_at','updated_at','receipt_next_attempt_at','receipt_fingerprint',
   'emailed_business_at','emailed_client_at','email_error','viewing','calendar_event']
   || jsonb_build_object('calendar_version',new.viewing->'calendar_version'))::text,'UTF8')),'hex');
 select e.receipt_fingerprint into previous from public.enquiries e where e.id=new.id;
 if found then
   if fingerprint=previous then return new; end if;
   raise exception 'ENQUIRY_RETRY_MISMATCH';
 end if;
 new.receipt_fingerprint := fingerprint;
 if new.consult_requested_at is null then return new; end if;
 if new.viewing->>'calendar_version'='2' then
   service:=case when new.category='lesson' then 'lesson' else new.look end;
   n:=coalesce(nullif(substring(coalesce(new.quantity,'') from '[0-9]+'),'')::integer,1);
   select duration_mins,buffer_mins into m,b from public.crm_chat_timing(service,n);
 end if;
 local_start:=new.event_date+new.time-case when new.time_type='ready_by' then make_interval(mins=>m) else interval '0' end;
 a:=local_start at time zone 'Australia/Brisbane'; z:=a+make_interval(mins=>m);
 phone_local:=new.consult_requested_at at time zone 'Australia/Brisbane';
 if a is null or a<=now() or local_start<>date_trunc('hour',local_start)
  or local_start::time not between time '03:00' and time '12:00'
  or z+make_interval(mins=>b)>(date_trunc('day',local_start)+interval '1 day') at time zone 'Australia/Brisbane'
  or not public.crm_enquiry_slot_free(a,z+make_interval(mins=>b)) then raise exception 'ENQUIRY_MAKEUP_SLOT_UNAVAILABLE'; end if;
 if new.consult_requested_at<=now() or phone_local<>date_trunc('hour',phone_local)
  or phone_local::time not between time '09:00' and time '16:00'
  or new.consult_requested_at+interval '15 minutes'>=a
  or not public.crm_enquiry_slot_free(new.consult_requested_at,new.consult_requested_at+interval '15 minutes') then raise exception 'ENQUIRY_PHONE_SLOT_UNAVAILABLE'; end if;
 -- Never trust browser-generated calendar boundaries.
 new.calendar_event:=coalesce(new.calendar_event,'{}')||jsonb_build_object(
  'start',jsonb_build_object('dateTime',a,'timeZone','Australia/Brisbane'),
  'end',jsonb_build_object('dateTime',z,'timeZone','Australia/Brisbane'));
 new.viewing:=coalesce(new.viewing,'{}')||jsonb_build_object('duration_mins',m,'buffer_mins',b);
 return new;
end $$;

revoke all on function public.crm_validate_chat_calendar() from public,anon,authenticated;
