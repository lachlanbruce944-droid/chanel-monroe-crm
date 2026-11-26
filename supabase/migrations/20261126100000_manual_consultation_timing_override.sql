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
 if new.call_at is null or (coalesce(c#>>'{schedulingOverride,confirmed}','false')<>'true' and new.call_at+interval '30 minutes'>=a) then raise exception 'Consultation must finish before makeup'; end if;
 if coalesce(c#>>'{schedulingOverride,confirmed}','false')<>'true' and a-new.call_at<interval '24 hours' then raise exception 'Schedule the phone consultation at least 24 hours before makeup'; end if;
 if z is not null and z<=a then raise exception 'Makeup finish must follow start'; end if;
 if exists(select 1 from crm_bookings x where x.id<>new.id and x.status<>'lost' and x.stage in ('enquiry','call') and x.call_at is not null and x.call_logged_at is null and
  (case when z is null then (x.call_at at time zone 'Australia/Brisbane')::date=new.event_date else x.call_at<z and x.call_at+interval '30 minutes'>a end)) then raise exception 'Makeup appointment conflicts with a CRM phone consultation'; end if;
 return new;
end $function$
;

drop function public.crm_manage_consultation(uuid,uuid,text,timestamptz,text);

CREATE OR REPLACE FUNCTION public.crm_manage_consultation(p_booking uuid, p_actor uuid, p_action text, p_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_exception text DEFAULT ''::text, p_override boolean DEFAULT false)
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
 if not p_override and (extract(second from t)<>0 or extract(minute from t at time zone 'Australia/Brisbane')::integer % 30 <> 0) then raise exception 'Choose a 30-minute consultation window'; end if;
 if not p_override and t<=now() then raise exception 'Choose a future consultation time'; end if;
 if not p_override and b.event_date is null then raise exception 'Add the makeup appointment date first'; end if;
 event_at=(b.event_date + coalesce(b.start_time,b.ready_by,time '00:00')) at time zone 'Australia/Brisbane';
 if b.extra->>'calendarStart' is not null then event_at=least(event_at,(b.extra->>'calendarStart')::timestamptz); end if;
 if not p_override and t+interval '30 minutes'>=event_at then raise exception 'Phone consultation must finish before the makeup appointment'; end if;
 reason=case when p_action='approve' then coalesce(nullif(btrim(p_exception),''),c->>'exceptionReason','') else btrim(p_exception) end;
 if not p_override and event_at-t<interval '24 hours' then raise exception 'Schedule the phone consultation at least 24 hours before makeup'; end if;
 if exists(select 1 from crm_bookings x where x.id<>b.id and x.status<>'lost' and (
  (x.call_at is not null and x.call_logged_at is null and x.stage in ('enquiry','call') and x.call_at<t+interval '30 minutes' and x.call_at+interval '30 minutes'>t)
  or (x.stage in ('booked','day') and (
   (x.extra->>'calendarStart' is not null and x.extra->>'calendarEnd' is not null and (x.extra->>'calendarStart')::timestamptz<t+interval '30 minutes' and (x.extra->>'calendarEnd')::timestamptz>t)
   or (x.extra->>'calendarStart' is null and x.event_date=(t at time zone 'Australia/Brisbane')::date)
  )))) then raise exception 'This time conflicts with a CRM phone or makeup appointment'; end if;
 if p_override and nullif(btrim(p_exception),'') is null then raise exception 'Add a reason for the date/time override'; end if;
 v=gen_random_uuid(); k='confirmed';
 c=jsonb_build_object('provider','crm','status',k,'startTime',t,'durationMins',30,'version',v,'exceptionReason',reason,'emailStatus','included_in_enquiry');
 if p_override then c=c||jsonb_build_object('schedulingOverride',jsonb_build_object('confirmed',true,'reason',btrim(p_exception),'actor',p_actor,'at',now())); end if;
 if k='confirmed' then c=c||jsonb_build_object('approvedAt',now(),'approvedBy',p_actor); end if;
 update crm_bookings set call_at=t, stage=case when k='confirmed' then 'call' else 'enquiry' end,
  stage_changed_at=now(), extra=coalesce(extra,'{}')||jsonb_build_object('consultation',c), updated_at=now() where id=b.id;
 update crm_reminders set status='skipped',closed_at=now() where booking_id=b.id and kind='call' and status='pending';
 if k='confirmed' and t>now() then
  insert into crm_reminders(booking_id,client_id,kind,title,due_at,template_key,channel,status) values(b.id,b.client_id,'call','Confirmed phone consultation',t,'','email','pending');
 end if;
 -- Consultation details are included in the enquiry email; no separate email is queued.
 insert into crm_activity(booking_id,client_id,user_id,type,text) values(b.id,b.client_id,p_actor,'call', case when p_override then 'Date/time override · ' else '' end||'Phone consultation '||k||' · '||t||case when reason<>'' then ' · Exception: '||reason else '' end);
 return jsonb_build_object('ok',true,'consultation',c);
end $function$
;

revoke all on function public.crm_manage_consultation(uuid,uuid,text,timestamptz,text,boolean) from public, anon, authenticated;
grant execute on function public.crm_manage_consultation(uuid,uuid,text,timestamptz,text,boolean) to service_role;