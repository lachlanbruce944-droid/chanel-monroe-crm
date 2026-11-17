// Cal.com keeps provider OAuth credentials. This service uses CAL_API_KEY only on the server.
const SB = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CAL_KEY = Deno.env.get('CAL_API_KEY') || '';
const CORS = {'Access-Control-Allow-Origin':'https://lachlanbruce944-droid.github.io','Access-Control-Allow-Headers':'content-type, authorization, apikey','Access-Control-Allow-Methods':'POST, OPTIONS'};
class Fault extends Error {status:number;constructor(message:string,status=400){super(message);this.status=status}}
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...CORS,'Content-Type':'application/json','Cache-Control':'no-store'}});
async function db(path:string,init:RequestInit={}){
 const r=await fetch(`${SB}/rest/v1/${path}`,{...init,headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json',Prefer:'return=representation',...(init.headers||{})},signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw new Fault('Studio database unavailable',503);return r.status===204?null:r.json();
}
async function cal(path:string,init:RequestInit={}){
 if(!CAL_KEY)throw new Fault('Connect your Cal.com account first',409);
 const r=await fetch('https://api.cal.com/v2/'+path,{...init,headers:{Authorization:`Bearer ${CAL_KEY}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new Fault('Cal.com could not complete this request. Check the connection and try again.',r.status===404?404:502);
 return r.status===204?null:r.json();
}
export function googleCalendars(data:any){
 return (data?.connectedCalendars||[]).filter((c:any)=>c.integration?.type==='google_calendar').flatMap((c:any)=>(c.calendars||[]).map((k:any)=>({id:k.externalId,name:k.name||k.externalId,connectionId:String(c.credentialId),selected:k.isSelected===true,writable:k.readOnly!==true})));
}
export function blockRange(start:unknown,end:unknown,before=0,after=0){
 if(typeof start!=='string'||typeof end!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(start)||!/(Z|[+-]\d\d:\d\d)$/.test(end))throw new Fault('Enter a start and finish time in Brisbane time');
 const a=new Date(start),b=new Date(end);if(!Number.isFinite(+a)||!Number.isFinite(+b)||b<=a||+b-+a>7*864e5)throw new Fault('Finish must follow start, within seven days');
 const pad=(v:number)=>Math.min(180,Math.max(0,Number(v)||0))*60000;
 return {start:new Date(+a-pad(before)).toISOString(),end:new Date(+b+pad(after)).toISOString()};
}
export function overlaps(a:any,b:any){return +new Date(a.start)<+new Date(b.end)&&+new Date(a.end)>+new Date(b.start)}
const marker=(id:string)=>`CRM booking reference: ${id}`;
async function preferences(){return (await db('crm_settings?id=eq.connectorPreferences&select=value'))[0]?.value||{enabled:false,before:0,after:0}}
async function state(){
 const prefs=await preferences();
 if(!CAL_KEY)return {configured:false,cal:{connected:false},google:{connected:false,calendars:[]},stripe:{connected:false},preferences:prefs};
 try{
  const me=await cal('me');if(me.data?.username!=='chanelmonroe')throw new Fault('Connect Chanel Monroe’s Cal.com account',409);
  const calendars=googleCalendars((await cal('calendars')).data);
  let stripe=false;try{stripe=(await cal('stripe/check')).status==='success'}catch{}
  return {configured:true,cal:{connected:true,username:'chanelmonroe'},google:{connected:calendars.length>0,calendars},stripe:{connected:stripe},preferences:prefs};
 }catch(e){return {configured:true,cal:{connected:false},google:{connected:false,calendars:[]},stripe:{connected:false},preferences:prefs,error:e instanceof Fault?e.message:'Connection unavailable'}}
}
async function selected(prefs:any){
 const s=await state();if(!s.cal.connected)throw new Fault(s.error||'Connect Cal.com first',409);
 const target=s.google.calendars.find((c:any)=>c.id===prefs.calendarId&&c.connectionId===prefs.connectionId);
 if(!target?.selected||!target.writable)throw new Fault('Choose a writable Google calendar checked for conflicts in Cal.com',409);
 return {target,calendars:s.google.calendars};
}
async function syncBooking(id:string,start?:string,end?:string,remove=false){
 const token=crypto.randomUUID();
 if(!await db('rpc/crm_connector_calendar_lock',{method:'POST',body:JSON.stringify({p_token:token,p_release:false})}))throw new Fault('Another calendar update is running. Try again shortly.',409);
 try{
  const b=(await db(`crm_bookings?id=eq.${id}&select=*`))[0];if(!b)throw new Fault('Booking not found',404);
  const prefs=await preferences(),old=b.extra?.calendarSync;
  if(!remove&&b.status==='lost')throw new Fault('Reopen this booking before syncing');
  const {target,calendars}=await selected(prefs);
  const extra=b.extra||{},a=start||extra.calendarStart,z=end||extra.calendarEnd;
  if(!remove&&!a)throw new Fault('Set the booking’s calendar start and finish before confirming it');
  const range=remove?null:blockRange(a,z,prefs.before,prefs.after);
  if(old?.eventId&&(old.calendarId!==target.id||old.connectionId!==target.connectionId))throw new Fault('Remove the old calendar block before changing calendars');
  const base=`calendars/connections/${encodeURIComponent(target.connectionId)}/events`;
  const query=`calendarId=${encodeURIComponent(target.id)}`;
  let owned:any=null;
  if(old?.eventId){try{owned=(await cal(`${base}/${encodeURIComponent(old.eventId)}?${query}`)).data;if(!owned?.description?.includes(marker(id)))throw new Fault('This calendar event does not belong to this booking',403)}catch(e){if(!(e instanceof Fault&&e.status===404))throw e}}
  if(remove){
   if(owned)await cal(`${base}/${encodeURIComponent(owned.id)}?${query}`,{method:'DELETE'});
   const latest=(await db(`crm_bookings?id=eq.${id}&select=extra`))[0]?.extra||{};
   await db(`crm_bookings?id=eq.${id}`,{method:'PATCH',body:JSON.stringify({extra:{...latest,calendarSync:null},updated_at:new Date().toISOString()})});
   return {removed:true};
  }
  // Check all Google calendars selected for conflicts. No event titles or attendees leave the server.
  for(const calendar of calendars.filter((c:any)=>c.selected)){
   const q=new URLSearchParams({calendarId:calendar.id,from:range!.start,to:range!.end,timeZone:'Australia/Brisbane'});
   const listed=await cal(`calendars/connections/${encodeURIComponent(calendar.connectionId)}/events?${q}`);
   const events=Array.isArray(listed.data)?listed.data:listed.data?.events;
   if(Array.isArray(events)&&events.length>=250)throw new Fault('Too many events to verify availability. Review the calendar first.',409);
   if(!Array.isArray(events))throw new Fault('Calendar availability could not be verified',502);
   for(const e of events){
    const own=e.description?.includes(marker(id))&&calendar.id===target.id&&calendar.connectionId===target.connectionId;
    if(own){if(!owned)owned=e;continue}
    if(['cancelled','declined'].includes(String(e.status).toLowerCase()))continue;
    const er={start:e.start?.time,end:e.end?.time};
    if(/^\d{4}-\d{2}-\d{2}$/.test(er.start||''))throw new Fault('An all-day calendar event blocks this time. Review the calendar first.',409);
    if(!er.start||!er.end)throw new Fault('A calendar event could not be checked. Review the calendar first.',409);
    if(overlaps(range,er))throw new Fault('This time overlaps a calendar event or phone consultation. Choose another time.',409);
   }
  }
  const others=await db(`crm_bookings?id=neq.${id}&status=eq.open&stage=in.(booked,day,invoice,review,complete)&select=extra`);
  for(const other of others){if(other.extra?.calendarStart&&other.extra?.calendarEnd&&overlaps(range,blockRange(other.extra.calendarStart,other.extra.calendarEnd,prefs.before,prefs.after)))throw new Fault('This time overlaps another confirmed CRM booking',409)}
  const body={title:'Chanel Monroe · makeup booking',description:marker(id),start:{time:range!.start,timeZone:'Australia/Brisbane'},end:{time:range!.end,timeZone:'Australia/Brisbane'}};
  const event=(await cal(owned?`${base}/${encodeURIComponent(owned.id)}?${query}`:`${base}?${query}`,{method:owned?'PATCH':'POST',body:JSON.stringify(body)})).data;
  if(!event?.id)throw new Fault('Calendar did not confirm the event',502);
  const latest=(await db(`crm_bookings?id=eq.${id}&select=extra`))[0]?.extra||{};
  const sync={eventId:event.id,calendarId:target.id,connectionId:target.connectionId,start:range!.start,end:range!.end,syncedAt:new Date().toISOString()};
  await db(`crm_bookings?id=eq.${id}`,{method:'PATCH',body:JSON.stringify({extra:{...latest,calendarStart:a,calendarEnd:z,calendarSync:sync},updated_at:new Date().toISOString()})});
  return {calendarSync:sync};
 }finally{await db('rpc/crm_connector_calendar_lock',{method:'POST',body:JSON.stringify({p_token:token,p_release:true})}).catch(()=>{})}
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 try{
  const bearer=req.headers.get('authorization')||'';if(!bearer.startsWith('Bearer '))throw new Fault('Sign in to the CRM',401);
  const auth=await fetch(`${SB}/auth/v1/user`,{headers:{apikey:KEY,Authorization:bearer},signal:AbortSignal.timeout(10000)});
  if(!auth.ok)throw new Fault('Sign in to the CRM',401);const user=await auth.json();
  const staff=(await db(`crm_staff?user_id=eq.${encodeURIComponent(user.id)}&select=role`))[0];if(!staff)throw new Fault('Staff access required',403);
  const raw=await req.text();if(raw.length>8192)throw new Fault('Request too large',413);let input;try{input=JSON.parse(raw)}catch{throw new Fault('Invalid request')}
  if(input.action==='status')return reply(await state());
  if(input.action==='preferences'){
   if(staff.role!=='owner')throw new Fault('Only the owner can change connector settings',403);
   const prefs={enabled:input.enabled===true,phoneConflictConfirmed:input.phoneConflictConfirmed===true,calendarId:String(input.calendarId||''),connectionId:String(input.connectionId||''),before:Math.max(0,Math.min(180,Number(input.before)||0)),after:Math.max(0,Math.min(180,Number(input.after)||0))};
   const previous=await preferences();
   if(previous.calendarId && (previous.calendarId!==prefs.calendarId||previous.connectionId!==prefs.connectionId)){
    const blocks=await db('crm_bookings?extra->calendarSync=not.is.null&select=id&limit=1');
    if(blocks.length)throw new Fault('Remove existing calendar blocks before changing the shared calendar',409);
   }
   if(prefs.enabled){if(!prefs.phoneConflictConfirmed)throw new Fault('Confirm that the Enquiry event checks this calendar for conflicts');await selected(prefs);}
   await db('crm_settings?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({id:'connectorPreferences',value:prefs})});
   return reply({preferences:prefs});
  }
  if(!['sync-booking','remove-block'].includes(input.action))throw new Fault('Unknown connector action');
  if(!/^[0-9a-f-]{36}$/i.test(input.bookingId||''))throw new Fault('Invalid booking reference');
  return reply(await syncBooking(input.bookingId,input.start,input.end,input.action==='remove-block'));
 }catch(e){return reply({error:e instanceof Fault?e.message:'Connection unavailable. Try again shortly.'},e instanceof Fault?e.status:503)}
});
