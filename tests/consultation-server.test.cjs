const {test,beforeEach}=require('node:test'),assert=require('node:assert/strict');
let handler,role,kind,failEmail,sent,actions,delivered,failCalendar;
const id='12345678-1234-1234-1234-123456789abc',version='22345678-1234-1234-1234-123456789abc';
global.Deno={env:{get:k=>({SUPABASE_URL:'https://studio.test',SUPABASE_SERVICE_ROLE_KEY:'secret',RESEND_API_KEY:'mail-secret'}[k])},serve:f=>handler=f};
const loaded=import('../supabase/functions/consultation-manage/index.ts'),json=(x,status=200)=>new Response(JSON.stringify(x),{status});
beforeEach(()=>{role='owner';kind='confirmed';failEmail=false;failCalendar=false;sent=[];actions=[];delivered=false;global.fetch=async(url,init={})=>{const p=new URL(url).pathname;
 if(p==='/functions/v1/crm-connectors')return failCalendar&&JSON.parse(init.body).action==='sync-consult'?json({error:'Apple temporarily unavailable'},409):json({ok:true,skipped:true});
 if(p==='/auth/v1/user')return json({id:'owner-id'});
 if(p.endsWith('/crm_staff'))return json([{role}]);
 if(p.endsWith('/rpc/crm_manage_consultation')){actions.push(JSON.parse(init.body));return json({ok:true})}
 if(p.endsWith('/crm_bookings'))return json([{id,client_id:'client',extra:{consultation:{version,provider:'crm',status:kind}}}]);
 if(p.endsWith('/crm_consultation_emails')){if(init.method==='PATCH'){delivered=true;return new Response(null,{status:204})}return json(delivered?[]:[{id:'email-id',kind,start_at:'2026-12-01T01:00:00Z'}])}
 if(p.endsWith('/crm_clients'))return json([{email:'client@example.com',first_name:'<Jess>',phone:'0400000000'}]);
 if(p.endsWith('/rpc/crm_consult_email_status'))return json(null);
 if(url==='https://api.resend.com/emails'){sent.push({headers:init.headers,...JSON.parse(init.body)});return json({},failEmail?503:200)}
 throw Error('Unexpected '+url);
 }});
async function invoke(body,auth=true){await loaded;return handler(new Request('https://studio.test/consultation-manage',{method:'POST',headers:auth?{Authorization:'Bearer owner-token'}:{},body:JSON.stringify(body)}))}
test('anonymous and assistant cannot schedule or approve',async()=>{assert.equal((await invoke({bookingId:id,action:'approve'},false)).status,401);role='assistant';assert.equal((await invoke({bookingId:id,action:'approve'})).status,403);assert.equal(actions.length,0)});
test('scheduling and approval save without any extra email',async()=>{for(const action of ['schedule','approve','retry-email']){const response=await invoke({bookingId:id,action,start:'2026-12-01T01:30Z'});assert.equal(response.status,200);const body=await response.json();assert.equal(body.ok,true);assert.equal(body.emailSent,false);}assert.equal(actions.length,3);assert.equal(sent.length,0);});
test('invalid booking references never mutate bookings',async()=>{assert.equal((await invoke({bookingId:'bad',action:'approve'})).status,400);assert.equal(actions.length,0)});
test('calendar export failure leaves call saved without sending mail',async()=>{failCalendar=true;const r=await invoke({bookingId:id,action:'schedule',start:'2026-12-01T01:30Z'});assert.equal(r.status,200);const body=await r.json();assert.equal(body.ok,true);assert.equal(body.emailSent,false);assert.match(body.calendarError,/Apple temporarily unavailable/);assert.equal(sent.length,0);assert.equal(actions.length,1)});
