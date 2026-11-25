CREATE OR REPLACE FUNCTION public.crm_guard_consult_calendar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a timestamptz; z timestamptz; c jsonb; changed boolean;
begin
 if tg_op='UPDATE' and auth.role()='authenticated' and (new.extra->'consultation') is distinct from (old.extra->'consultation') then
  raise exception 'Use the owner-only consultation approval service';
 end if;
 changed := tg_op='INSERT';
 if tg_op='UPDATE' then changed := new.stage is distinct from old.stage or new.event_date is distinct from old.event_date or new.start_time is distinct from old.start_time or new.ready_by is distinct from old.ready_by or new.extra->>'calendarStart' is distinct from old.extra->>'calendarStart' or new.extra->>'calendarEnd' is distinct from old.extra->>'calendarEnd'; end if;
 if new.stage not in ('booked','day') or new.status='lost' or not changed then return new; end if;
 perform pg_advisory_xact_lock(hashtext('crm-consultation-calendar'));
 c=new.extra->'consultation';
 if new.call_logged_at is null or coalesce(c->>'provider','')<>'crm' or coalesce(c->>'status','')<>'confirmed' then raise exception 'Complete the CRM-approved phone consultation before confirming makeup'; end if;
 a=coalesce((new.extra->>'calendarStart')::timestamptz,(new.event_date+coalesce(new.start_time,new.ready_by,time '00:00')) at time zone 'Australia/Brisbane');
 z=(new.extra->>'calendarEnd')::timestamptz;
 if a is null then raise exception 'Add makeup appointment date'; end if;
 if new.call_at is null or new.call_at+interval '15 minutes'>=a then raise exception 'Consultation must finish before makeup'; end if;
 if a-new.call_at<interval '24 hours' then raise exception 'Schedule the phone consultation at least 24 hours before makeup'; end if;
 if z is not null and z<=a then raise exception 'Makeup finish must follow start'; end if;
 if exists(select 1 from crm_bookings x where x.id<>new.id and x.status<>'lost' and x.stage in ('enquiry','call') and x.call_at is not null and x.call_logged_at is null and
  (case when z is null then (x.call_at at time zone 'Australia/Brisbane')::date=new.event_date else x.call_at<z and x.call_at+interval '15 minutes'>a end)) then raise exception 'Makeup appointment conflicts with a CRM phone consultation'; end if;
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
 if t<=now() then raise exception 'Choose a future consultation time'; end if;
 if b.event_date is null then raise exception 'Add the makeup appointment date first'; end if;
 event_at=(b.event_date + coalesce(b.start_time,b.ready_by,time '00:00')) at time zone 'Australia/Brisbane';
 if b.extra->>'calendarStart' is not null then event_at=least(event_at,(b.extra->>'calendarStart')::timestamptz); end if;
 if t+interval '15 minutes'>=event_at then raise exception 'Phone consultation must finish before the makeup appointment'; end if;
 reason=case when p_action='approve' then coalesce(nullif(btrim(p_exception),''),c->>'exceptionReason','') else btrim(p_exception) end;
 if event_at-t<interval '24 hours' then raise exception 'Schedule the phone consultation at least 24 hours before makeup'; end if;
 if exists(select 1 from crm_bookings x where x.id<>b.id and x.status<>'lost' and (
  (x.call_at is not null and x.call_logged_at is null and x.stage in ('enquiry','call') and x.call_at<t+interval '15 minutes' and x.call_at+interval '15 minutes'>t)
  or (x.stage in ('booked','day') and (
   (x.extra->>'calendarStart' is not null and x.extra->>'calendarEnd' is not null and (x.extra->>'calendarStart')::timestamptz<t+interval '15 minutes' and (x.extra->>'calendarEnd')::timestamptz>t)
   or (x.extra->>'calendarStart' is null and x.event_date=(t at time zone 'Australia/Brisbane')::date)
  )))) then raise exception 'This time conflicts with a CRM phone or makeup appointment'; end if;
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
end $function$
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
 if new.consult_requested_at<=now() or phone_local<>date_trunc('hour',phone_local)
  or phone_local::time not between time '09:00' and time '16:00'
  or a-new.consult_requested_at<interval '24 hours'
  or not public.crm_enquiry_slot_free(new.consult_requested_at,new.consult_requested_at+interval '15 minutes') then raise exception 'ENQUIRY_PHONE_SLOT_UNAVAILABLE'; end if;
 -- Never trust browser-generated calendar boundaries or hours flags.
 new.calendar_event:=coalesce(new.calendar_event,'{}')||jsonb_build_object(
  'start',jsonb_build_object('dateTime',a,'timeZone','Australia/Brisbane'),
  'end',jsonb_build_object('dateTime',z,'timeZone','Australia/Brisbane'));
 new.viewing:=coalesce(new.viewing,'{}')||jsonb_build_object('duration_mins',m,'buffer_mins',b,
  'appointment_hours',case when extended then 'extended' else 'standard' end,'extended_hours_fee_pending',extended);
 return new;
end $function$
;
