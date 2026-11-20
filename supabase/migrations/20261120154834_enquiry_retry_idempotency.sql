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
