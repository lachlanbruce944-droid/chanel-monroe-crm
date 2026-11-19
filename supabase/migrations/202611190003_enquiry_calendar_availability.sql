-- CRM is the source of availability. Public callers get start times and flags only.
create or replace function public.crm_enquiry_slot_free(slot_start timestamptz, slot_end timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select not exists (
    select 1 from public.crm_bookings b
    cross join lateral (
      select coalesce(nullif(b.extra->>'calendarStart','')::timestamptz,
        (b.event_date+b.start_time) at time zone 'Australia/Brisbane',
        ((b.event_date+b.ready_by) at time zone 'Australia/Brisbane') - interval '3 hours') as makeup_start
    ) times
    where b.status <> 'lost' and (
      (times.makeup_start < slot_end and times.makeup_start + interval '4 hours' > slot_start)
      or (b.call_logged_at is null and b.call_at < slot_end and b.call_at + interval '15 minutes' > slot_start)
      or (times.makeup_start is null and b.stage in ('booked','day')
        and (b.event_date::timestamp at time zone 'Australia/Brisbane') < slot_end
        and ((b.event_date+1)::timestamp at time zone 'Australia/Brisbane') > slot_start)
    )
  );
$$;
revoke all on function public.crm_enquiry_slot_free(timestamptz,timestamptz) from public,anon,authenticated;

create or replace function public.enquiry_calendar_availability(p_month date, p_kind text)
returns table(local_start text, available boolean)
language sql stable security definer set search_path = '' as $$
  select to_char(local_time,'YYYY-MM-DD"T"HH24:MI'),
    start_at > now() and public.crm_enquiry_slot_free(start_at,
      start_at + case when p_kind='phone' then interval '15 minutes' else interval '4 hours' end)
  from generate_series(date_trunc('month',p_month::timestamp),
    date_trunc('month',p_month::timestamp)+interval '1 month - 1 day',interval '1 day') as days(day)
  cross join generate_series(9,case when p_kind='phone' then 16 else 14 end) as hours(hour)
  cross join lateral (select day+make_interval(hours=>hour) as local_start_time) starts
  cross join lateral (select local_start_time at time zone 'Australia/Brisbane' as start_at,
    local_start_time+case when p_kind='makeup_ready' then interval '3 hours' else interval '0' end as local_time) times
  where p_kind in ('phone','makeup_start','makeup_ready')
    and p_month >= date_trunc('month',now() at time zone 'Australia/Brisbane')::date
    and p_month < (now() at time zone 'Australia/Brisbane')::date+400
  order by local_time;
$$;
revoke all on function public.enquiry_calendar_availability(date,text) from public;
grant execute on function public.enquiry_calendar_availability(date,text) to anon,authenticated;

-- Staff writes and enquiry writes use the same lock as consultation approval.
create or replace function public.crm_take_enquiry_calendar_lock()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('crm-consultation-calendar'));
  return new;
end $$;
revoke all on function public.crm_take_enquiry_calendar_lock() from public,anon,authenticated;
drop trigger if exists crm_enquiry_calendar_lock on public.crm_bookings;
create trigger crm_enquiry_calendar_lock before insert or update of
  stage,status,extra,event_date,start_time,ready_by,call_at,call_logged_at on public.crm_bookings
for each row execute function public.crm_take_enquiry_calendar_lock();

-- Execute after the enquiry-to-CRM and phone-request triggers. Exclude the enquiry's own
-- holds by validating in BEFORE INSERT, and verify the CRM mirror exists before committing.
create or replace function public.crm_validate_chat_calendar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare start_at timestamptz; local_start timestamp; phone_local timestamp;
begin
  if new.consult_requested_at is null then return new; end if;
  if tg_when='AFTER' then
    if not exists(select 1 from public.crm_bookings b
      where b.website_enquiry_id=new.id and b.call_at=new.consult_requested_at) then
      raise exception using errcode='P0001', message='ENQUIRY_CALENDAR_NOT_SAVED';
    end if;
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('crm-consultation-calendar'));
  local_start := new.event_date+new.time
    - case when new.time_type='ready_by' then interval '3 hours' else interval '0' end;
  start_at := local_start at time zone 'Australia/Brisbane';
  phone_local := new.consult_requested_at at time zone 'Australia/Brisbane';
  if start_at is null or start_at <= now() or local_start <> date_trunc('hour',local_start)
    or local_start::time not between time '09:00' and time '14:00'
    or not public.crm_enquiry_slot_free(start_at,start_at+interval '4 hours') then
    raise exception using errcode='P0001', message='ENQUIRY_MAKEUP_SLOT_UNAVAILABLE';
  end if;
  if new.consult_requested_at <= now() or phone_local <> date_trunc('hour',phone_local)
    or phone_local::time not between time '09:00' and time '16:00'
    or new.consult_requested_at+interval '15 minutes' >= start_at
    or not public.crm_enquiry_slot_free(new.consult_requested_at,new.consult_requested_at+interval '15 minutes') then
    raise exception using errcode='P0001', message='ENQUIRY_PHONE_SLOT_UNAVAILABLE';
  end if;
  return new;
end $$;
revoke all on function public.crm_validate_chat_calendar() from public,anon,authenticated;
drop trigger if exists crm_validate_chat_calendar on public.enquiries;
create trigger crm_validate_chat_calendar before insert on public.enquiries
for each row execute function public.crm_validate_chat_calendar();
drop trigger if exists zzzzz_verify_chat_calendar on public.enquiries;
create trigger zzzzz_verify_chat_calendar after insert on public.enquiries
for each row execute function public.crm_validate_chat_calendar();
