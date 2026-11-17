-- Lease serialises CRM calendar writes; no tokens or provider secrets are stored here.
create or replace function public.crm_connector_calendar_lock(p_token uuid,p_release boolean default false)
returns boolean language plpgsql security definer set search_path=public as $$
declare current_lock jsonb;
begin
 insert into crm_settings(id,value) values('connectorCalendarLock','{}'::jsonb) on conflict(id) do nothing;
 select value into current_lock from crm_settings where id='connectorCalendarLock' for update;
 if p_release then
  if current_lock->>'token' = p_token::text then update crm_settings set value='{}'::jsonb where id='connectorCalendarLock'; return true; end if;
  return false;
 end if;
 if coalesce((current_lock->>'expires')::timestamptz,'epoch') > now() then return false; end if;
 update crm_settings set value=jsonb_build_object('token',p_token,'expires',now()+interval '5 minutes') where id='connectorCalendarLock';
 return true;
end $$;
revoke all on function public.crm_connector_calendar_lock(uuid,boolean) from public,anon,authenticated;
grant execute on function public.crm_connector_calendar_lock(uuid,boolean) to service_role;
