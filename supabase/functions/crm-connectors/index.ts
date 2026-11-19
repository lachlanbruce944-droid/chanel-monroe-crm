// Apple iCloud CalDAV connector. Credentials never leave the server.
const SB=Deno.env.get('SUPABASE_URL')!,KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,'Content-Type':'application/json'}});
const xml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
export const stamp=(iso:string)=>new Date(iso).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
const decode=(s:string)=>s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
export function dates(data:string){
 if(!data.includes('BEGIN:VEVENT'))throw Error('Apple returned unreadable calendar event data');
 const unfolded=data.replace(/\r?\n[ \t]/g,'');
 if(/(?:^|\n)(RRULE|RDATE|EXDATE)[;:]/.test(unfolded))throw Error('Apple returned an unexpanded recurring appointment. Review this time in Apple Calendar');
 const result=[];
 for(const match of unfolded.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)END:VEVENT/g)){
  const e=match[1];if(/(?:^|\n)(STATUS:CANCELLED|TRANSP:TRANSPARENT)\r?\n/.test(e))continue;
  const get=(name:string)=>{const m=e.match(new RegExp('(?:^|\\n)'+name+'([^:]*):([^\\r\\n]+)'));if(!m)return null;
   if(m[1].includes('VALUE=DATE')||!m[2].includes('T'))return {allDay:m[2]};
   if(!/^\d{8}T\d{6}Z$/.test(m[2]))throw Error('Apple appointment timezone could not be verified');
   return {iso:m[2].replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,'$1-$2-$3T$4:$5:$6Z')};};
  const start=get('DTSTART'),end=get('DTEND');if(!start||!end)throw Error('Apple appointment duration could not be verified');
  if(start.iso && (!Number.isFinite(+new Date(start.iso)) || !end.iso || !Number.isFinite(+new Date(end.iso)) || +new Date(end.iso)<=+new Date(start.iso)))throw Error('Apple appointment duration could not be verified');
  result.push({uid:e.match(/(?:^|\n)UID:([^\r\n]+)/)?.[1],start,end});
 }
 return result;
}
async function db(path:string,init:RequestInit={}){const r=await fetch(`${SB}/rest/v1/${path}`,{...init,headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json',...init.headers},signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('CRM calendar data unavailable');return r.status===204?null:r.json();}
function config(){
 const username=Deno.env.get('APPLE_ID'),password=Deno.env.get('APPLE_APP_SPECIFIC_PASSWORD'),target=Deno.env.get('APPLE_CALDAV_URL');
 if(!username||!password||!target)return null;
 const url=new URL(target);if(url.protocol!=='https:'||!(url.hostname==='caldav.icloud.com'||/^p\d+-caldav\.icloud\.com$/.test(url.hostname))||url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/'))throw Error('Configure a private iCloud CalDAV calendar URL ending in /');
 return {url:url.href,authorization:'Basic '+btoa(username+':'+password)};
}
async function dav(cfg:NonNullable<ReturnType<typeof config>>,url:string,method:string,body?:string,headers:Record<string,string>={}){
 if(new URL(url).origin!==new URL(cfg.url).origin||!url.startsWith(cfg.url))throw Error('Invalid Apple calendar resource');
 const r=await fetch(url,{method,redirect:'error',headers:{Authorization:cfg.authorization,'Content-Type':method==='PUT'?'text/calendar; charset=utf-8':'application/xml; charset=utf-8',...headers},body,signal:AbortSignal.timeout(18000)});
 if(!r.ok&&r.status!==404)throw Error(r.status===401?'Apple sign-in failed; check the app-specific password':`Apple Calendar request failed (${r.status})`);return r;
}
export async function available(cfg:NonNullable<ReturnType<typeof config>>,start:string,end:string,uid:string){
 const query=`<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data><c:expand start="${stamp(start)}" end="${stamp(end)}"/></c:calendar-data></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${stamp(start)}" end="${stamp(end)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
 const r=await dav(cfg,cfg.url,'REPORT',query,{Depth:'1'});if(!r.ok)throw Error('Apple availability could not be checked');
 const content=await r.text();if(content.length>2000000)throw Error('Too many Apple appointments to check');
 if(/HTTP\/1\.[01] [45]\d\d/.test(content))throw Error('Apple did not allow a complete availability check');
 if(!/<(?:\w+:)?multistatus[\s/>]/i.test(content))throw Error('Invalid Apple availability response');
 const elements=[...content.matchAll(/<(?:\w+:)?calendar-data(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?calendar-data>/g)];
 if(!elements.length&&/<(?:\w+:)?response[\s>]/.test(content))throw Error('Apple did not return readable calendar data');
 for(const element of elements)for(const e of dates(decode(element[1]))){
  if(e.uid===uid||/^crm-[0-9a-f-]{36}-(phone|makeup)@chanelmonroe\.net$/i.test(e.uid||''))continue;
  if(e.start.allDay){throw Error('Apple Calendar has an all-day appointment at this time');}
  else if(+new Date(e.start.iso!)<+new Date(end)&&+new Date(e.end.iso!)>+new Date(start))throw Error('This time conflicts with an Apple Calendar appointment');
 }
}
type Booking = { id: string; status: string; stage: string; event_date?: string; start_time?: string;
 ready_by?: string; call_at?: string; call_logged_at?: string; extra?: { calendarStart?: string; consultation?: { status?: string } } };
type AppleConfig = NonNullable<ReturnType<typeof config>>;
function makeupStart(b: Booking) {
 if(b.extra?.calendarStart)return b.extra.calendarStart;
 const time=b.start_time||b.ready_by;
 if(!b.event_date||!time)return null;
 const millis=Date.parse(`${b.event_date}T${time}+10:00`);
 return new Date(millis-(b.start_time?0:180*60000)).toISOString();
}
async function syncEvent(cfg: AppleConfig,b: Booking,action: string){
  const call=action.includes('consult'),uid=`crm-${b.id}-${call?'phone':'makeup'}@chanelmonroe.net`,url=cfg.url+encodeURIComponent(uid)+'.ics';
  if(action==='remove-block'||action==='remove-consult'){const found=await dav(cfg,url,'GET');if(found.ok){if(!(await found.text()).includes('UID:'+uid))throw Error('Apple event ownership mismatch');await dav(cfg,url,'DELETE',undefined,{'If-Match':found.headers.get('etag')||'*'})}return {ok:true};}
  const start=call?b.call_at:makeupStart(b);
  const end=start?new Date(+new Date(start)+(call?15:240)*60000).toISOString():null;
  if(!start||!end||!Number.isFinite(+new Date(start)))throw Error('Set a CRM calendar start time first');
  const pending=call?b.extra?.consultation?.status!=='confirmed':!['booked','day','invoice','review','done'].includes(b.stage);
  if(!pending||action.startsWith('check-'))await available(cfg,start,end,uid);
  if(action.startsWith('check-'))return {ok:true};
  if(b.status==='lost')throw Error('Reopen the enquiry before syncing');
  const found=await dav(cfg,url,'GET'),headers:Record<string,string>={};
  if(found.ok){if(!(await found.text()).includes('UID:'+uid))throw Error('Apple event ownership mismatch');headers['If-Match']=found.headers.get('etag')||'*';}else headers['If-None-Match']='*';
  const content=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Chanel Monroe//CRM//EN','BEGIN:VEVENT',`UID:${uid}`,`DTSTAMP:${stamp(new Date().toISOString())}`,`DTSTART:${stamp(start)}`,`DTEND:${stamp(end)}`,`SUMMARY:Chanel Monroe - ${call?'phone consultation':'makeup + 1 hr buffer'}${pending?' (pending)':''}`,pending?'STATUS:TENTATIVE':'STATUS:CONFIRMED','TRANSP:OPAQUE','END:VEVENT','END:VCALENDAR',''].join('\r\n');
  const saved=await dav(cfg,url,'PUT',content,headers);if(!saved.ok)throw Error('Apple Calendar did not save the appointment');
  return {ok:true,synced:true};
}
async function syncQueue(cfg: AppleConfig){
 const rows=await db('crm_apple_calendar_queue?next_attempt=lte.'+encodeURIComponent(new Date().toISOString())+'&order=next_attempt&limit=3');
 for(const row of rows){
  const ref=`crm_apple_calendar_queue?booking_id=eq.${row.booking_id}&version=eq.${row.version}`;
  try{
   const [record]=await db(`crm_bookings?id=eq.${row.booking_id}&select=*`);
   const b: Booking=record||{id:row.booking_id,status:'lost',stage:''};
   const actions = [b.status!=='lost'&&makeupStart(b)?'sync-booking':'remove-block'];
   // Keep completed phone events in calendar history.
   if(b.status==='lost'||!b.call_at)actions.push('remove-consult');
   else if(!b.call_logged_at)actions.push('sync-consult');
   const results=await Promise.allSettled(actions.map(action=>syncEvent(cfg,b,action)));
   const failure=results.find(result=>result.status==='rejected');
   if(failure?.status==='rejected')throw failure.reason;
   await db(ref,{method:'DELETE'});
  }catch(e){
   await db(ref,{method:'PATCH',body:JSON.stringify({
    next_attempt:new Date(Date.now()+5*60000).toISOString(),last_error:e instanceof Error?e.message:'Sync failed'
   })});
  }
 }
 return {ok:true,processed:rows.length};
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:CORS});if(req.method!=='POST')return reply({error:'POST only'},405);
 try{
  const workerKey=req.headers.get('x-crm-calendar-worker');
  if(workerKey){
   if(workerKey.length!==64 || !await db('rpc/crm_apple_worker_authorized',{method:'POST',body:JSON.stringify({candidate:workerKey})}))return reply({error:'Invalid worker credentials'},403);
   const cfg=config();
   return reply(cfg?await syncQueue(cfg):{ok:true,skipped:true});
  }
  const bearer=req.headers.get('authorization')||'';if(!bearer.startsWith('Bearer '))return reply({error:'Sign in to the CRM'},401);
  const auth=await fetch(`${SB}/auth/v1/user`,{headers:{apikey:KEY,Authorization:bearer},signal:AbortSignal.timeout(10000)});if(!auth.ok)return reply({error:'Sign in to the CRM'},401);
  const user=await auth.json(),staff=await db(`crm_staff?user_id=eq.${encodeURIComponent(user.id)}&select=role`);if(staff[0]?.role!=='owner')return reply({error:'Only the owner manages Apple Calendar'},403);
  const raw=await req.text();if(raw.length>4096)return reply({error:'Request too large'},413);const input=JSON.parse(raw),cfg=config();
  if(input.action==='status'){
   if(!cfg)return reply({apple:{configured:false,connected:false}});
   const r=await dav(cfg,cfg.url,'PROPFIND','<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',{Depth:'0'});
   const text=await r.text();if(!r.ok||!/<(?:\w+:)?calendar[\s/>]/.test(text))throw Error('Apple Calendar could not be verified');return reply({apple:{configured:true,connected:true}});
  }
  if(!['check-consult','check-booking','sync-consult','sync-booking','remove-block','remove-consult'].includes(input.action)||!/^[0-9a-f-]{36}$/i.test(input.bookingId||''))return reply({error:'Invalid calendar action'},400);
  if(!cfg)return reply({ok:true,skipped:true,reason:'Apple Calendar is not connected'});
  const [b]=await db(`crm_bookings?id=eq.${input.bookingId}&select=*`);if(!b)throw Error('Booking not found');
  return reply(await syncEvent(cfg,b,input.action));
 }catch(e){return reply({error:e instanceof Error?e.message:'Apple Calendar unavailable'},409);}
});
