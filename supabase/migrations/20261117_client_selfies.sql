-- Staff may view enquiry selfies through short-lived signed URLs. No public read access.
drop policy if exists "CRM staff can read enquiry selfies" on storage.objects;
create policy "CRM staff can read enquiry selfies" on storage.objects
for select to authenticated using (bucket_id = 'selfies' and public.is_crm_staff());
