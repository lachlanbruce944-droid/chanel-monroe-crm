-- Calendar holds are derived from the booking so edits and cancellations cannot leave stale CRM blocks.
create or replace function public.crm_makeup_hold(b public.crm_bookings)
returns tstzrange language sql stable set search_path = '' as $$
  select case when b.status <> 'lost' and a is not null
    then tstzrange(a,a + interval '4 hours','[)') end
  from (select coalesce(nullif(b.extra->>'calendarStart','')::timestamptz,
    (b.event_date+b.start_time) at time zone 'Australia/Brisbane',
    ((b.event_date+b.ready_by) at time zone 'Australia/Brisbane') - interval '3 hours') as a) starts;
$$;

create or replace function public.crm_phone_hold(b public.crm_bookings)
returns tstzrange language sql stable set search_path = '' as $$
  select case when b.status <> 'lost' and b.call_at is not null and b.call_logged_at is null
    then tstzrange(b.call_at,b.call_at + interval '15 minutes','[)') end;
$$;

-- Preserve overlapping requests for review. Approval and confirmed makeup cannot overlap.
create or replace function public.crm_guard_appointment_holds()
returns trigger language plpgsql security definer set search_path = public as $$
declare makeup tstzrange := crm_makeup_hold(new); phone tstzrange := crm_phone_hold(new);
  confirmed boolean := coalesce(new.extra->'consultation'->>'status' = 'confirmed',false);
  makeup_conflict boolean; phone_conflict boolean;
begin
  if tg_op = 'UPDATE' and makeup is not distinct from crm_makeup_hold(old)
    and phone is not distinct from crm_phone_hold(old) and new.stage is not distinct from old.stage
    and new.extra->'consultation'->>'status' is not distinct from old.extra->'consultation'->>'status' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('crm-consultation-calendar'));
  select exists(select 1 from crm_bookings b where b.id <> new.id
    and (makeup && crm_makeup_hold(b) or makeup && crm_phone_hold(b))) into makeup_conflict;
  select coalesce(phone && makeup,false) or exists(select 1 from crm_bookings b where b.id <> new.id
    and (phone && crm_makeup_hold(b) or phone && crm_phone_hold(b))) into phone_conflict;
  if confirmed and phone_conflict then raise exception 'Phone consultation overlaps another calendar hold. Request a new time before approving.'; end if;
  if new.stage in ('booked','day') and makeup_conflict then raise exception 'Makeup or its one-hour buffer overlaps another calendar hold. Choose a new time before confirming.'; end if;
  return new;
end $$;
drop trigger if exists crm_hold_guard on public.crm_bookings;
create trigger crm_hold_guard before insert or update on public.crm_bookings
for each row execute function public.crm_guard_appointment_holds();

-- Public picker accepts requests even if the CRM is busy. It exposes no private calendar data.
create or replace function public.consultation_availability(p_month date)
returns table(local_start text, available boolean)
language sql stable set search_path = '' as $$
  select to_char(t,'YYYY-MM-DD"T"HH24:MI'), (t at time zone 'Australia/Brisbane') > now()
  from generate_series(date_trunc('month',p_month::timestamp),
    date_trunc('month',p_month::timestamp)+interval '1 month - 1 day',interval '1 day') d
  cross join generate_series(9,16) h
  cross join lateral (select d+make_interval(hours=>h) as t) slot
  where p_month >= (date_trunc('month',now() at time zone 'Australia/Brisbane')::date)
    and p_month < ((now() at time zone 'Australia/Brisbane')::date + 400);
$$;

revoke all on function public.crm_makeup_hold(public.crm_bookings), public.crm_phone_hold(public.crm_bookings),
 public.crm_guard_appointment_holds() from public, anon, authenticated;
grant execute on function public.consultation_availability(date) to anon, authenticated;

-- Worker consumes versioned entries; a changed booking remains queued if a previous sync is in flight.
create table if not exists public.crm_apple_calendar_queue (
  booking_id uuid primary key,
  version uuid not null default gen_random_uuid(),
  next_attempt timestamptz not null default now(),
  last_error text
);
alter table public.crm_apple_calendar_queue enable row level security;
revoke all on public.crm_apple_calendar_queue from anon, authenticated;
grant select, update, delete on public.crm_apple_calendar_queue to service_role;

create or replace function public.crm_queue_apple_calendar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if crm_makeup_hold(new) is not distinct from crm_makeup_hold(old)
      and crm_phone_hold(new) is not distinct from crm_phone_hold(old)
      and (new.stage in ('booked','day')) = (old.stage in ('booked','day'))
      and new.extra->'consultation'->>'status' is not distinct from old.extra->'consultation'->>'status' then
      return null;
    end if;
  end if;
  insert into crm_apple_calendar_queue(booking_id) values (coalesce(new.id,old.id))
  on conflict (booking_id) do update
    set version=gen_random_uuid(),next_attempt=now(),last_error=null;
  return null;
end $$;
revoke all on function public.crm_queue_apple_calendar() from public, anon, authenticated;
drop trigger if exists crm_apple_calendar_changed on public.crm_bookings;
create trigger crm_apple_calendar_changed after insert or update or delete on public.crm_bookings
for each row execute function public.crm_queue_apple_calendar();
insert into public.crm_apple_calendar_queue(booking_id)
select b.id from public.crm_bookings b
where upper(public.crm_makeup_hold(b)) > now() or upper(public.crm_phone_hold(b)) > now()
on conflict do nothing;

