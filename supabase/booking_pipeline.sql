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
 event_at=(b.event_date + coalesce(b.start_time,b.ready_by,time '00:00')) at time zone 'Australia/Brisbane';
 if b.extra->>'calendarStart' is not null then event_at=least(event_at,(b.extra->>'calendarStart')::timestamptz); end if;
 if t+interval '15 minutes'>=event_at then raise exception 'Phone consultation must finish before the makeup appointment'; end if;
 reason=case when p_action='approve' then coalesce(nullif(btrim(p_exception),''),c->>'exceptionReason','') else btrim(p_exception) end;
 if event_at-t<interval '3 days' and length(reason)<5 then raise exception 'Consultations normally need three days before makeup. Record Chanel’s short-notice exception reason'; end if;
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
end $$;
revoke all on function public.crm_manage_consultation(uuid,uuid,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.crm_manage_consultation(uuid,uuid,text,timestamptz,text) to service_role;


update storage.buckets set allowed_mime_types = array['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime'] where id='crm-photos';
