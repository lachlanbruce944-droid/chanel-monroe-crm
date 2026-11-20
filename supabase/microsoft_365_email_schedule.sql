-- Run only after Microsoft setup and explicit enablement in CRM Settings.
-- Requires pg_cron, pg_net and Vault. Create Vault secret crm_m365_sync_key
-- with the same random value as Edge Function secret M365_SYNC_KEY.
-- No real credential belongs in this tracked file.
select cron.schedule(
 'crm-microsoft-365-inbox',
 '*/5 * * * *',
 $job$select net.http_post(
   url := 'https://qxiugfatpybldluipcyy.supabase.co/functions/v1/crm-email',
   headers := jsonb_build_object('Content-Type','application/json',
     'x-crm-mail-key',(select decrypted_secret from vault.decrypted_secrets where name='crm_m365_sync_key')),
   body := '{"action":"sync"}'::jsonb,
   timeout_milliseconds := 60000
 );$job$
);
-- Pause fully: select cron.unschedule('crm-microsoft-365-inbox');
