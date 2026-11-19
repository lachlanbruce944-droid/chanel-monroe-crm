// Authenticated, owner-only consultation scheduling and confirmation. No client acceptance step.
const SB = Deno.env.get('SUPABASE_URL')!, KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,'Content-Type':'application/json'}});
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
async function db(path:string,init:RequestInit={}){
 const r=await fetch(`${SB}/rest/v1/${path}`,{...init,headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json',...init.headers},signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('Database operation failed: '+await r.text());return r.status===204?null:r.json();
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:CORS});
 if(req.method!=='POST')return reply({error:'POST only'},405);
 try{
  const bearer=req.headers.get('authorization')||'';
  if(!bearer.startsWith('Bearer '))return reply({error:'Sign in to the CRM'},401);
  const auth=await fetch(`${SB}/auth/v1/user`,{headers:{apikey:KEY,Authorization:bearer},signal:AbortSignal.timeout(10000)});
  if(!auth.ok)return reply({error:'Sign in to the CRM'},401);
  const user=await auth.json(), staff=await db(`crm_staff?user_id=eq.${encodeURIComponent(user.id)}&select=role`);
  if(staff[0]?.role!=='owner')return reply({error:'Only Chanel (the owner) can schedule or approve consultations'},403);
  const raw=await req.text();if(raw.length>4096)return reply({error:'Request too large'},413);
  const input=JSON.parse(raw);
  if(!/^[0-9a-f-]{36}$/i.test(input.bookingId||'')||!['schedule','approve','retry-email'].includes(input.action))return reply({error:'Invalid request'},400);
  async function apple(action:string){
   const response=await fetch(`${SB}/functions/v1/crm-connectors`,{method:'POST',headers:{Authorization:bearer,apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({action,bookingId:input.bookingId}),signal:AbortSignal.timeout(55000)});
   const value=await response.json();if(!response.ok||value.error)throw Error(value.error||'Apple Calendar check failed');return value;
  }
  if(input.action==='approve')await apple('check-consult');
  await db('rpc/crm_manage_consultation',{method:'POST',body:JSON.stringify({p_booking:input.bookingId,p_actor:user.id,p_action:input.action,p_start:input.start||null,p_exception:String(input.exceptionReason||'').slice(0,1000)})});
  // CRM approval has committed. Report export failures separately so email can still be delivered.
  let calendarError='';
  try{
   if(input.action==='approve')await apple('sync-consult');
   if(input.action==='schedule')await apple('sync-consult');
  }catch(e){calendarError=e instanceof Error?e.message:'Apple Calendar sync failed';}
  const [b]=await db(`crm_bookings?id=eq.${input.bookingId}&select=id,client_id,extra`),c=b.extra?.consultation;
  if(input.action==='retry-email'&&c?.status==='confirmed')try{await apple('sync-consult')}catch(e){calendarError=e instanceof Error?e.message:'Apple Calendar sync failed';}
  if(!c?.version)return reply({error:'Schedule or approve the consultation before retrying email'},409);
  const messages=await db(`crm_consultation_emails?booking_id=eq.${input.bookingId}&version=eq.${c?.version||'00000000-0000-0000-0000-000000000000'}&sent_at=is.null&select=*`);
  let emailError='';
  for(const message of messages){
   try{
    const [client]=await db(`crm_clients?id=eq.${b.client_id}&select=email,first_name,phone`);
    const token=Deno.env.get('RESEND_API_KEY');if(!token||!client?.email)throw Error('Email delivery requires a client email and configured mail service');
    const when=new Date(message.start_at).toLocaleString('en-AU',{timeZone:'Australia/Brisbane',dateStyle:'full',timeStyle:'short'}),confirmed=message.kind==='confirmed';
    const subject=confirmed?'Your phone consultation is confirmed':'Your phone consultation time · pending approval';
    const html=`<p>Hi ${esc(client.first_name||'there')},</p><h2>${subject}</h2><p>${esc(when)} · Brisbane time (AEST)</p><p>Free 15-minute phone consultation. Chanel will call ${esc(client.phone||'your supplied number')}.</p><p>${confirmed?'Chanel has approved this appointment. You do not need to confirm again.':'Chanel has proposed this time for your phone consultation. It is pending Chanel’s approval. Reply if you need a different time.'}</p><p>This is your phone consultation; your makeup appointment is confirmed separately after your quote and deposit. Need a change? Reply to this email.</p>`;
    const sent=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':`consult-${message.id}`},body:JSON.stringify({from:Deno.env.get('FROM_EMAIL')||'Chanel Monroe Makeup <enquiries@chanelmonroe.net>',to:[client.email],reply_to:Deno.env.get('BUSINESS_EMAIL')||'makeup@chanelmonroe.net',subject,html}),signal:AbortSignal.timeout(15000)});
    if(!sent.ok)throw Error('Mail service did not accept the message');
    await db(`crm_consultation_emails?id=eq.${message.id}`,{method:'PATCH',body:JSON.stringify({sent_at:new Date().toISOString()})});
   }catch(e){emailError=e instanceof Error?e.message:'Email delivery failed';}
  }
  // Conditional version filter prevents a delayed email update from overwriting a reschedule.
  if(c?.version)await db('rpc/crm_consult_email_status',{method:'POST',body:JSON.stringify({p_booking:b.id,p_version:c.version,p_status:emailError?'failed':'sent'})});
  return reply({ok:true,emailSent:!emailError,emailError,calendarError});
 }catch(e){return reply({error:e instanceof Error?e.message:'Consultation update failed'},400);}
});
