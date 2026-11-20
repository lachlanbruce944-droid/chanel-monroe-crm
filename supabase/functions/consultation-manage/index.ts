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
   if(input.action==='schedule')await apple('remove-consult');
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
    // Match the enquiry email's warm blush palette, Georgia headings and compact detail rows.
    const site='https://lachlanbruce944-droid.github.io/chanel-monroe-makeup/';
    const title=confirmed?'Your phone consultation is confirmed':'Your phone consultation request';
    const status=confirmed?'CONFIRMED':'PENDING APPROVAL';
    const statusText=confirmed
      ? 'Chanel has approved your phone consultation. You do not need to confirm again.'
      : 'Your preferred time is awaiting Chanel’s approval. We will email you once it is confirmed; there is nothing else you need to do.';
    const html=`<!doctype html><html><body style="margin:0;background:#f5e9e1;font-family:Helvetica,Arial,sans-serif;color:#3a2622">
<div style="max-width:600px;margin:0 auto;padding:24px"><div style="background:#fbf3ee;border-radius:18px;padding:24px;border:1px solid #e2c3b2">
<div style="font-family:Georgia,serif;font-size:22px;margin-bottom:4px">Chanel Monroe <span style="font-size:11px;letter-spacing:.2em;color:#7a5a50">MAKEUP</span></div>
<p style="font-size:11px;letter-spacing:.15em;color:#b8846b;margin:22px 0 6px;font-weight:bold">${status}</p>
<h1 style="font-family:Georgia,serif;font-weight:normal;font-size:24px;line-height:1.3;margin:6px 0 16px">${title}</h1>
<p style="font-size:15px;line-height:1.6;margin:0 0 14px">Hi ${esc(client.first_name||'there')},</p>
<p style="font-size:15px;line-height:1.6;margin:0 0 18px">${statusText}</p>
<div style="background:#f5e9e1;border-radius:12px;padding:16px 18px;margin:0 0 18px">
<p style="font-size:12px;color:#7a5a50;margin:0 0 10px;letter-spacing:.06em">YOUR PHONE CONSULTATION</p>
<table role="presentation" style="border-collapse:collapse;width:100%;font-size:14px">
<tr><td style="padding:6px 10px 6px 0;color:#7a5a50;vertical-align:top">Date &amp; time</td><td style="padding:6px 0;color:#3a2622">${esc(when)}</td></tr>
<tr><td style="padding:6px 10px 6px 0;color:#7a5a50;vertical-align:top">Time zone</td><td style="padding:6px 0;color:#3a2622">Brisbane · AEST</td></tr>
<tr><td style="padding:6px 10px 6px 0;color:#7a5a50;vertical-align:top">Duration</td><td style="padding:6px 0;color:#3a2622">15 minutes · complimentary</td></tr>
<tr><td style="padding:6px 10px 6px 0;color:#7a5a50;vertical-align:top">Phone number</td><td style="padding:6px 0;color:#3a2622">${esc(client.phone||'Your supplied number')}</td></tr>
</table></div>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px">Chanel will call you at the scheduled time to discuss your occasion, preferred makeup look and any questions.</p>
<p style="font-size:13px;line-height:1.6;color:#7a5a50;margin:0">Your makeup appointment is booked separately after your quote and deposit. Need to change your consultation time? Simply reply to this email.</p>
</div><p style="font-size:11px;color:#7a5a50;text-align:center">Chanel Monroe Makeup · Gold Coast · <a href="${site}" style="color:#7a5a50">website</a></p></div></body></html>`;
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
