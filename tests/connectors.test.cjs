const {test,beforeEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let handler,role,prefs,booking,events,creates,patches,locked;
const id='12345678-1234-1234-1234-123456789abc';
global.Deno={env:{get:k=>({SUPABASE_URL:'https://studio.test',SUPABASE_SERVICE_ROLE_KEY:'server-only',CAL_API_KEY:'cal_server_only'}[k])},serve:f=>handler=f};
const loaded=import('../supabase/functions/crm-connectors/index.ts'),json=(x,s=200)=>new Response(JSON.stringify(x),{status:s});
beforeEach(()=>{role='owner';prefs={enabled:true,phoneConflictConfirmed:true,calendarId:'studio@example.com',connectionId:'7',before:10,after:10};booking={id,status:'open',stage:'booked',extra:{calendarStart:'2026-12-01T01:00:00Z',calendarEnd:'2026-12-01T03:00:00Z'}};events=[];creates=0;patches=0;locked=false;
 global.fetch=async(url,init={})=>{const u=new URL(url),body=init.body?JSON.parse(init.body):{},path=u.pathname;
 if(u.host==='studio.test'){
  if(path==='/auth/v1/user')return json({id:'staff-user'});
  if(path.endsWith('/crm_staff'))return json([{role}]);
  if(path.endsWith('/rpc/crm_connector_calendar_lock')){if(body.p_release){locked=false;return json(true)}if(locked)return json(false);locked=true;return json(true)}
  if(path.endsWith('/crm_settings')){if(init.method==='POST')prefs=body.value;return json([{value:prefs}])}
  if(path.endsWith('/crm_bookings')){if(u.searchParams.get('id')?.startsWith('neq.'))return json([]);if(init.method==='PATCH')booking={...booking,...body};return json([booking])}
 }
 if(u.host==='api.cal.com'){
  assert.equal(init.headers.Authorization,'Bearer cal_server_only');
  if(path==='/v2/me')return json({data:{username:'chanelmonroe'}});
  if(path==='/v2/calendars')return json({data:{connectedCalendars:[{integration:{type:'google_calendar'},credentialId:7,calendars:[{externalId:'studio@example.com',name:'Studio',isSelected:true,readOnly:false}]}]}});
  if(path==='/v2/stripe/check')return json({status:'success'});
  if(/events\/event\d+$/.test(path)){const e=events.find(e=>path.endsWith('/'+e.id));if(!e)return json({},404);if(init.method==='PATCH'){patches++;Object.assign(e,body)}return json({data:e})}
  if(path.endsWith('/events')){if(init.method==='POST'){creates++;const e={...body,id:'event'+creates};events.push(e);return json({data:e})}return json({data:events})}
 }
 throw Error('Unexpected mock request '+url);
 };
});
const invoke=async(input,auth=true)=>{await loaded;return handler(new Request('https://studio.test/functions/v1/crm-connectors',{method:'POST',headers:auth?{Authorization:'Bearer staff-token'}:{},body:JSON.stringify(input)}))};
test('reject anonymous access and assistant configuration writes',async()=>{assert.equal((await invoke({action:'status'},false)).status,401);role='assistant';assert.equal((await invoke({action:'preferences',enabled:true})).status,403)});
test('status checks all providers without returning server keys',async()=>{const s=await(await invoke({action:'status'})).json();assert.equal(s.cal.connected,true);assert.equal(s.google.connected,true);assert.equal(s.stripe.connected,true);assert.ok(!JSON.stringify(s).includes('cal_server_only'))});
test('repeat sync updates its own event without duplicate blocks',async()=>{let r=await invoke({action:'sync-booking',bookingId:id});assert.equal(r.status,200,await r.text());assert.equal(creates,1);assert.equal(events[0].start.time,'2026-12-01T00:50:00.000Z');r=await invoke({action:'sync-booking',bookingId:id});assert.equal(r.status,200,await r.text());assert.equal(creates,1);assert.equal(patches,1);assert.equal(locked,false)});
test('phone conflict prevents calendar writes and releases lock',async()=>{events=[{id:'phone',start:{time:'2026-12-01T00:55:00Z'},end:{time:'2026-12-01T01:10:00Z'},description:'Phone consult'}];const r=await invoke({action:'sync-booking',bookingId:id});assert.equal(r.status,409);assert.equal(creates,0);assert.equal(locked,false)});
test('tampered event IDs cannot overwrite unrelated calendar events',async()=>{booking.extra.calendarSync={eventId:'event9',calendarId:prefs.calendarId,connectionId:prefs.connectionId};events=[{id:'event9',description:'Another event'}];assert.equal((await invoke({action:'sync-booking',bookingId:id})).status,403);assert.equal(patches,0)});
test('protection requires phone-event setup confirmation',async()=>{assert.equal((await invoke({action:'preferences',enabled:true,calendarId:prefs.calendarId,connectionId:prefs.connectionId})).status,400)});
test('ranges require timezone offsets and respect adjacent appointments',async()=>{const {blockRange,overlaps}=await loaded;assert.throws(()=>blockRange('2026-12-01T10:00','2026-12-01T11:00'));assert.throws(()=>blockRange('badZ','badZ'));assert.throws(()=>blockRange('2026-12-01T01:00Z','2026-12-01T00:00Z'));assert.equal(overlaps({start:'2026-12-01T01:00Z',end:'2026-12-01T02:00Z'},{start:'2026-12-01T02:00Z',end:'2026-12-01T03:00Z'}),false)});
test('Brisbane form times ignore the browser timezone',()=>{const ctx={window:{},UI:{},DB:{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/connectors.js','utf8'),ctx);assert.equal(ctx.window.Connectors.brisbaneInput('2026-12-01T01:30:00Z'),'2026-12-01T11:30')});
test('calendar conflict stops the workflow before a booking is marked Booked',async()=>{let saved=false;const b={id:'job',clientId:'client',stage:'deposit',status:'open',depositAmount:0,lines:[]};const ctx={window:{Connectors:{ensureBlock:async()=>{throw Error('Calendar conflict')}}},UI:{money:String},DB:{get:store=>store==='bookings'?b:{},list:()=>[],setting:(key,f)=>key==='connectorPreferences'?{enabled:true}:f,save:async()=>{saved=true}}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/workflow.js','utf8'),ctx);await assert.rejects(()=>ctx.window.Workflow.advance('job'),/Calendar conflict/);assert.equal(saved,false)});
test('changing event date requires moving a protected calendar block first',async()=>{const b={id:'job',stage:'booked',eventDate:'2026-12-01',calendarStart:'2026-12-01T01:00:00Z',calendarEnd:'2026-12-01T03:00:00Z',calendarSync:{eventId:'event'}};const ctx={window:{},UI:{},DB:{get:()=>b,setting:()=>({enabled:true})}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/workflow.js','utf8'),ctx);await assert.rejects(()=>ctx.window.Workflow.saveBooking('job',{eventDate:'2026-12-02'}),/Move the Google Calendar/)});
