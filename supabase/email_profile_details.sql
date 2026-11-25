-- Save a reviewed excerpt to an existing matched client's profile and audit it atomically.
create or replace function public.crm_mail_save_profile(p_message uuid,p_field text,p_details text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare m crm_email_messages; c crm_clients; details text:=btrim(p_details); old_value text; new_value text;
begin
 if auth.uid() is null or not exists(select 1 from crm_staff where user_id=auth.uid() and role='owner') then
  raise exception 'Owner access required';
 end if;
 if p_field is null or p_field not in ('notes','allergies','shades') then raise exception 'Choose a supported profile field';end if;
 if details is null or length(details)=0 or length(details)>10000 then raise exception 'Enter between 1 and 10000 characters';end if;
 select * into m from crm_email_messages where id=p_message;
 if not found or m.client_id is null then raise exception 'Link this message to an enquiry before saving profile details';end if;
 select * into c from crm_clients where id=m.client_id for update;
 if not found then raise exception 'Client not found';end if;
 if exists(select 1 from crm_activity where client_id=c.id and type='email_profile_detail'
   and extra->>'emailId'=m.id::text and extra->>'field'=p_field and extra->>'details'=details) then
  return jsonb_build_object('ok',true,'duplicate',true);
 end if;
 old_value:=case p_field when 'notes' then c.notes when 'allergies' then c.allergies when 'shades' then c.shades end;
 new_value:=concat_ws(E'\n\n',nullif(old_value,''),details||E'\n[Client email: '||m.sender||' · '||to_char(m.received_at at time zone 'Australia/Brisbane','DD Mon YYYY HH24:MI')||' AEST · '||left(m.subject,200)||']');
 update crm_clients set notes=case when p_field='notes' then new_value else notes end,
  allergies=case when p_field='allergies' then new_value else allergies end,
  shades=case when p_field='shades' then new_value else shades end,updated_at=now() where id=c.id;
 insert into crm_activity(booking_id,client_id,user_id,type,text,extra)
 values(m.booking_id,c.id,auth.uid(),'email_profile_detail','Saved client email details to '||p_field,
 jsonb_build_object('emailId',m.id,'field',p_field,'details',details));
 return jsonb_build_object('ok',true,'clientId',c.id);
end $$;
revoke all on function public.crm_mail_save_profile(uuid,text,text) from public,anon;
grant execute on function public.crm_mail_save_profile(uuid,text,text) to authenticated;
