-- One server-owned timing policy for website slots, validation and CRM calendar holds.
insert into public.crm_settings(id,value) values ('appointmentBufferMins','60'::jsonb) on conflict(id) do nothing;
alter table public.enquiries add column if not exists emailed_business_at timestamptz;
alter table public.enquiries add column if not exists emailed_client_at timestamptz;
alter table public.enquiries add column if not exists email_error text;

create or replace function public.crm_chat_timing(p_service text,p_quantity integer)
returns table(duration_mins integer,buffer_mins integer)
language plpgsql stable set search_path='' as $$
declare s public.crm_services%rowtype; n integer:=greatest(1,least(coalesce(p_quantity,1),100)); m integer; b integer;
begin
 select * into s from public.crm_services where active and extra->>'websiteKey'=p_service order by sort,id limit 1;
 if not found then
   if p_service <> 'unsure' then raise exception 'Unknown service'; end if;
   return query select 180,60; return;
 end if;
 m:=greatest(coalesce(s.duration_mins,60),15);
 b:=greatest(0,least(coalesce((s.extra->>'bufferMins')::integer,(select (value#>>'{}')::integer from public.crm_settings where id='appointmentBufferMins'),60),240));
 if p_service='bridal-look' then
   m:=m+(n-1)*coalesce((select greatest(duration_mins,15) from public.crm_services where active and extra->>'websiteKey'='bridal-party' order by sort,id limit 1),60);
 elsif coalesce(s.extra->>'unit','') <> 'per booking' and p_service <> 'lesson' then m:=m*n;
 end if;
 return query select (ceil(m/15.0)*15)::integer,b;
end $$;
revoke all on function public.crm_chat_timing(text,integer) from public,anon,authenticated;

create or replace function public.crm_enquiry_slot_free(slot_start timestamptz,slot_end timestamptz)
returns boolean language sql stable set search_path='' as $$
 select not exists(select 1 from public.crm_bookings b cross join lateral (
   select coalesce(nullif(b.extra->>'calendarStart','')::timestamptz,
    (b.event_date+b.start_time) at time zone 'Australia/Brisbane',
    ((b.event_date+b.ready_by) at time zone 'Australia/Brisbane')-interval '3 hours') a
 ) t where b.status <> 'lost' and (
   (t.a < slot_end and coalesce(nullif(b.extra->>'calendarEnd','')::timestamptz,t.a+interval '3 hours')
      +make_interval(mins=>coalesce((b.extra->>'calendarBufferMins')::integer,60)) > slot_start)
   or (b.call_logged_at is null and b.call_at < slot_end and b.call_at+interval '15 minutes'>slot_start)
   or (t.a is null and b.stage in ('booked','day') and (b.event_date::timestamp at time zone 'Australia/Brisbane')<slot_end
    and ((b.event_date+1)::timestamp at time zone 'Australia/Brisbane')>slot_start)
 ));
$$;
revoke all on function public.crm_enquiry_slot_free(timestamptz,timestamptz) from public,anon,authenticated;

create or replace function public.enquiry_calendar_slots(p_month date,p_kind text,p_service text,p_quantity integer)
returns table(local_start text,available boolean,duration_mins integer,buffer_mins integer)
language sql stable security definer set search_path='' as $$
 with policy as (select * from public.crm_chat_timing(p_service,p_quantity)), candidates as (
 select d+make_interval(hours=>h) a,policy.duration_mins m,policy.buffer_mins b
 from generate_series(date_trunc('month',p_month::timestamp),date_trunc('month',p_month::timestamp)+interval '1 month - 1 day',interval '1 day') d
 cross join generate_series(case when p_kind='phone' then 9 else 3 end,case when p_kind='phone' then 16 else 12 end) h
 cross join policy
 where p_kind in ('phone','makeup_start','makeup_ready')
 and p_month >= date_trunc('month',now() at time zone 'Australia/Brisbane')::date
 and p_month < (now() at time zone 'Australia/Brisbane')::date+400)
 select to_char(a+case when p_kind='makeup_ready' then make_interval(mins=>m) else interval '0' end,'YYYY-MM-DD"T"HH24:MI'),
 (a at time zone 'Australia/Brisbane')>now()
 and a+make_interval(mins=>case when p_kind='phone' then 15 else m+b end) <= date_trunc('day',a)+interval '1 day'
 and public.crm_enquiry_slot_free(a at time zone 'Australia/Brisbane',(a+make_interval(mins=>case when p_kind='phone' then 15 else m+b end)) at time zone 'Australia/Brisbane'),m,b
 from candidates order by a;
$$;
revoke all on function public.enquiry_calendar_slots(date,text,text,integer) from public;
grant execute on function public.enquiry_calendar_slots(date,text,text,integer) to anon,authenticated;

create or replace function public.crm_validate_chat_calendar()
returns trigger language plpgsql security definer set search_path='' as $$
declare a timestamptz; z timestamptz; local_start timestamp; phone_local timestamp;
 m integer:=180; b integer:=60; n integer; service text;
begin
 if new.consult_requested_at is null then return new; end if;
 if tg_when='AFTER' then
   update public.crm_bookings set extra=coalesce(extra,'{}')||jsonb_build_object(
    'calendarStart',new.calendar_event#>>'{start,dateTime}','calendarEnd',new.calendar_event#>>'{end,dateTime}',
    'calendarBufferMins',(new.viewing->>'buffer_mins')::integer)
   where website_enquiry_id=new.id and call_at=new.consult_requested_at;
   if not found then raise exception 'ENQUIRY_CALENDAR_NOT_SAVED'; end if;
   return new;
 end if;
 perform pg_advisory_xact_lock(hashtext('crm-consultation-calendar'));
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

CREATE OR REPLACE FUNCTION public.crm_from_website_enquiry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      update crm_clients set
        phone = coalesce(nullif(phone, ''), new.phone),
        skin_type = coalesce(nullif(skin_type, ''), new.skin_type),
        allergies = coalesce(nullif(allergies, ''), nullif(new.allergies, 'None')),
        updated_at = now()
      where id = v_client;
    end if;

    v_party := greatest(1, coalesce(substring(coalesce(new.quantity, '') from '[0-9]+')::int, 1));
    if coalesce(new.estimate_total, 0) > 0 then
      v_lines := jsonb_build_array(jsonb_build_object(
        'serviceId', null, 'qty', 1, 'price', new.estimate_total,
        'name', 'Website estimate' || case when new.estimate_is_from then ' (from)' else '' end || ' — ' || coalesce(new.look_name, new.category_name, 'makeup')));
    end if;

    insert into crm_bookings (client_id, stage, status, source, website_enquiry_id, event_type, event_date,
      ready_by, start_time, location, party_size, lines, answers)
    values (v_client, 'enquiry', 'open', 'Website (' || coalesce(new.source, 'web') || ')', new.id,
      coalesce(new.category_name, new.category), new.event_date,
      case when new.time_type = 'ready_by' then new.time end,
      case when new.time_type is distinct from 'ready_by' then new.time end,
      new.location, v_party, v_lines,
      jsonb_build_object(
        'trial', coalesce(new.bridal_trial, ''),
        'look', concat_ws(' · ', new.category_name, new.look_name, new.sub_style),
        'notes', coalesce(new.notes, ''),
        'skinType', coalesce(new.skin_type, ''), 'allergies', coalesce(new.allergies, ''),
        'heardFrom', 'Website',
        'website', jsonb_build_object(
          'enquiryId', new.id, 'category', new.category_name, 'look', new.look_name, 'subStyle', new.sub_style,
          'quantity', new.quantity, 'timeType', new.time_type, 'lashes', new.lashes, 'patchTest', new.patch_test,
          'lessonFocus', new.lesson_focus, 'extras', new.extra_services, 'refs', new.refs, 'affiliates', new.affiliates,
          'estimate', new.estimate_total, 'estimateIsFrom', new.estimate_is_from, 'deposit', new.deposit_estimate,
          'travelKm', new.travel_km_estimate, 'travelIncluded', new.travel_included, 'travelFee', new.travel_fee_estimate,
          'mailingList', new.mailing_list_opt_in)))
    returning id into v_booking;

    insert into crm_activity (booking_id, client_id, type, text)
    values (v_booking, v_client, 'enquiry', 'New enquiry from the website');

    v_due := ((now() at time zone 'Australia/Brisbane')::date + time '21:00') at time zone 'Australia/Brisbane';
    if v_due < now() then v_due := now() + interval '2 hours'; end if;
    insert into crm_reminders (booking_id, client_id, kind, title, due_at, template_key, channel, status)
    values (v_booking, v_client, 'reply', 'Reply to ' || coalesce(v_first, 'new client') || '''s enquiry', v_due, 'enquiry_reply', 'email', 'pending');
  exception when others then
    raise warning 'CRM sync failed for enquiry %: %', new.id, sqlerrm;   -- never block the website form
  end;
  return new;
end $function$

