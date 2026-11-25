create table public.crm_stripe_approvals (
  invoice_id uuid primary key references public.crm_invoices(id),
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  snapshot jsonb not null
);
alter table public.crm_stripe_approvals enable row level security;
revoke all on public.crm_stripe_approvals from public, anon, authenticated;
grant select on public.crm_stripe_approvals to service_role;

create or replace function public.crm_approve_stripe_invoice(p_invoice uuid,p_actor uuid,p_review jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare inv public.crm_invoices%rowtype; client_email text; approved jsonb; paid bigint; cents bigint;
begin
  if not exists (select 1 from public.crm_staff where user_id=p_actor and role='owner') then
    raise exception 'Billing approval requires the owner';
  end if;
  select * into strict inv from public.crm_invoices where id=p_invoice for update;
  select snapshot into approved from public.crm_stripe_approvals where invoice_id=p_invoice;
  if found then return approved; end if;
  if inv.status in ('paid','void') or not exists (
    select 1 from public.crm_bookings b where b.id=inv.booking_id and b.status<>'lost'
      and ((inv.type='deposit' and b.stage='deposit') or (inv.type='final' and b.stage='invoice'))
  ) then raise exception 'Invoice is not ready for approval'; end if;
  select email into strict client_email from public.crm_clients where id=inv.client_id;
  select coalesce(sum(round(p.amount*100)),0)::bigint into paid from public.crm_payments p
    where p.booking_id=inv.booking_id and (p.type='deposit')=(inv.type='deposit');
  cents := round(inv.total*100)::bigint-paid;
  approved := jsonb_build_object('email',client_email,'items',inv.items,'amountCents',cents,'dueAt',inv.due_at);
  if p_review is distinct from approved or nullif(client_email,'') is null or cents<50 or inv.due_at is null then
    raise exception 'Invoice changed. Review it again before approving.';
  end if;
  insert into public.crm_stripe_approvals(invoice_id,approved_by,snapshot) values(p_invoice,p_actor,approved);
  update public.crm_invoices set extra=coalesce(extra,'{}')||'{"approvalLocked":true}'::jsonb
    where id=p_invoice;
  return approved;
end $$;

revoke all on function public.crm_approve_stripe_invoice(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.crm_approve_stripe_invoice(uuid,uuid,jsonb) to service_role;

create or replace function public.crm_guard_approved_invoice()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.crm_stripe_approvals a where a.invoice_id=old.id) then return new; end if;
  if (new.booking_id,new.client_id,new.type,new.items,new.total,new.due_at)
    is distinct from (old.booking_id,old.client_id,old.type,old.items,old.total,old.due_at)
  then raise exception 'An approved invoice cannot be edited. Reconcile it before issuing a revision.'; end if;
  new.extra=coalesce(new.extra,'{}')||'{"approvalLocked":true}'::jsonb;
  return new;
end $$;

create trigger crm_guard_approved_invoice before update on public.crm_invoices
for each row execute function public.crm_guard_approved_invoice();
revoke all on function public.crm_guard_approved_invoice() from public, anon, authenticated;

-- Reconcile the exact linked invoice. Its reviewed amount already accounts for prior credits.
create or replace function public.crm_apply_stripe_payment(p_invoice uuid,p_stripe text,p_cents bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare inv public.crm_invoices%rowtype; existing public.crm_payments%rowtype; approved jsonb;
begin
  select * into strict inv from public.crm_invoices where id=p_invoice for update;
  if inv.extra->>'stripeInvoiceId' is distinct from p_stripe then raise exception 'Stripe invoice mismatch'; end if;
  if p_cents is null or p_cents<=0 or p_cents is distinct from (inv.extra->>'stripeAmountCents')::bigint then
    raise exception 'Stripe amount mismatch';
  end if;
  select snapshot into approved from public.crm_stripe_approvals where invoice_id=inv.id;
  if approved is not null and p_cents is distinct from (approved->>'amountCents')::bigint then
    raise exception 'Payment differs from the approved invoice';
  end if;
  select * into existing from public.crm_payments where extra->>'stripeInvoiceId'=p_stripe;
  if not found then
    insert into public.crm_payments(booking_id,client_id,type,amount,method,paid_at,reference,extra)
      values(inv.booking_id,inv.client_id,case when inv.type='deposit' then 'deposit' else 'final' end,
        p_cents::numeric/100,'Stripe / online',current_date,p_stripe,
        jsonb_build_object('stripeInvoiceId',p_stripe,'invoiceId',p_invoice));
    insert into public.crm_activity(booking_id,client_id,type,text)
      values(inv.booking_id,inv.client_id,'payment','Stripe payment received for invoice '||inv.number);
  elsif round(existing.amount*100)<>p_cents or existing.extra->>'invoiceId' is distinct from p_invoice::text then
    raise exception 'Recorded payment differs; review required';
  end if;
  update public.crm_invoices set status='paid',paid_at=coalesce(paid_at,current_date),updated_at=now()
    where id=inv.id and status not in ('paid','void');
end $$;
revoke all on function public.crm_apply_stripe_payment(uuid,text,bigint) from public, anon, authenticated;
grant execute on function public.crm_apply_stripe_payment(uuid,text,bigint) to service_role;