create or replace function public.crm_manage_consultation(p_booking uuid,p_actor uuid,p_action text,p_start timestamptz default null,p_exception text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare b crm_bookings%rowtype; c jsonb; t timestamptz; event_at timestamptz; v uuid; k text; reason text;
begin
 if not exists(select 1 from crm_staff where user_id=p_actor and role='owner') then raise exception 'Only Chanel (the CRM owner) can approve or schedule phone consultations'; end if;
 perform pg_advisory_xact_lock(hashtext('crm-consultation-calendar'));
 select * into b from crm_bookings where id=p_booking for update;
 if not found or b.status='lost' then raise exception 'Active enquiry not found'; end if;
 c=coalesce(b.extra->'consultation','{}');
 if p_action='retry-email' then return jsonb_build_object('ok',true); end if;
 if p_action not in ('schedule','approve') then raise exception 'Unknown consultation action'; end if;
 if b.stage not in ('enquiry','call') or b.call_logged_at is not null then raise exception 'Consultation already completed or booking progressed'; end if;
 t=case when p_action='schedule' then p_start else b.call_at end;
 if t is null then raise exception 'Select a consultation time'; end if;
 -- Repeated approval retries its existing email, including after delivery errors.
 if p_action='approve' and c->>'provider'='crm' and c->>'status'='confirmed' then return jsonb_build_object('ok',true); end if;
 if t<=now() then raise exception 'Choose a future consultation time'; end if;
 if b.event_date is null then raise exception 'Add the makeup appointment date first'; end if;
 event_at=coalesce(lower(crm_makeup_hold(b)),(b.event_date::timestamp at time zone 'Australia/Brisbane'));
 if t+interval '15 minutes'>=event_at then raise exception 'Phone consultation must finish before the makeup appointment'; end if;
 reason=case when p_action='approve' then coalesce(nullif(btrim(p_exception),''),c->>'exceptionReason','') else btrim(p_exception) end;
 if p_action='approve' and event_at-t<interval '3 days' and length(reason)<5 then raise exception 'Consultations normally need three days before makeup. Record Chanel’s short-notice exception reason'; end if;
 v=gen_random_uuid(); k=case when p_action='approve' then 'confirmed' else 'pending' end;
 c=jsonb_build_object('provider','crm','status',k,'startTime',t,'durationMins',15,'version',v,'exceptionReason',reason,'emailStatus','pending');
 if k='confirmed' then c=c||jsonb_build_object('approvedAt',now(),'approvedBy',p_actor); end if;
 update crm_bookings set call_at=t, stage=case when k='confirmed' then 'call' else 'enquiry' end,
  stage_changed_at=now(), extra=coalesce(extra,'{}')||jsonb_build_object('consultation',c), updated_at=now() where id=b.id;
 update crm_reminders set status='skipped',closed_at=now() where booking_id=b.id and kind='call' and status='pending';
 if k='confirmed' then
  insert into crm_reminders(booking_id,client_id,kind,title,due_at,template_key,channel,status) values(b.id,b.client_id,'call','Confirmed phone consultation',t,'','email','pending');
 end if;
 insert into crm_consultation_emails(booking_id,version,kind,start_at) values(b.id,v,k,t);
 insert into crm_activity(booking_id,client_id,user_id,type,text) values(b.id,b.client_id,p_actor,'call', 'Phone consultation '||k||' · '||t||case when reason<>'' then ' · Exception: '||reason else '' end);
 return jsonb_build_object('ok',true,'consultation',c);
end $$;
revoke all on function public.crm_manage_consultation(uuid,uuid,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.crm_manage_consultation(uuid,uuid,text,timestamptz,text) to service_role;

-- Preserve the existing owner-only approval and completed-call gates with the derived start time.
create or replace function public.crm_guard_consult_calendar() returns trigger
language plpgsql security definer set search_path=public as $$
declare start_at timestamptz := lower(crm_makeup_hold(new)); changed boolean := true;
begin
 if tg_op='UPDATE' then
  if auth.role()='authenticated' and (new.extra->'consultation') is distinct from (old.extra->'consultation') then
   raise exception 'Use the owner-only consultation approval service';
  end if;
  changed := new.stage is distinct from old.stage or new.status is distinct from old.status
    or crm_makeup_hold(new) is distinct from crm_makeup_hold(old);
 end if;
 if new.stage not in ('booked','day') or new.status='lost' or not changed then return new; end if;
 if new.call_logged_at is null or coalesce(new.extra->'consultation'->>'provider','') <> 'crm'
   or coalesce(new.extra->'consultation'->>'status','') <> 'confirmed' then
  raise exception 'Complete the CRM-approved phone consultation before confirming makeup';
 end if;
 if start_at is null then raise exception 'Add a makeup start or ready-by time'; end if;
 if new.call_at is null or new.call_at+interval '15 minutes'>=start_at then
  raise exception 'Consultation must finish before makeup';
 end if;
 if start_at-new.call_at<interval '3 days' and length(coalesce(new.extra->'consultation'->>'exceptionReason',''))<5 then
  raise exception 'Record Chanel’s short-notice exception reason';
 end if;
 return new;
end $$;
