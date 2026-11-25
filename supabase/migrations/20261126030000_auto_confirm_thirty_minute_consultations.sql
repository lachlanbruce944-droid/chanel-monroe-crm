CREATE OR REPLACE FUNCTION public.enquiry_calendar_availability(p_month date, p_kind text)
 RETURNS TABLE(local_start text, available boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select to_char(local_time,'YYYY-MM-DD"T"HH24:MI'),
    start_at > now() and public.crm_enquiry_slot_free(start_at,
      start_at + case when p_kind='phone' then interval '30 minutes' else interval '4 hours' end)
  from generate_series(date_trunc('month',p_month::timestamp),
    date_trunc('month',p_month::timestamp)+interval '1 month - 1 day',interval '1 day') as days(day)
  cross join generate_series(case when p_kind='phone' then 540 else 180 end,
    case when p_kind='phone' then 990 else 720 end, case when p_kind='phone' then 30 else 60 end) as hours(hour)
  cross join lateral (select day+make_interval(mins=>hour) as local_start_time) starts
  cross join lateral (select local_start_time at time zone 'Australia/Brisbane' as start_at,
    local_start_time+case when p_kind='makeup_ready' then interval '3 hours' else interval '0' end as local_time) times
  where p_kind in ('phone','makeup_start','makeup_ready')
    and p_month >= date_trunc('month',now() at time zone 'Australia/Brisbane')::date
    and p_month < (now() at time zone 'Australia/Brisbane')::date+400
  order by local_time;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_capture_consult_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 if new.consult_requested_at is not null then
  update crm_bookings set call_at=new.consult_requested_at, stage='call',
   extra=coalesce(extra,'{}') || jsonb_build_object('consultation',jsonb_build_object(
    'provider','crm','status','confirmed','autoApproved',true,'emailStatus','included_in_enquiry','startTime',new.consult_requested_at,'durationMins',30))
   where website_enquiry_id=new.id;
  update crm_reminders set kind='enquiry_review', title='Review enquiry', template_key=''
   where booking_id in (select id from crm_bookings where website_enquiry_id=new.id) and kind='reply' and status='pending';
 end if;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.crm_manage_consultation(p_booking uuid, p_actor uuid, p_action text, p_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_exception text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
 if extract(second from t)<>0 or extract(minute from t at time zone 'Australia/Brisbane')::integer % 30 <> 0 then raise exception 'Choose a 30-minute consultation window'; end if;
 if t<=now() then raise exception 'Choose a future consultation time'; end if;
 if b.event_date is null then raise exception 'Add the makeup appointment date first'; end if;
 event_at=(b.event_date + coalesce(b.start_time,b.ready_by,time '00:00')) at time zone 'Australia/Brisbane';
 if b.extra->>'calendarStart' is not null then event_at=least(event_at,(b.extra->>'calendarStart')::timestamptz); end if;
 if t+interval '30 minutes'>=event_at then raise exception 'Phone consultation must finish before the makeup appointment'; end if;
 reason=case when p_action='approve' then coalesce(nullif(btrim(p_exception),''),c->>'exceptionReason','') else btrim(p_exception) end;
 if event_at-t<interval '24 hours' then raise exception 'Schedule the phone consultation at least 24 hours before makeup'; end if;
 if exists(select 1 from crm_bookings x where x.id<>b.id and x.status<>'lost' and (
  (x.call_at is not null and x.call_logged_at is null and x.stage in ('enquiry','call') and x.call_at<t+interval '30 minutes' and x.call_at+interval '30 minutes'>t)
  or (x.stage in ('booked','day') and (
   (x.extra->>'calendarStart' is not null and x.extra->>'calendarEnd' is not null and (x.extra->>'calendarStart')::timestamptz<t+interval '30 minutes' and (x.extra->>'calendarEnd')::timestamptz>t)
   or (x.extra->>'calendarStart' is null and x.event_date=(t at time zone 'Australia/Brisbane')::date)
  )))) then raise exception 'This time conflicts with a CRM phone or makeup appointment'; end if;
 v=gen_random_uuid(); k='confirmed';
 c=jsonb_build_object('provider','crm','status',k,'startTime',t,'durationMins',30,'version',v,'exceptionReason',reason,'emailStatus','included_in_enquiry');
 if k='confirmed' then c=c||jsonb_build_object('approvedAt',now(),'approvedBy',p_actor); end if;
 update crm_bookings set call_at=t, stage=case when k='confirmed' then 'call' else 'enquiry' end,
  stage_changed_at=now(), extra=coalesce(extra,'{}')||jsonb_build_object('consultation',c), updated_at=now() where id=b.id;
 update crm_reminders set status='skipped',closed_at=now() where booking_id=b.id and kind='call' and status='pending';
 if k='confirmed' then
  insert into crm_reminders(booking_id,client_id,kind,title,due_at,template_key,channel,status) values(b.id,b.client_id,'call','Confirmed phone consultation',t,'','email','pending');
 end if;
 -- Consultation details are included in the enquiry email; no separate email is queued.
 insert into crm_activity(booking_id,client_id,user_id,type,text) values(b.id,b.client_id,p_actor,'call', 'Phone consultation '||k||' · '||t||case when reason<>'' then ' · Exception: '||reason else '' end);
 return jsonb_build_object('ok',true,'consultation',c);
end $function$
;

CREATE OR REPLACE FUNCTION public.crm_enquiry_review_reminder()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
 if new.kind='reply' then new.kind='enquiry_review'; new.title='Review enquiry'; new.template_key=null; end if;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.crm_enquiry_slot_free(slot_start timestamp with time zone, slot_end timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select not public.crm_google_calendar_conflict(slot_start, slot_end) and not exists(select 1 from public.crm_bookings b cross join lateral (
   select coalesce(nullif(b.extra->>'calendarStart','')::timestamptz,
    (b.event_date+b.start_time) at time zone 'Australia/Brisbane',
    ((b.event_date+b.ready_by) at time zone 'Australia/Brisbane')-interval '3 hours') a
 ) t where b.status <> 'lost' and (
   (t.a < slot_end and coalesce(nullif(b.extra->>'calendarEnd','')::timestamptz,t.a+interval '3 hours')
      +make_interval(mins=>coalesce((b.extra->>'calendarBufferMins')::integer,60)) > slot_start)
   or (b.call_logged_at is null and b.call_at < slot_end and b.call_at+interval '30 minutes'>slot_start)
   or (t.a is null and b.stage in ('booked','day') and (b.event_date::timestamp at time zone 'Australia/Brisbane')<slot_end
    and ((b.event_date+1)::timestamp at time zone 'Australia/Brisbane')>slot_start)
 ));
$function$
;

CREATE OR REPLACE FUNCTION public.crm_validate_chat_calendar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 if new.consult_requested_at<=now() or phone_local<>date_trunc('minute',phone_local) or extract(minute from phone_local)::integer % 30 <> 0
  or phone_local::time not between time '09:00' and time '16:30'
  or a-new.consult_requested_at<interval '24 hours'
  or not public.crm_enquiry_slot_free(new.consult_requested_at,new.consult_requested_at+interval '30 minutes') then raise exception 'ENQUIRY_PHONE_SLOT_UNAVAILABLE'; end if;
 -- Never trust browser-generated calendar boundaries or hours flags.
 new.calendar_event:=coalesce(new.calendar_event,'{}')||jsonb_build_object(
  'start',jsonb_build_object('dateTime',a,'timeZone','Australia/Brisbane'),
  'end',jsonb_build_object('dateTime',z,'timeZone','Australia/Brisbane'));
 new.viewing:=coalesce(new.viewing,'{}')||jsonb_build_object('duration_mins',m,'buffer_mins',b,
  'appointment_hours',case when extended then 'extended' else 'standard' end,'extended_hours_fee_pending',extended);
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.enquiry_calendar_slots(p_month date, p_kind text, p_service text, p_quantity integer, p_hours text DEFAULT 'standard'::text)
 RETURNS TABLE(local_start text, available boolean, duration_mins integer, buffer_mins integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 with policy as (select * from public.crm_chat_timing(p_service, p_quantity)), candidates as (
  select d + make_interval(mins => h) a, policy.duration_mins m, policy.buffer_mins b
  from generate_series(date_trunc('month', p_month::timestamp),
                       date_trunc('month', p_month::timestamp) + interval '1 month - 1 day', interval '1 day') d
  cross join generate_series(case when p_kind = 'phone' then 540 else 180 end, case when p_kind = 'phone' then 990 else 1200 end, case when p_kind = 'phone' then 30 else 60 end) h
  cross join policy
  where p_kind in ('phone', 'makeup_start', 'makeup_ready')
    and p_month >= date_trunc('month', now() at time zone 'Australia/Brisbane')::date
    and p_month < (now() at time zone 'Australia/Brisbane')::date + 400)
 select to_char(a + case when p_kind = 'makeup_ready' then make_interval(mins => m) else interval '0' end, 'YYYY-MM-DD"T"HH24:MI'),
  (a at time zone 'Australia/Brisbane') > now()
  and a + make_interval(mins => case when p_kind = 'phone' then 30 else m + b end) <= date_trunc('day', a) + interval '1 day'
  and public.crm_enquiry_slot_free(a at time zone 'Australia/Brisbane',
        (a + make_interval(mins => case when p_kind = 'phone' then 30 else m + b end)) at time zone 'Australia/Brisbane'),
  case when p_kind='phone' then 30 else m end, case when p_kind='phone' then 0 else b end
 from candidates
 where p_kind = 'phone'
    or public.crm_within_operating_hours(a, m) = (coalesce(p_hours, 'standard') <> 'extended')
 order by a;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_guard_consult_calendar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a timestamptz; z timestamptz; c jsonb; changed boolean;
begin
 if tg_op='UPDATE' and auth.role()='authenticated' and (new.extra->'consultation') is distinct from (old.extra->'consultation') then
  raise exception 'Use the owner-only consultation scheduling service';
 end if;
 changed := tg_op='INSERT';
 if tg_op='UPDATE' then changed := new.stage is distinct from old.stage or new.event_date is distinct from old.event_date or new.start_time is distinct from old.start_time or new.ready_by is distinct from old.ready_by or new.extra->>'calendarStart' is distinct from old.extra->>'calendarStart' or new.extra->>'calendarEnd' is distinct from old.extra->>'calendarEnd'; end if;
 if new.stage not in ('booked','day') or new.status='lost' or not changed then return new; end if;
 perform pg_advisory_xact_lock(hashtext('crm-consultation-calendar'));
 c=new.extra->'consultation';
 if new.call_logged_at is null or coalesce(c->>'provider','')<>'crm' or coalesce(c->>'status','')<>'confirmed' then raise exception 'Complete the confirmed phone consultation before confirming makeup'; end if;
 a=coalesce((new.extra->>'calendarStart')::timestamptz,(new.event_date+coalesce(new.start_time,new.ready_by,time '00:00')) at time zone 'Australia/Brisbane');
 z=(new.extra->>'calendarEnd')::timestamptz;
 if a is null then raise exception 'Add makeup appointment date'; end if;
 if new.call_at is null or new.call_at+interval '30 minutes'>=a then raise exception 'Consultation must finish before makeup'; end if;
 if a-new.call_at<interval '24 hours' then raise exception 'Schedule the phone consultation at least 24 hours before makeup'; end if;
 if z is not null and z<=a then raise exception 'Makeup finish must follow start'; end if;
 if exists(select 1 from crm_bookings x where x.id<>new.id and x.status<>'lost' and x.stage in ('enquiry','call') and x.call_at is not null and x.call_logged_at is null and
  (case when z is null then (x.call_at at time zone 'Australia/Brisbane')::date=new.event_date else x.call_at<z and x.call_at+interval '30 minutes'>a end)) then raise exception 'Makeup appointment conflicts with a CRM phone consultation'; end if;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.crm_google_calendar_sync(p_token text, p_busy jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_busy is not null then
    perform pg_advisory_xact_lock(hashtext('crm-consultation-calendar'));
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' or not exists (
    select 1 from public.crm_google_calendar_state
    where id and token_hash = pg_catalog.sha256(convert_to(p_token, 'UTF8')) for update
  ) then raise exception using errcode = '28000', message = 'Invalid calendar pairing key'; end if;
  if p_busy is not null then
    if jsonb_typeof(p_busy) <> 'array' then raise exception 'Expected busy intervals'; end if;
    if jsonb_array_length(p_busy) > 10000 or exists (
      select 1 from jsonb_to_recordset(p_busy) as block(start_at timestamptz, end_at timestamptz, all_day boolean)
      where block.start_at is null or block.end_at is null or block.all_day is null
        or block.start_at >= block.end_at or not isfinite(block.start_at) or not isfinite(block.end_at)
    ) then raise exception 'Invalid busy intervals'; end if;
    update public.crm_google_calendar_state set busy = (
      select coalesce(jsonb_agg(to_jsonb(block)), '[]')
      from jsonb_to_recordset(p_busy) as block(start_at timestamptz, end_at timestamptz, all_day boolean)
    ), synced_at = now() where id;
    return '{}'::jsonb;
  end if;
  return (
    with holds as (
      select b.id, b.stage, b.event_date, b.call_at, b.call_logged_at, b.extra,
        coalesce(nullif(b.extra->>'calendarStart','')::timestamptz,
          (b.event_date+b.start_time) at time zone 'Australia/Brisbane',
          ((b.event_date+b.ready_by) at time zone 'Australia/Brisbane') - interval '3 hours') as starts
      from public.crm_bookings b
      where b.status <> 'lost' and nullif(b.extra->>'archivedAt','') is null
    ), events as (
      select id::text || ':makeup' as key,
        case when stage in ('booked','day','complete') then 'Makeup appointment' else 'Makeup enquiry hold' end as title,
        coalesce(starts, event_date::timestamp at time zone 'Australia/Brisbane') as start_at,
        case when starts is null then (event_date+1)::timestamp at time zone 'Australia/Brisbane'
          else coalesce(nullif(extra->>'calendarEnd','')::timestamptz, starts+interval '3 hours')
            + make_interval(mins=>coalesce((extra->>'calendarBufferMins')::integer,60)) end as end_at,
        case when starts is null then event_date end as all_day
      from holds
      union all
      select id::text || ':phone',
        case when extra#>>'{consultation,status}' = 'confirmed' then 'Phone consult · approved' else 'Phone consult · pending' end,
        call_at, call_at+interval '30 minutes', null::date
      from holds where call_logged_at is null
    )
    select jsonb_build_object('events', coalesce(jsonb_agg(to_jsonb(events)), '[]'))
    from events where end_at > now() and start_at < now()+interval '430 days' and end_at > start_at
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_guard_google_calendar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare starts timestamptz; ends timestamptz;
  check_phone boolean := true;
  check_makeup boolean := true;
begin
  if new.status = 'lost' then return new; end if;
  if tg_op = 'UPDATE' then
    check_phone := new.call_at is distinct from old.call_at
      or new.extra#>>'{consultation,status}' is distinct from old.extra#>>'{consultation,status}';
    check_makeup := new.event_date is distinct from old.event_date
      or new.start_time is distinct from old.start_time or new.ready_by is distinct from old.ready_by
      or new.extra->>'calendarStart' is distinct from old.extra->>'calendarStart'
      or new.extra->>'calendarEnd' is distinct from old.extra->>'calendarEnd'
      or new.extra->>'calendarBufferMins' is distinct from old.extra->>'calendarBufferMins'
      or (new.stage in ('booked','day') and new.stage is distinct from old.stage)
      or old.status = 'lost';
  end if;
  if check_phone and new.call_logged_at is null
    and public.crm_google_calendar_conflict(new.call_at, new.call_at+interval '30 minutes') then
    raise exception 'Phone consultation overlaps Google Calendar busy time';
  end if;
  if check_makeup and (new.website_enquiry_id is null or nullif(new.extra->>'calendarStart','') is not null) then
    starts := coalesce(nullif(new.extra->>'calendarStart','')::timestamptz,
      (new.event_date+new.start_time) at time zone 'Australia/Brisbane',
      ((new.event_date+new.ready_by) at time zone 'Australia/Brisbane') - interval '3 hours');
    ends := coalesce(nullif(new.extra->>'calendarEnd','')::timestamptz, starts+interval '3 hours')
      + make_interval(mins=>coalesce((new.extra->>'calendarBufferMins')::integer,60));
    if starts is null then
      starts := new.event_date::timestamp at time zone 'Australia/Brisbane';
      ends := (new.event_date+1)::timestamp at time zone 'Australia/Brisbane';
    end if;
    if public.crm_google_calendar_conflict(starts, ends) then
      raise exception 'Makeup appointment overlaps Google Calendar busy time';
    end if;
  end if;
  return new;
end;
$function$
;

update public.crm_bookings set extra=coalesce(extra,'{}')||jsonb_build_object('consultation',coalesce(extra->'consultation','{}')||jsonb_build_object('provider','crm','status','confirmed','durationMins',30,'startTime',call_at,'autoApproved',true,'emailStatus','included_in_enquiry')), stage=case when stage='enquiry' then 'call' else stage end where call_at is not null and call_logged_at is null and status<>'lost' and nullif(extra->>'archivedAt','') is null;
update public.crm_reminders set title='Review enquiry' where kind='enquiry_review' and status='pending';