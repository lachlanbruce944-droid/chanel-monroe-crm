
-- Microsoft 365 inbox connector. Disabled until owner completes configuration.
create table if not exists public.crm_mail_connector (
 id boolean primary key default true check(id),
 mailbox text not null default 'makeup@chanelmonroe.net',
 tenant_id text, client_id text, enabled boolean not null default false,
 sync_from timestamptz not null default now(), cursor text,
 last_sync_at timestamptz, last_error text, lock_until timestamptz, lock_token uuid,
 updated_at timestamptz not null default now()
);
alter table public.crm_mail_connector enable row level security;
revoke all on public.crm_mail_connector from public,anon,authenticated;
grant all on public.crm_mail_connector to service_role;
insert into public.crm_mail_connector(id) values(true) on conflict do nothing;

create table if not exists public.crm_email_messages (
 id uuid primary key default gen_random_uuid(),
 mailbox text not null, graph_id text not null, message_key text not null,
 conversation_id text, sender text not null, subject text not null default '',
 body_text text not null default '', web_link text, received_at timestamptz not null,
 attachments jsonb not null default '[]'::jsonb,
 client_id uuid references public.crm_clients(id) on delete set null,
 booking_id uuid references public.crm_bookings(id) on delete set null,
 match_reason text not null default 'needs_review',
 reviewed_at timestamptz, reviewed_by uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(mailbox,message_key)
);
create index if not exists crm_email_messages_booking_idx on public.crm_email_messages(booking_id,received_at desc);
create index if not exists crm_email_messages_thread_idx on public.crm_email_messages(mailbox,conversation_id);
alter table public.crm_email_messages enable row level security;
revoke all on public.crm_email_messages from public,anon,authenticated;
grant select on public.crm_email_messages to authenticated;
grant all on public.crm_email_messages to service_role;
create policy crm_email_staff_read on public.crm_email_messages for select to authenticated
 using (exists(select 1 from public.crm_staff where user_id=(select auth.uid())));

-- Atomic deduplication, matching and pipeline notification. No booking fields are overwritten.
create or replace function public.crm_mail_ingest(p_message jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
 v_id uuid; v_booking uuid; v_client uuid; v_count integer; v_reason text:='needs_review';
 v_sender text:=lower(trim(p_message->>'sender'));
 v_ref text; v_candidates uuid[]; v_clients uuid[];
begin
 perform pg_advisory_xact_lock(hashtextextended('crm-mail:'||(p_message->>'mailbox')||':'||(p_message->>'message_key'),0));
 if exists(select 1 from crm_email_messages where mailbox=p_message->>'mailbox' and message_key=p_message->>'message_key')
 then return jsonb_build_object('duplicate',true); end if;
 select array_agg(id) into v_clients from crm_clients where lower(trim(email))=v_sender;
 if coalesce(array_length(v_clients,1),0)=0 then return jsonb_build_object('skipped',true); end if;
 if array_length(v_clients,1)=1 then v_client:=v_clients[1]; end if;
 v_ref:=substring(p_message->>'subject' from '\[CRM:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]');
 if v_ref is not null then
  select id,client_id into v_booking,v_client from crm_bookings
   where (id=v_ref::uuid or website_enquiry_id=v_ref::uuid) and client_id=any(v_clients) limit 1;
  if v_booking is not null then v_reason:='reference'; end if;
 end if;
 if v_booking is null and nullif(p_message->>'conversation_id','') is not null then
  select array_agg(distinct m.booking_id) into v_candidates from crm_email_messages m
   join crm_bookings b on b.id=m.booking_id
   where m.mailbox=p_message->>'mailbox' and m.conversation_id=p_message->>'conversation_id'
   and b.client_id=any(v_clients);
  if array_length(v_candidates,1)=1 then v_booking:=v_candidates[1];v_reason:='thread';end if;
 end if;
 if v_booking is null then
  select array_agg(id) into v_candidates from crm_bookings
   where client_id=any(v_clients) and status='open' and stage<>'complete';
  if array_length(v_candidates,1)=1 then v_booking:=v_candidates[1];v_reason:='single_open_enquiry';end if;
 end if;
 if v_booking is not null then select client_id into v_client from crm_bookings where id=v_booking;end if;
 insert into crm_email_messages(mailbox,graph_id,message_key,conversation_id,sender,subject,body_text,web_link,received_at,attachments,client_id,booking_id,match_reason)
 values(p_message->>'mailbox',p_message->>'graph_id',p_message->>'message_key',p_message->>'conversation_id',
 v_sender,left(p_message->>'subject',1000),left(p_message->>'body_text',100000),
 p_message->>'web_link',(p_message->>'received_at')::timestamptz,coalesce(p_message->'attachments','[]'::jsonb),v_client,v_booking,v_reason)
 returning id into v_id;
 if v_booking is not null then
  insert into crm_activity(booking_id,client_id,type,text,extra)
   values(v_booking,v_client,'client_email','New client email: '||left(p_message->>'subject',200),jsonb_build_object('emailId',v_id));
  insert into crm_reminders(booking_id,client_id,kind,title,due_at,channel,extra)
   values(v_booking,v_client,'client_email','Review new client details',now(),'email',jsonb_build_object('emailId',v_id));
 end if;
 return jsonb_build_object('id',v_id,'matched',v_booking is not null);
end $$;
revoke all on function public.crm_mail_ingest(jsonb) from public,anon,authenticated;
grant execute on function public.crm_mail_ingest(jsonb) to service_role;

create or replace function public.crm_mail_review(p_message uuid,p_booking uuid,p_user uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare m crm_email_messages; b crm_bookings;
begin
 if not exists(select 1 from crm_staff where user_id=p_user and role='owner') then raise exception 'Owner access required';end if;
 select * into m from crm_email_messages where id=p_message for update;
 if not found then raise exception 'Message not found';end if;
 if p_booking is not null then
  select * into b from crm_bookings where id=p_booking;
  if not found then raise exception 'Booking not found';end if;
  if m.booking_id is not null and m.booking_id<>b.id then raise exception 'Already linked to another enquiry';end if;
  if m.booking_id is null then
   update crm_email_messages set booking_id=b.id,client_id=b.client_id,match_reason='owner_linked' where id=m.id;
   insert into crm_activity(booking_id,client_id,user_id,type,text,extra)
    values(b.id,b.client_id,p_user,'client_email','Client email linked by Chanel: '||left(m.subject,200),jsonb_build_object('emailId',m.id));
  end if;
 end if;
 update crm_email_messages set reviewed_at=now(),reviewed_by=p_user,updated_at=now() where id=m.id;
 update crm_reminders set status='done',closed_at=now(),updated_at=now()
  where kind='client_email' and extra->>'emailId'=m.id::text and status='pending';
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.crm_mail_review(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.crm_mail_review(uuid,uuid,uuid) to service_role;
