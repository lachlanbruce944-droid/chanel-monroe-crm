-- Allow the "open" invoice status (Stripe payment link created, awaiting payment).
alter table public.crm_invoices drop constraint crm_invoices_status_check;
alter table public.crm_invoices add constraint crm_invoices_status_check check (status = any (array['draft','sent','open','paid','void']));
