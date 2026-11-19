create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret(replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),
  'crm_apple_calendar_worker_key')
where not exists (select 1 from vault.secrets where name='crm_apple_calendar_worker_key');

create or replace function public.crm_apple_worker_authorized(candidate text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from vault.decrypted_secrets
    where name='crm_apple_calendar_worker_key' and decrypted_secret=candidate);
$$;
revoke all on function public.crm_apple_worker_authorized(text) from public, anon, authenticated;
grant execute on function public.crm_apple_worker_authorized(text) to service_role;

select cron.schedule('crm-apple-calendar-sync','* * * * *',$job$
  select net.http_post(
    url := 'https://qxiugfatpybldluipcyy.supabase.co/functions/v1/crm-connectors',
    headers := jsonb_build_object('Content-Type','application/json','x-crm-calendar-worker',decrypted_secret),
    timeout_milliseconds := 55000)
  from vault.decrypted_secrets where name='crm_apple_calendar_worker_key';
$job$);
