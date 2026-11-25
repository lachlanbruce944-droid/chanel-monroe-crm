-- Makeup appointments: operating hours 6:00 am – 5:00 pm (Brisbane), every day.
-- A slot is "within operating hours" when it starts at or after 6:00 am and the service finishes by 5:00 pm.
-- Anything else (starts 3:00 am – 8:00 pm, service + buffer finishing by midnight) is "outside operating hours"
-- and is only offered when the client chooses that option (viewing.appointment_hours = 'extended').
-- Phone consultations are unchanged (on the hour, 9:00 am – 4:00 pm).

-- Single place to change the operating hours.
create or replace function public.crm_within_operating_hours(p_local_start timestamp, p_mins integer)
returns boolean language sql immutable set search_path = '' as $$
  select p_local_start::time >= time '06:00'
     and p_local_start + make_interval(mins => p_mins) <= date_trunc('day', p_local_start) + interval '17 hours';
$$;
revoke all on function public.crm_within_operating_hours(timestamp, integer) from public;
grant execute on function public.crm_within_operating_hours(timestamp, integer) to anon, authenticated;

-- Replaces the 4-argument version. p_hours defaults to 'standard', so a browser still running the old page
-- (which sends no p_hours) is shown operating-hours slots only, matching what the server will accept.
drop function if exists public.enquiry_calendar_slots(date, text, text, integer);
create function public.enquiry_calendar_slots(p_month date, p_kind text, p_service text, p_quantity integer,
  p_hours text default 'standard')
returns table(local_start text, available boolean, duration_mins integer, buffer_mins integer)
language sql stable security definer set search_path = '' as $$
 with policy as (select * from public.crm_chat_timing(p_service, p_quantity)), candidates as (
  select d + make_interval(hours => h) a, policy.duration_mins m, policy.buffer_mins b
  from generate_series(date_trunc('month', p_month::timestamp),
                       date_trunc('month', p_month::timestamp) + interval '1 month - 1 day', interval '1 day') d
  cross join generate_series(case when p_kind = 'phone' then 9 else 3 end, case when p_kind = 'phone' then 16 else 20 end) h
  cross join policy
  where p_kind in ('phone', 'makeup_start', 'makeup_ready')
    and p_month >= date_trunc('month', now() at time zone 'Australia/Brisbane')::date
    and p_month < (now() at time zone 'Australia/Brisbane')::date + 400)
 select to_char(a + case when p_kind = 'makeup_ready' then make_interval(mins => m) else interval '0' end, 'YYYY-MM-DD"T"HH24:MI'),
  (a at time zone 'Australia/Brisbane') > now()
  and a + make_interval(mins => case when p_kind = 'phone' then 15 else m + b end) <= date_trunc('day', a) + interval '1 day'
  and public.crm_enquiry_slot_free(a at time zone 'Australia/Brisbane',
        (a + make_interval(mins => case when p_kind = 'phone' then 15 else m + b end)) at time zone 'Australia/Brisbane'),
  m, b
 from candidates
 where p_kind = 'phone'
    or public.crm_within_operating_hours(a, m) = (coalesce(p_hours, 'standard') <> 'extended')
 order by a;
$$;
revoke all on function public.enquiry_calendar_slots(date, text, text, integer, text) from public;
grant execute on function public.enquiry_calendar_slots(date, text, text, integer, text) to anon, authenticated;

-- Server check on every website enquiry: same rule as the calendar above.
create or replace function public.crm_validate_chat_calendar()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare a timestamptz; z timestamptz; local_start timestamp; phone_local timestamp;
 m integer:=180; b integer:=60; n integer; service text; extended boolean;
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
 -- Retrying a lost response must reach the primary-key check without conflicting with its own hold.
 if exists(select 1 from public.enquiries e where e.id=new.id) then
   if exists(select 1 from public.enquiries e where e.id=new.id
     and e.name is not distinct from new.name and e.email is not distinct from new.email
     and e.phone is not distinct from new.phone and e.category is not distinct from new.category
     and e.look is not distinct from new.look and e.event_date is not distinct from new.event_date
     and e.time is not distinct from new.time and e.quantity is not distinct from new.quantity
     and e.consult_requested_at is not distinct from new.consult_requested_at) then return new; end if;
   raise exception 'ENQUIRY_RETRY_MISMATCH';
 end if;
 perform pg_advisory_xact_lock(hashtext('crm-consultation-calendar'));
 if new.viewing->>'calendar_version'='2' then
   service:=case when new.category='lesson' then 'lesson' else new.look end;
   n:=coalesce(nullif(substring(coalesce(new.quantity,'') from '[0-9]+'),'')::integer,1);
   select duration_mins,buffer_mins into m,b from public.crm_chat_timing(service,n);
 end if;
 extended:=coalesce(new.viewing->>'appointment_hours','standard')='extended';
 local_start:=new.event_date+new.time-case when new.time_type='ready_by' then make_interval(mins=>m) else interval '0' end;
 a:=local_start at time zone 'Australia/Brisbane'; z:=a+make_interval(mins=>m);
 phone_local:=new.consult_requested_at at time zone 'Australia/Brisbane';
 if a is null or a<=now() or local_start<>date_trunc('hour',local_start)
  or local_start::time not between time '03:00' and time '20:00'
  or public.crm_within_operating_hours(local_start,m) = extended
  or z+make_interval(mins=>b)>(date_trunc('day',local_start)+interval '1 day') at time zone 'Australia/Brisbane'
  or not public.crm_enquiry_slot_free(a,z+make_interval(mins=>b)) then raise exception 'ENQUIRY_MAKEUP_SLOT_UNAVAILABLE'; end if;
 if new.consult_requested_at<=now() or phone_local<>date_trunc('hour',phone_local)
  or phone_local::time not between time '09:00' and time '16:00'
  or new.consult_requested_at+interval '15 minutes'>=a
  or not public.crm_enquiry_slot_free(new.consult_requested_at,new.consult_requested_at+interval '15 minutes') then raise exception 'ENQUIRY_PHONE_SLOT_UNAVAILABLE'; end if;
 -- Never trust browser-generated calendar boundaries or hours flags.
 new.calendar_event:=coalesce(new.calendar_event,'{}')||jsonb_build_object(
  'start',jsonb_build_object('dateTime',a,'timeZone','Australia/Brisbane'),
  'end',jsonb_build_object('dateTime',z,'timeZone','Australia/Brisbane'));
 new.viewing:=coalesce(new.viewing,'{}')||jsonb_build_object('duration_mins',m,'buffer_mins',b,
  'appointment_hours',case when extended then 'extended' else 'standard' end,'extended_hours_fee_pending',extended);
 return new;
end $function$;
