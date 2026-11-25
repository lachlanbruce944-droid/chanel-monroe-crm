/* CRM calendar is authoritative. No scheduling or payment connection goes through Cal.com. */
(function(){
 const {esc}=UI;
 const brisbaneInput=iso=>iso?new Intl.DateTimeFormat('sv-SE',{timeZone:'Australia/Brisbane',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso)).replace(' ','T'):'';
 async function request(action,data={}){
  const {data:result,error}=await DB.client.functions.invoke('crm-connectors',{body:{action,...data}});
  if(error||result?.error)throw Error(result?.error||error?.message||'Apple Calendar unavailable');return result;
 }
 async function googleCalendar() {
  const {data,error}=await DB.client.rpc('crm_google_calendar_read');
  if(error) throw Error(error.message);
  return data;
 }
 function mountGoogleCalendar() {
  const status=document.getElementById('googleCalendarStatus');
  const refresh=async()=>{
   try {
    const data=await googleCalendar();
    if(!data.syncedAt) {
     status.textContent=data.paired?'Waiting for the first Google Calendar sync':'Ready to pair';
     return;
    }
    const last=new Date(data.syncedAt);
    const stale=Date.now()-last.getTime()>15*60000;
    status.textContent=(stale?'Sync delayed · last synced ':'Last synced ')+UI.fmtDateTime(last);
   } catch(e) { status.textContent=e.message; }
  };
  document.getElementById('googleCalendarCheck').onclick=refresh;
  document.getElementById('googleCalendarSetup').onclick=()=>UI.modal({
   title:'Connect Google Calendar', hideSubmit:true, cancelLabel:'Done',
   body:`<p>Sign in to Apps Script as <strong>makeup@chanelmonroe.net</strong>.</p>
    <ol><li><a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener">Create an Apps Script project</a> and paste the <a href="js/google-calendar-sync.gs" target="_blank" rel="noopener" download>calendar sync script</a> into Code.gs.</li>
    <li>Under Services, add Google Calendar API.</li>
    <li>Generate a pairing key and add it under Project Settings → Script properties as <code>CRM_PAIRING_KEY</code>. Generating a key replaces any previous key.</li>
    <li>Run <code>installCrmCalendarSync</code> and approve Google Calendar access.</li></ol>
    <button type="button" class="btn" id="googlePairKey">Generate pairing key</button>
    <label>Pairing key<input id="googlePairValue" type="text" readonly autocomplete="off"></label>
    <p id="googlePairStatus" role="status"></p>`,
   onOpen:form=>{ form.querySelector('#googlePairKey').onclick=pairGoogleCalendar; }
  });
  return refresh();
 }
 async function pairGoogleCalendar(event) {
  const button=event.currentTarget;
  button.disabled=true;
  const status=document.getElementById('googlePairStatus');
  try {
   const token=Array.from(crypto.getRandomValues(new Uint8Array(32)), byte=>byte.toString(16).padStart(2,'0')).join('');
   const {error}=await DB.client.rpc('crm_google_calendar_pair',{p_token:token});
   if(error) throw Error(error.message);
   const input=document.getElementById('googlePairValue');
   if(input) { input.value=token; input.select(); }
   if(status) status.textContent='Copy this key before closing setup.';
  } catch(e) {
   if(status) status.textContent=e.message;
   button.disabled=false;
  }
 }
 async function mount(){
  const status=document.getElementById('appleStatus');
  const refresh=async()=>{status.textContent='Checking connection…';try{const r=await request('status');status.textContent=r.apple?.connected?'Connected to iCloud Calendar':'Not connected — complete Apple Calendar setup';}catch(e){status.textContent=e.message}};
  document.getElementById('appleCheck').onclick=refresh;
  document.getElementById('appleSetup').onclick=()=>UI.modal({title:'Connect Apple Calendar',hideSubmit:true,cancelLabel:'Done',body:`<p>Use an iCloud calendar for CRM phone consultations and makeup appointments. Chanel approves consultations in the CRM.</p><ol><li>Create an app-specific password in your Apple Account.</li><li>Save APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and the private APPLE_CALDAV_URL in secure server settings. The URL must be the private iCloud CalDAV calendar address ending in /.</li><li>Return here and check the connection.</li></ol><p>Your Apple password is never stored in the CRM browser. Use an app-specific password, not your main Apple password.</p><a class="btn" href="https://account.apple.com" target="_blank" rel="noopener">Apple Account ↗</a><a class="btn" href="https://supabase.com/dashboard/project/qxiugfatpybldluipcyy/functions/secrets" target="_blank" rel="noopener">Secure connection settings ↗</a><p>Sync runs when Chanel approves a consultation or saves a makeup time block. Existing Apple appointments are checked for conflicts. Changes made in Apple do not change a CRM approval or quote.</p>`});
  document.getElementById('appleSync').onclick=async e=>{e.target.disabled=true;try{let n=0;for(const b of DB.list('bookings',b=>b.status!=='lost')){if(b.consultation?.provider==='crm'&&b.consultation?.status==='confirmed'&&!b.callLoggedAt){const r=await request('sync-consult',{bookingId:b.id});if(r.skipped)throw Error('Connect Apple Calendar first');n++;}if(['booked','day'].includes(b.stage)&&b.calendarStart&&b.calendarEnd){const r=await request('sync-booking',{bookingId:b.id});if(r.skipped)throw Error('Connect Apple Calendar first');n++;}}UI.toast(n+' appointments synced to Apple Calendar');}catch(err){UI.toast(err.message,'error')}finally{e.target.disabled=false}};
  const stripeStatus=document.getElementById('stripeStatus');
  const checkStripe=async()=>{
   stripeStatus.textContent='Checking Stripe connection…';
   try{
    const {data,error}=await DB.client.functions.invoke('crm-stripe',{body:{action:'status'}});
    if(error||data?.error)throw Error(data?.error||error?.message||'Connection unavailable');
    stripeStatus.textContent=data.configured?(data.webhookConfigured?'Connected · automatic payment confirmations enabled':'Stripe key connected · webhook secret missing'):'Not connected';
   }catch(err){stripeStatus.textContent='Not connected · '+err.message}
  };
  document.getElementById('stripeCheck').onclick=checkStripe;
  await Promise.all([refresh(),checkStripe(),mountGoogleCalendar(),window.EmailConnector?EmailConnector.mount():Promise.resolve()]);
 }
 function view(){return {title:'Settings',subtitle:'Calendar, payments, client email and studio account',html:`<section class="card"><h2>Phone consultations</h2><p>Client times remain pending until Chanel approves in the CRM. Approval sends the booking email; the client does not confirm again.</p><p>At least 24 hours before the makeup appointment starts.</p><a class="btn" href="#/calendar">Open CRM calendar</a></section><section class="card"><h2>Connectors</h2><div class="connector-grid">${window.EmailConnector?EmailConnector.panel():''}<article class="card connector-card"><div class="connector-brand"></div><h2>Apple Calendar</h2><p id="appleStatus" role="status">Not checked</p><p>Sync approved consultations and makeup appointments to iCloud. Check Apple appointments for conflicts.</p><button class="btn" id="appleSetup">Connect Apple Calendar</button><button class="btn" id="appleCheck">Check connection</button><button class="btn" id="appleSync">Sync existing appointments</button></article><article class="card connector-card"><h2>Google Calendar</h2><p>makeup@chanelmonroe.net</p><p id="googleCalendarStatus" role="status">Checking connection…</p><p>Send enquiry holds and phone consults to Google. Bring busy times back into CRM and website availability every five minutes.</p><button class="btn" id="googleCalendarSetup">Connect Google Calendar</button><button class="btn" id="googleCalendarCheck">Check connection</button></article><article class="card connector-card"><div class="connector-brand stripe">S</div><h2>Stripe</h2><p id="stripeStatus" role="status">Not checked</p><p>Deposit and final invoice payments. Stripe webhook confirmations automatically record payments and update invoice status. Booking approval stays with Chanel. Phone consultations are free.</p><button class="btn" id="stripeCheck" type="button">Check Stripe connection</button><a class="btn" href="https://dashboard.stripe.com" target="_blank" rel="noopener">Manage Stripe ↗</a><a class="btn" href="#/invoices">Open CRM invoices</a></article></div></section><section class="card"><h2>Business & account</h2><a class="btn" href="#/profile">Open profile & business settings</a></section>`,after:mount}}
 function automaticBlock(b){
  if(b.calendarTimeMode==='manual')return b;
  if(!b.eventDate||!(b.startTime||b.readyBy))return b.calendarTimeMode==='automatic'?{...b,calendarStart:null,calendarEnd:null}:b;
  const lines=b.lines||[],services=DB.list('services');
  const minutes=lines.reduce((n,l)=>{const service=services.find(s=>s.id===l.serviceId);return n+Math.max(0,Number(service?.durationMins??l.durationMins??60))*Math.max(0,Number(l.qty)||0)},0)||180;
  const time=b.startTime||b.readyBy;
  if(!b.eventDate||!time)return b;
  let start=+new Date(b.eventDate+'T'+time.slice(0,5)+':00+10:00');
  if(!b.startTime)start-=minutes*60000;
  if(!Number.isFinite(start))throw Error('Choose a valid appointment date and time');
  return {...b,calendarStart:new Date(start).toISOString(),calendarEnd:new Date(start+minutes*60000).toISOString(),calendarBufferMins:Number(DB.setting('appointmentBufferMins',60)),calendarTimeMode:'automatic'};
 }
 function bookingPanel(b){const block=b.calendarTimeMode==='manual'||(b.calendarStart&&!b.calendarTimeMode)?b:automaticBlock(b);return `<section class="card"><div class="card-head"><h2>Makeup appointment</h2><span class="badge">${block.calendarTimeMode==='automatic'?'Automatic timing':'Saved timing'}</span></div><p class="muted">Brisbane time · service duration plus ${esc(block.calendarBufferMins??60)} minutes of booking buffer.</p><form data-form="calendarBlock" data-id="${esc(b.id)}" data-edit-label="Edit time" class="form-grid"><label>Start · Brisbane<input type="datetime-local" name="calendarStart" value="${esc(brisbaneInput(block.calendarStart))}" required></label><label>Finish · Brisbane<input type="datetime-local" name="calendarEnd" value="${esc(brisbaneInput(block.calendarEnd))}" required></label><div class="span-2"><button class="btn" type="submit">Save time</button></div></form>${!block.calendarStart?'<p class="callout">Add an event date and start or ready-by time to calculate the appointment.</p>':''}</section>`}
 async function ensureBlock(b,apple=true){
  if(apple&&(!b.calendarStart||b.calendarTimeMode==='automatic')){const next=automaticBlock(b);if(next.calendarStart){await ensureBlock(next,false);b=await DB.save('bookings',next);}}
  const start=b.calendarStart?+new Date(b.calendarStart):null,end=b.calendarEnd?+new Date(b.calendarEnd):null;
  if(start&&b.callAt&&+new Date(b.callAt)+15*60000>start)throw Error('The phone consultation must finish before makeup starts');
  for(const other of DB.list('bookings',x=>x.id!==b.id&&x.status!=='lost')){
   if(other.callAt&&!other.callLoggedAt&&['enquiry','call'].includes(other.stage)){
    const at=+new Date(other.callAt);
    const clash=start&&end ? start<at+15*60000&&end>at : b.eventDate===brisbaneInput(other.callAt).slice(0,10);
    if(clash)throw Error('Calendar conflict: a phone consultation overlaps this makeup appointment');
   }
   if(start&&end&&['booked','day'].includes(other.stage)&&other.calendarStart&&other.calendarEnd&&start<+new Date(other.calendarEnd)&&end>+new Date(other.calendarStart))throw Error('Calendar conflict: another makeup appointment overlaps');
  }
  if(apple && b.calendarStart && b.calendarEnd) await request('check-booking',{bookingId:b.id});
 }
 async function saveBlock(b,start,end){
  const a=new Date(start+':00+10:00'),z=new Date(end+':00+10:00');if(!Number.isFinite(+a)||!Number.isFinite(+z)||z<=a)throw Error('Choose a finish after the start');
  const next={...b,calendarStart:a.toISOString(),calendarEnd:z.toISOString(),calendarTimeMode:'manual',calendarSync:null};await ensureBlock(next,false);
  if(b.callAt&&+new Date(b.callAt)+15*60000>=+a)throw Error('The phone consultation must finish before makeup starts');
  await DB.save('bookings',next);
  const result=await request(['booked','day'].includes(b.stage)?'sync-booking':'check-booking',{bookingId:b.id});if(result.skipped)UI.toast('Saved in CRM; Apple Calendar is not connected');
 }
 async function removeBlock(b){await request('remove-block',{bookingId:b.id});if(b.callAt)await request('remove-consult',{bookingId:b.id});await DB.save('bookings',{...b,calendarSync:null})}
 window.Connectors={googleCalendar,automaticBlock,view,bookingPanel,ensureBlock,saveBlock,removeBlock,brisbaneInput,request};
})();
