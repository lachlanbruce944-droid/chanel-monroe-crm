/* CRM calendar is authoritative. No scheduling or payment connection goes through Cal.com. */
(function(){
 const {esc}=UI;
 const brisbaneInput=iso=>iso?new Intl.DateTimeFormat('sv-SE',{timeZone:'Australia/Brisbane',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso)).replace(' ','T'):'';
 async function request(action,data={}){
  const {data:result,error}=await DB.client.functions.invoke('crm-connectors',{body:{action,...data}});
  if(error||result?.error){
   const detail=await error?.context?.json?.().catch(()=>null);
   throw Error(result?.error||detail?.error||error?.message||'Apple Calendar unavailable');
  }
  return result;
 }
 async function mount(){
  const status=document.getElementById('appleStatus');
  const refresh=async()=>{status.textContent='Checking connection…';try{const r=await request('status');status.textContent=r.apple?.connected?'Connected to iCloud Calendar':'Not connected — complete Apple Calendar setup';}catch(e){status.textContent=e.message}};
  document.getElementById('appleCheck').onclick=refresh;
  document.getElementById('appleSetup').onclick=()=>UI.modal({title:'Connect Apple Calendar',hideSubmit:true,cancelLabel:'Done',body:`<p>Use an iCloud calendar for CRM phone consultations and makeup appointments. Chanel approves consultations in the CRM.</p><ol><li>Create an app-specific password in your Apple Account.</li><li>Save APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and the private APPLE_CALDAV_URL in secure server settings. The URL must be the private iCloud CalDAV calendar address ending in /.</li><li>Return here and check the connection.</li></ol><p>Your Apple password is never stored in the CRM browser. Use an app-specific password, not your main Apple password.</p><a class="btn" href="https://account.apple.com" target="_blank" rel="noopener">Apple Account ↗</a><a class="btn" href="https://supabase.com/dashboard/project/qxiugfatpybldluipcyy/functions/secrets" target="_blank" rel="noopener">Secure connection settings ↗</a><p>New enquiries, makeup holds and phone consultations sync automatically. Existing events in this iCloud calendar are checked before confirmation. Changes made in Apple do not change a CRM approval or quote.</p>`});
  document.getElementById('appleSync').onclick=async e=>{e.target.disabled=true;try{let n=0;for(const b of DB.list('bookings',b=>b.status!=='lost')){if(b.callAt&&!b.callLoggedAt){const r=await request('sync-consult',{bookingId:b.id});if(r.skipped)throw Error('Connect Apple Calendar first');n++;}if(makeupHold(b)){const r=await request('sync-booking',{bookingId:b.id});if(r.skipped)throw Error('Connect Apple Calendar first');n++;}}UI.toast(n+' appointments synced to Apple Calendar');}catch(err){UI.toast(err.message,'error')}finally{e.target.disabled=false}};
  await refresh();
 }
 function view(){return {title:'Settings',subtitle:'Apple Calendar, invoice payments and studio account',html:`<section class="card"><h2>Phone consultations</h2><p>Client times remain pending until Chanel approves in the CRM. Approval sends the booking email; the client does not confirm again.</p><p>Normally at least three days before makeup, with a recorded exception for short notice.</p><a class="btn" href="#/calendar">Open CRM calendar</a></section><section class="card"><h2>Connectors</h2><div class="connector-grid"><article class="card connector-card"><div class="connector-brand"></div><h2>Apple Calendar</h2><p id="appleStatus" role="status">Not checked</p><p>Sync pending holds and confirmed appointments to iCloud.</p><button class="btn" id="appleSetup">Connect Apple Calendar</button><button class="btn" id="appleCheck">Check connection</button><button class="btn" id="appleSync">Sync existing appointments</button></article><article class="card connector-card"><div class="connector-brand stripe">S</div><h2>Stripe</h2><p>Deposit and final invoice payments. Phone consultations are free.</p><a class="btn" href="https://dashboard.stripe.com" target="_blank" rel="noopener">Manage Stripe ↗</a><a class="btn" href="#/invoices">Open CRM invoices</a></article></div></section><section class="card"><h2>Business & account</h2><a class="btn" href="#/profile">Open profile & business settings</a></section>`,after:mount}}
 const minutes=60000;
 const ahead=(iso,n)=>new Date(+new Date(iso)+n*minutes).toISOString();
 function makeupHold(b){
  const time=b.startTime||b.readyBy;
  const start=b.calendarStart||(b.eventDate&&time?ahead(b.eventDate+'T'+time+'+10:00',b.startTime?0:-180):null);
  return start&&b.status!=='lost'?{start,end:ahead(start,180),busyUntil:ahead(start,240)}:null;
 }
 const overlaps=(a,z,x,y)=>+new Date(a)<+new Date(y)&&+new Date(z)>+new Date(x);
 function calendarConflicts(b,start,end,excludeOwnMakeup=false){
  return DB.list('bookings',x=>x.status!=='lost').some(other=>{
   if(other.id===b.id&&!excludeOwnMakeup)return false;
   const hold=makeupHold(other);
   return (hold&&overlaps(start,end,hold.start,hold.busyUntil)) ||
    (other.id!==b.id&&other.callAt&&!other.callLoggedAt&&overlaps(start,end,other.callAt,ahead(other.callAt,15)));
  });
 }
 function bookingPanel(b){
  const hold=makeupHold(b);
  const conflict=hold&&calendarConflicts(b,hold.start,hold.busyUntil);
  return `<section class="card"><h2>Makeup appointment time block</h2>
   <p class="muted">Three-hour service followed by a one-hour buffer. A ready-by time sets the service finish.</p>
   ${hold?`<p>Service ends ${esc(brisbaneInput(hold.end).replace('T',' '))} · Buffer ends ${esc(brisbaneInput(hold.busyUntil).replace('T',' '))} AEST</p>`:''}
   ${conflict?'<p class="callout">This hold overlaps the CRM calendar. Review the timing before confirming makeup.</p>':''}
   <form data-form="calendarBlock" data-id="${esc(b.id)}" class="form-grid"><label>Start · Brisbane<input type="datetime-local" name="calendarStart" value="${esc(brisbaneInput(hold?.start))}" required></label><div class="span-2"><button class="btn" type="submit">Save CRM calendar time block</button></div></form></section>`;
 }
 async function ensureBlock(b,apple=true){
  const hold=makeupHold(b);
  const start=b.calendarStart||hold?.start;
  const end=hold?.busyUntil;
  if(start&&end){
   for(const other of DB.list('bookings',x=>x.id!==b.id&&x.status!=='lost')){
    if(other.callAt&&!other.callLoggedAt&&overlaps(start,end,other.callAt,ahead(other.callAt,15)))throw Error('Calendar conflict: a phone consultation overlaps this makeup appointment or buffer');
   }
   if(hold&&calendarConflicts(b,start,end))throw Error('Calendar conflict: another appointment or buffer overlaps');
  }else if(DB.list('bookings',x=>x.id!==b.id&&x.status!=='lost'&&x.callAt&&!x.callLoggedAt&&b.eventDate===brisbaneInput(x.callAt).slice(0,10)).length)throw Error('Calendar conflict: a phone consultation overlaps this makeup appointment');
  if(apple&&hold)await request('check-booking',{bookingId:b.id});
 }
 async function saveBlock(b,start){
  const a=new Date(start+':00+10:00');
  if(!Number.isFinite(+a))throw Error('Choose a valid appointment start');
  if(b.callAt&&+new Date(b.callAt)+15*minutes>=+a)throw Error('The phone consultation must finish before makeup starts');
  const next={...b,calendarStart:a.toISOString(),calendarEnd:ahead(a.toISOString(),180),calendarSync:null};
  if(['booked','day'].includes(b.stage)){
   const hold=makeupHold(next);
   if(calendarConflicts(next,hold.start,hold.busyUntil))throw Error('The new appointment or buffer overlaps a CRM hold');
  }
  await DB.save('bookings',next);
 }
 async function removeBlock(b){await request('remove-block',{bookingId:b.id});if(b.callAt)await request('remove-consult',{bookingId:b.id});await DB.save('bookings',{...b,calendarSync:null})}
 window.Connectors={view,bookingPanel,ensureBlock,saveBlock,removeBlock,brisbaneInput,makeupHold,calendarConflicts,request};
})();
