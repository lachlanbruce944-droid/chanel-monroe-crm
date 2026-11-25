// Staff creates hosted invoice links; Stripe signatures authenticate payment callbacks.
import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@18';
const CORS = {'Access-Control-Allow-Origin':'https://lachlanbruce944-droid.github.io','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info, stripe-signature','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...CORS,'Content-Type':'application/json','Cache-Control':'no-store'}});
export function amountDue(invoice:any,payments:any[]){
 const paid=payments.filter(p=>invoice.type==='deposit'?p.type==='deposit':p.type!=='deposit').reduce((n,p)=>n+Math.round(Number(p.amount)*100),0);
 const amount=Math.round(Number(invoice.total)*100)-paid;
 if(!Number.isSafeInteger(amount)||amount<50)throw Error('No payable balance of at least $0.50');
 return amount;
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:CORS});
 if(req.method!=='POST')return json({error:'POST only'},405);
 const key=Deno.env.get('STRIPE_SECRET_KEY'),secret=Deno.env.get('STRIPE_WEBHOOK_SECRET');
 const url=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 if(!key)return json({error:'Stripe invoice collection is not connected. Add STRIPE_SECRET_KEY in secure server settings.'},503);
 const mode=Deno.env.get('CRM_STRIPE_MODE');
 if((mode!=='test'||!/^sk_test_|^rk_test_/.test(key))&&(mode!=='live'||!/^sk_live_|^rk_live_/.test(key)))
  return json({error:'Stripe mode is not configured for this key'},503);
 const stripe=new Stripe(key,{httpClient:Stripe.createFetchHttpClient()});
 const admin=createClient(url,service);
 async function check(result:any){if(result.error)throw Error('Studio database update failed');return result.data;}
 async function reconcile(si:any){
  const id=si.metadata?.crmInvoiceId;if(!id)return;
  const inv=await check(await admin.from('crm_invoices').select('*').eq('id',id).single());
  if(inv.extra?.stripeInvoiceId!==si.id)throw Error('Invoice reference mismatch');
  if(si.currency!=='aud'||si.metadata?.crmBookingId!==inv.booking_id)throw Error('Invoice currency or booking mismatch');
  if(si.status==='paid'&&!si.paid_out_of_band&&si.amount_paid>0){
   await check(await admin.rpc('crm_apply_stripe_payment',{p_invoice:id,p_stripe:si.id,p_cents:si.amount_paid}));
  }
  await check(await admin.rpc('crm_set_stripe_invoice',{p_invoice:id,p_patch:{stripeStatus:si.status,stripePaymentNeedsReview:['void','uncollectible'].includes(si.status)||Boolean(si.paid_out_of_band),stripeUrl:si.hosted_invoice_url||null,stripeSyncedAt:new Date().toISOString()}}));
 }
 try{
  const signature=req.headers.get('stripe-signature');
  if(signature){
   if(!secret)return json({error:'Webhook not configured'},503);
   let event;try{event=await stripe.webhooks.constructEventAsync(await req.text(),signature,secret,undefined,Stripe.createSubtleCryptoProvider());}catch{return json({error:'Invalid webhook signature'},400)}
   if(['invoice.paid','invoice.payment_failed','invoice.voided','invoice.marked_uncollectible','invoice.updated'].includes(event.type)){
    const obj=event.data.object as any;
    if(obj.metadata?.crmInvoiceId)await reconcile(await stripe.invoices.retrieve(obj.id));
   }
   return json({received:true});
  }
  const bearer=req.headers.get('authorization')||'';
  const userClient=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:bearer}}});
  const {data:auth,error}=await userClient.auth.getUser();if(error||!auth.user)return json({error:'Sign in required'},401);
  const staff=await admin.from('crm_staff').select('user_id,role').eq('user_id',auth.user.id).maybeSingle();
  if(staff.error||!staff.data)return json({error:'Staff access required'},403);
  const body=await req.json();
  if(body.action==='status')return json({configured:true,webhookConfigured:!!secret});
  if(!['create','refresh'].includes(body.action)||typeof body.invoiceId!=='string'||!/^[0-9a-f-]{36}$/i.test(body.invoiceId))return json({error:'Invalid invoice request'},400);
  const inv=await check(await admin.from('crm_invoices').select('*').eq('id',body.invoiceId).single());
  const b=await check(await admin.from('crm_bookings').select('*').eq('id',inv.booking_id).single());
  if(b.status==='lost')return json({error:'Reopen the booking before collecting payment'},409);
  let si:any;
  if(inv.extra?.stripeInvoiceId){
   si=await stripe.invoices.retrieve(inv.extra.stripeInvoiceId);
  }else{
   if(body.action==='refresh')return json({error:'Create the Stripe invoice link first'},409);
   if(inv.status==='paid')return json({error:'Invoice is already paid'},409);
   if(staff.data.role!=='owner')return json({error:'Only the owner can approve an invoice'},403);
   const {data:approval,error:approvalError}=await admin.rpc('crm_approve_stripe_invoice',
     {p_invoice:inv.id,p_actor:auth.user.id,p_review:body.approval??null});
   if(approvalError)return json({error:'Invoice could not be approved. Refresh the booking and review the invoice again.'},409);
   const amount=approval.amountCents;
   const dueAt=Math.floor(Date.parse(approval.dueAt+'T23:59:59+10:00')/1000);
   const client=await check(await admin.from('crm_clients').select('first_name,last_name').eq('id',inv.client_id).single());
   const customer=await stripe.customers.create({email:approval.email,name:[client.first_name,client.last_name].filter(Boolean).join(' '),metadata:{crmClientId:client.id}},{idempotencyKey:'crm-customer-'+inv.id});
   si=await stripe.invoices.create({customer:customer.id,collection_method:'send_invoice',due_date:dueAt,auto_advance:false,pending_invoice_items_behavior:'exclude',currency:'aud',description:`Chanel Monroe · ${inv.number} · ${inv.type==='deposit'?'booking deposit':'final balance'}`,metadata:{crmInvoiceId:inv.id,crmBookingId:inv.booking_id,crmAmountCents:String(amount),crmApproval:'v1'},payment_settings:{payment_method_types:['card']}},{idempotencyKey:'crm-invoice-'+inv.id});
   await check(await admin.rpc('crm_set_stripe_invoice',{p_invoice:inv.id,p_patch:{stripeInvoiceId:si.id,stripeAmountCents:amount,stripeStatus:si.status}}));
  }
  if(si.status==='draft'){
   const amount=Number(si.metadata.crmAmountCents);
   if(!Number.isSafeInteger(amount)||amount<50)throw Error('Invalid invoice amount');
   if(si.metadata.crmApproval==='v1'){
    const {snapshot}=await check(await admin.from('crm_stripe_approvals').select('snapshot').eq('invoice_id',inv.id).single());
    const lines=snapshot.items.map((item:any)=>({amount:Math.round(Number(item.qty)*Number(item.price)*100),
      description:`${item.desc}${item.qty>1?' × '+item.qty:''}`.slice(0,500)}));
    const adjustment=amount-lines.reduce((sum:number,item:any)=>sum+item.amount,0);
    if(adjustment)lines.push({amount:adjustment,description:'Balance adjustment and credits'});
    if(lines.length>250 || lines.some((line:any)=>!Number.isSafeInteger(line.amount)))throw Error('Invalid invoice items');
    for(const [index,line] of lines.entries()){
     if(!line.amount)continue;
     await stripe.invoiceItems.create({customer:String(si.customer),invoice:si.id,currency:'aud',...line},
      {idempotencyKey:`crm-line-${inv.id}-${index}`});
    }
    const draft=await stripe.invoices.retrieve(si.id);
    if(draft.total!==amount)throw Error('Reviewed amount does not match the Stripe draft');
   }else{
    await stripe.invoiceItems.create({customer:String(si.customer),invoice:si.id,currency:'aud',amount,
      description:`${inv.number} — ${inv.type==='deposit'?'deposit':'remaining balance'}`},{idempotencyKey:'crm-line-'+inv.id});
   }
   si=await stripe.invoices.finalizeInvoice(si.id,{auto_advance:false},{idempotencyKey:'crm-finalize-'+inv.id});
  }
  await reconcile(si);
  return json({ok:true,status:si.status,url:si.hosted_invoice_url||null});
 }catch(e){console.error(e instanceof Error?e.name:'Stripe error');return json({error:e instanceof Error&&/Studio database|reference mismatch|currency or booking|payable balance|Invalid invoice/.test(e.message)?e.message:'Stripe could not complete the request. Check the secure connection and retry.'},502)}
});
