// Staff creates hosted invoice links; Stripe signatures authenticate payment callbacks.
import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@18';
const ORIGINS = ['https://chanelmonroe.net','https://www.chanelmonroe.net','https://lachlanbruce944-droid.github.io'];
const corsFor=(origin:string):Record<string,string>=>({'Access-Control-Allow-Origin':ORIGINS.includes(origin)?origin:ORIGINS[0],'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info, stripe-signature','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'});
export function amountDue(invoice:any,payments:any[]){
 const paid=payments.filter(p=>invoice.type==='deposit'?p.type==='deposit':p.type!=='deposit').reduce((n,p)=>n+Math.round(Number(p.amount)*100),0);
 const amount=Math.round(Number(invoice.total)*100)-paid;
 if(!Number.isSafeInteger(amount)||amount<50)throw Error('No payable balance of at least $0.50');
 return amount;
}
Deno.serve(async req=>{
 const CORS=corsFor(req.headers.get('origin')||'');
 const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...CORS,'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(req.method==='OPTIONS')return new Response(null,{headers:CORS});
 if(req.method!=='POST')return json({error:'POST only'},405);
 const key=Deno.env.get('STRIPE_SECRET_KEY'),secret=Deno.env.get('STRIPE_WEBHOOK_SECRET');
 const url=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 if(!key)return json({error:'Stripe invoice collection is not connected. Add STRIPE_SECRET_KEY in secure server settings.'},503);
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
  await check(await admin.rpc('crm_set_stripe_invoice',{p_invoice:id,p_patch:{stripeStatus:si.status,stripeUrl:si.hosted_invoice_url||null,stripeSyncedAt:new Date().toISOString()}}));
  // Mirror the Stripe state on the CRM invoice (paid is set only by crm_apply_stripe_payment after amount checks).
  const crmStatus=si.status==='open'?'open':si.status==='void'||si.status==='uncollectible'?'void':null;
  if(crmStatus)await check(await admin.from('crm_invoices').update({status:crmStatus,updated_at:new Date().toISOString()}).eq('id',id).neq('status','paid'));
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
  const staff=await admin.from('crm_staff').select('user_id').eq('user_id',auth.user.id).maybeSingle();
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
   const client=await check(await admin.from('crm_clients').select('*').eq('id',inv.client_id).single());
   if(!client.email)return json({error:'Add the client’s email before creating a Stripe invoice'},409);
   const pays=await check(await admin.from('crm_payments').select('amount,type').eq('booking_id',inv.booking_id));
   const amount=amountDue(inv,pays);
   const customer=await stripe.customers.create({email:client.email,name:[client.first_name,client.last_name].filter(Boolean).join(' '),metadata:{crmClientId:client.id}},{idempotencyKey:'crm-customer-'+inv.id});
   si=await stripe.invoices.create({customer:customer.id,collection_method:'send_invoice',days_until_due:7,auto_advance:false,pending_invoice_items_behavior:'exclude',currency:'aud',description:`Chanel Monroe · ${inv.number} · ${inv.type==='deposit'?'booking deposit':'final balance'}`,metadata:{crmInvoiceId:inv.id,crmBookingId:inv.booking_id,crmAmountCents:String(amount)},payment_settings:{payment_method_types:['card']}},{idempotencyKey:'crm-invoice-'+inv.id});
   await check(await admin.rpc('crm_set_stripe_invoice',{p_invoice:inv.id,p_patch:{stripeInvoiceId:si.id,stripeAmountCents:amount,stripeStatus:si.status}}));
  }
  if(si.status==='draft'){
   const amount=Number(si.metadata.crmAmountCents);
   if(!Number.isSafeInteger(amount)||amount<50)throw Error('Invalid invoice amount');
   // Itemise from the CRM invoice lines when they add up exactly to the amount due; otherwise one line for the amount due.
   const lines=(Array.isArray(inv.items)?inv.items:[]).map((it:any)=>({desc:String(it.desc||'Item').slice(0,250),cents:Math.round((Number(it.qty)||1)*(Number(it.price)||0)*100)})).filter((l:any)=>Number.isSafeInteger(l.cents)&&l.cents!==0);
   const itemised=lines.length>0&&lines.reduce((n:number,l:any)=>n+l.cents,0)===amount;
   if(itemised){for(let i=0;i<lines.length;i++)await stripe.invoiceItems.create({customer:String(si.customer),invoice:si.id,currency:'aud',amount:lines[i].cents,description:lines[i].desc},{idempotencyKey:`crm-line-${inv.id}-${i}`});}
   else await stripe.invoiceItems.create({customer:String(si.customer),invoice:si.id,currency:'aud',amount,description:`${inv.number} — ${inv.type==='deposit'?'deposit':'remaining balance'}`},{idempotencyKey:'crm-line-'+inv.id});
   si=await stripe.invoices.finalizeInvoice(si.id,{auto_advance:false},{idempotencyKey:'crm-finalize-'+inv.id});
  }
  await reconcile(si);
  return json({ok:true,status:si.status,url:si.hosted_invoice_url||null});
 }catch(e){console.error(e instanceof Error?e.name:'Stripe error');return json({error:e instanceof Error&&/Studio database|reference mismatch|currency or booking|payable balance|Invalid invoice/.test(e.message)?e.message:'Stripe could not complete the request. Check the secure connection and retry.'},502)}
});
