-- Apply before deploying the new enquiry page. Both repositories use the same Supabase project.
alter table public.enquiries add column if not exists consult_requested_at timestamptz;
create table if not exists public.crm_consultation_emails (
 id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.crm_bookings(id),
 version uuid not null, kind text not null check (kind in ('pending','confirmed')), start_at timestamptz not null,
 sent_at timestamptz, created_at timestamptz not null default now(), unique(booking_id,version,kind)
);
alter table public.crm_consultation_emails enable row level security;
revoke all on public.crm_consultation_emails from anon, authenticated;

create or replace function public.crm_capture_consult_request() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.consult_requested_at is not null then
  update crm_bookings set call_at=new.consult_requested_at,
   extra=coalesce(extra,'{}') || jsonb_build_object('consultation',jsonb_build_object(
    'provider','crm','status','pending','startTime',new.consult_requested_at,'durationMins',15))
   where website_enquiry_id=new.id;
  update crm_reminders set kind='enquiry_review', title='Review enquiry and approve phone consultation', template_key=''
   where booking_id in (select id from crm_bookings where website_enquiry_id=new.id) and kind='reply' and status='pending';
 end if;
 return new;
end $$;
drop trigger if exists zzzz_crm_consult_request on public.enquiries;
create trigger zzzz_crm_consult_request after insert on public.enquiries for each row execute function public.crm_capture_consult_request();

-- Serialized scheduling and approval; never trusts the browser's approval flags.
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
 if p_action='approve' and b.extra->>'enquiryReviewedAt' is null then raise exception 'Review the enquiry first'; end if;
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

-- Retire old Cal mutation path even if an old browser tab still has the previous app.
create or replace function public.crm_link_consultation(p_enquiry uuid,p_consultation jsonb) returns void
language plpgsql security definer set search_path=public as $$ begin raise exception 'Cal.com has been retired. Approve in the CRM calendar'; end $$;

-- Both phone scheduling and makeup confirmation share this lock so concurrent saves cannot double-book.
create or replace function public.crm_guard_consult_calendar() returns trigger
language plpgsql security definer set search_path=public as $$
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
 if a-new.call_at<interval '3 days' and length(coalesce(c->>'exceptionReason',''))<5 then raise exception 'Record Chanel’s short-notice exception reason'; end if;
 if z is not null and z<=a then raise exception 'Makeup finish must follow start'; end if;
 if exists(select 1 from crm_bookings x where x.id<>new.id and x.status<>'lost' and x.stage in ('enquiry','call') and x.call_at is not null and x.call_logged_at is null and
  (case when z is null then (x.call_at at time zone 'Australia/Brisbane')::date=new.event_date else x.call_at<z and x.call_at+interval '15 minutes'>a end)) then raise exception 'Makeup appointment conflicts with a CRM phone consultation'; end if;
 return new;
end $$;
drop trigger if exists crm_guard_consult_calendar on public.crm_bookings;
create trigger crm_guard_consult_calendar before insert or update on public.crm_bookings for each row execute function public.crm_guard_consult_calendar();

create or replace function public.crm_consult_email_status(p_booking uuid,p_version uuid,p_status text) returns void
language sql security definer set search_path=public as $$
 update crm_bookings set extra=jsonb_set(extra,'{consultation,emailStatus}',to_jsonb(p_status))
 where id=p_booking and extra->'consultation'->>'version'=p_version::text;
$$;
revoke all on function public.crm_consult_email_status(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.crm_consult_email_status(uuid,uuid,text) to service_role;

-- Trigger-only functions are not public RPC entry points.
revoke all on function public.crm_capture_consult_request() from public, anon, authenticated;
revoke all on function public.crm_guard_consult_calendar() from public, anon, authenticated;
