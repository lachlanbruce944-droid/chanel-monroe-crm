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
   if(input.action!=='retry-email')await apple('sync-consult');
  }catch(e){calendarError=e instanceof Error?e.message:'Apple Calendar sync failed';}
  return reply({ok:true,emailSent:false,emailError:'',calendarError});
 }catch(e){return reply({error:e instanceof Error?e.message:'Consultation update failed'},400);}
});
