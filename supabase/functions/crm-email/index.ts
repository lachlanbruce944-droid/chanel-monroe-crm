// @ts-nocheck
// Microsoft 365 read-only inbox import. No send, mailbox write or booking-field updates.
const SB=Deno.env.get('SUPABASE_URL'),KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...CORS,'Content-Type':'application/json'}});
const uuid=s=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s||'');
async function db(path,method='GET',body,representation=false){
 const r=await fetch(SB+'/rest/v1/'+path,{method,headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json',Prefer:representation?'return=representation':'return=minimal'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('Email connector database request failed ('+r.status+')');return r.status===204?null:r.json();
}
async function token(cfg){
 const secret=Deno.env.get('M365_CLIENT_SECRET');
 if(!secret||!uuid(cfg.tenant_id)||!uuid(cfg.client_id))throw Error('Complete Microsoft tenant, application ID and secure client secret setup first');
 const r=await fetch('https://login.microsoftonline.com/'+cfg.tenant_id+'/oauth2/v2.0/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:cfg.client_id,client_secret:secret,scope:'https://graph.microsoft.com/.default',grant_type:'client_credentials'}),signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('Microsoft sign-in failed. Check tenant, application, secret expiry and administrator permission.');
 const data=await r.json();if(!data.access_token)throw Error('Microsoft did not return an access token');return data.access_token;
}
async function graph(url,access){
 const parsed=new URL(url);
 if(parsed.origin!=='https://graph.microsoft.com'||!parsed.pathname.startsWith('/v1.0/users/')||parsed.username||parsed.password)throw Error('Invalid Microsoft sync URL');
 const r=await fetch(url,{headers:{Authorization:'Bearer '+access,Prefer:'outlook.body-content-type="text", IdType="ImmutableId"'},redirect:'error',signal:AbortSignal.timeout(12000)});
 if(r.status===410){const e=Error('Microsoft sync cursor expired. Pause and reset the sync start date.');e.expired=true;throw e;}
 if(!r.ok)throw Error('Microsoft mailbox access failed ('+r.status+'). Check read permission and mailbox scope; try again later if throttled.');
 return r.json();
}
const root=cfg=>'https://graph.microsoft.com/v1.0/users/'+encodeURIComponent(cfg.mailbox);
function initial(cfg){
 const u=new URL(root(cfg)+'/mailFolders/Inbox/messages/delta');
 u.searchParams.set('$select','id,internetMessageId,conversationId,from,toRecipients,ccRecipients,subject,receivedDateTime,hasAttachments');
 u.searchParams.set('$filter','receivedDateTime ge '+new Date(cfg.sync_from).toISOString());
 u.searchParams.set('$top','20');return u.href;
}
async function verify(cfg){const access=await token(cfg);await graph(root(cfg)+'/mailFolders/Inbox/messages?$top=1&$select=id',access);return access;}
async function secureEqual(a,b){if(!a||!b)return false;const hash=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));const [x,y]=await Promise.all([hash(a),hash(b)]);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;}
async function sync(cfg){
 if(!cfg.enabled)throw Error('Email import is paused. Complete setup and enable it first.');
 const lease=crypto.randomUUID(),now=new Date().toISOString();
 const claimed=await db('crm_mail_connector?id=eq.true&or=(lock_until.is.null,lock_until.lt.'+now+')','PATCH',{lock_until:new Date(Date.now()+90000).toISOString(),lock_token:lease},true);
 if(!claimed?.length)throw Error('Another email sync is running. Please wait.');
 let imported=0,matched=0,skipped=0,pages=0,more=false;
 try{
  const access=await token(cfg),clients=await db('crm_clients?select=email');
  const known=new Set(clients.map(c=>(c.email||'').trim().toLowerCase()));
  let cursor=cfg.cursor||initial(cfg),started=Date.now();
  while(pages<3&&Date.now()-started<40000){
   const page=await graph(cursor,access);if(!Array.isArray(page.value))throw Error('Unreadable Microsoft email response');
   for(const item of page.value){
    if(item['@removed'])continue;
    const sender=(item.from?.emailAddress?.address||'').trim().toLowerCase();
    const recipients=[...(item.toRecipients||[]),...(item.ccRecipients||[])].map(r=>(r.emailAddress?.address||'').toLowerCase());
    if(!known.has(sender)||sender===cfg.mailbox||!recipients.includes(cfg.mailbox)){skipped++;continue;}
    const message=await graph(root(cfg)+'/messages/'+encodeURIComponent(item.id)+'?$select=id,internetMessageId,conversationId,from,subject,receivedDateTime,uniqueBody,body,webLink',access);
    let attachments=[];
    if(item.hasAttachments){
     let next=root(cfg)+'/messages/'+encodeURIComponent(item.id)+'/attachments?$select=id,name,contentType,size,isInline';
     for(let n=0;next&&n<10;n++){const a=await graph(next,access);attachments.push(...(a.value||[]).filter(x=>!x.isInline).map(x=>({id:x.id,name:String(x.name||'Attachment').slice(0,255),contentType:x.contentType,size:x.size})));next=a['@odata.nextLink'];if(next&&n===9)throw Error('Too many attachments to import safely');}
    }
    const text=message.uniqueBody?.contentType?.toLowerCase()==='text'?message.uniqueBody.content:message.body?.contentType?.toLowerCase()==='text'?message.body.content:null;
    if(text===null)throw Error('Microsoft did not return plain-text message content. Import stopped without advancing.');
    const result=await db('rpc/crm_mail_ingest','POST',{p_message:{mailbox:cfg.mailbox,graph_id:message.id,message_key:message.internetMessageId||message.id,conversation_id:message.conversationId,sender,subject:message.subject||'',body_text:text,received_at:message.receivedDateTime,attachments,web_link:message.webLink}},true);
    if(!result.duplicate&&!result.skipped){imported++;if(result.matched)matched++;}
   }
   cursor=page['@odata.nextLink']||page['@odata.deltaLink'];if(!cursor)throw Error('Microsoft sync cursor missing');
   await db('crm_mail_connector?id=eq.true&lock_token=eq.'+lease,'PATCH',{cursor,updated_at:new Date().toISOString()});
   pages++;more=!!page['@odata.nextLink'];if(!more)break;
  }
  await db('crm_mail_connector?id=eq.true&lock_token=eq.'+lease,'PATCH',{last_sync_at:new Date().toISOString(),last_error:null});
  return {ok:true,imported,matched,needsReview:imported-matched,skipped,more};
 }catch(e){
  await db('crm_mail_connector?id=eq.true&lock_token=eq.'+lease,'PATCH',{last_error:String(e.message||'Email sync failed').slice(0,500)});throw e;
 }finally{await db('crm_mail_connector?id=eq.true&lock_token=eq.'+lease,'PATCH',{lock_until:null,lock_token:null});}
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:CORS});
 if(req.method!=='POST')return response({error:'POST only'},405);
 try{
  const raw=await req.text();if(raw.length>8192)return response({error:'Request too large'},413);
  const input=JSON.parse(raw),scheduled=await secureEqual(req.headers.get('x-crm-mail-key'),Deno.env.get('M365_SYNC_KEY'));
  let user;
  if(!scheduled){
   const auth=req.headers.get('authorization')||'';
   if(!auth.startsWith('Bearer '))return response({error:'Sign in to the CRM'},401);
   const r=await fetch(SB+'/auth/v1/user',{headers:{apikey:KEY,Authorization:auth},signal:AbortSignal.timeout(10000)});
   if(!r.ok)return response({error:'Sign in to the CRM'},401);user=await r.json();
   const staff=await db('crm_staff?user_id=eq.'+encodeURIComponent(user.id)+'&select=role');
   if(staff[0]?.role!=='owner')return response({error:'Only Chanel’s owner account manages email'},403);
  }else if(input.action!=='sync')return response({error:'Scheduled access allows sync only'},403);
  const [cfg]=await db('crm_mail_connector?id=eq.true&select=*');
  if(!cfg)return response({error:'Install the email connector migration first'},503);
  if(input.action==='status'){
   const counts=await db('crm_email_messages?reviewed_at=is.null&select=id,booking_id');
   return response({configured:!!(cfg.tenant_id&&cfg.client_id&&Deno.env.get('M365_CLIENT_SECRET')),secretConfigured:!!Deno.env.get('M365_CLIENT_SECRET'),schedulerKeyConfigured:!!Deno.env.get('M365_SYNC_KEY'),enabled:cfg.enabled,mailbox:cfg.mailbox,tenantId:cfg.tenant_id||'',clientId:cfg.client_id||'',syncFrom:cfg.sync_from,lastSync:cfg.last_sync_at,error:cfg.last_error,pending:counts.length,unmatched:counts.filter(m=>!m.booking_id).length});
  }
  if(input.action==='save'){
   if(cfg.lock_until&&Date.parse(cfg.lock_until)>Date.now())throw Error('Wait for the current sync to finish before editing settings');
   if(!uuid(input.tenantId)||!uuid(input.clientId))throw Error('Enter valid Microsoft tenant and application IDs');
   if((input.mailbox||'').trim().toLowerCase()!=='makeup@chanelmonroe.net')throw Error('This connector is scoped to makeup@chanelmonroe.net');
   const date=new Date(input.syncFrom);if(!Number.isFinite(+date)||date>Date.now()+86400000)throw Error('Choose a valid import start date');
   await db('crm_mail_connector?id=eq.true','PATCH',{mailbox:'makeup@chanelmonroe.net',tenant_id:input.tenantId,client_id:input.clientId,sync_from:date.toISOString(),cursor:null,enabled:false,last_error:null,last_sync_at:null,updated_at:new Date().toISOString()});
   return response({ok:true});
  }
  if(input.action==='test'){await verify(cfg);return response({ok:true,connected:true});}
  if(input.action==='enable'){await verify(cfg);await db('crm_mail_connector?id=eq.true','PATCH',{enabled:true,last_error:null});return response({ok:true});}
  if(input.action==='pause'){await db('crm_mail_connector?id=eq.true','PATCH',{enabled:false});return response({ok:true});}
  if(input.action==='sync')return response(await sync(cfg));
  if(input.action==='review'){
   if(!uuid(input.messageId)||(input.bookingId&&!uuid(input.bookingId)))throw Error('Choose a valid message and enquiry');
   return response(await db('rpc/crm_mail_review','POST',{p_message:input.messageId,p_booking:input.bookingId||null,p_user:user.id},true));
  }
  return response({error:'Unknown email connector action'},400);
 }catch(e){return response({error:e.message||'Email connector unavailable'},409);}
});
