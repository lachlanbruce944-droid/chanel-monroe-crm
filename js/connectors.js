/* CRM calendar is authoritative. No scheduling or payment connection goes through Cal.com. */
(function(){
 const {esc}=UI;
 const brisbaneInput=iso=>iso?new Intl.DateTimeFormat('sv-SE',{timeZone:'Australia/Brisbane',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso)).replace(' ','T'):'';
 async function request(action,data={}){
  const {data:result,error}=await DB.client.functions.invoke('crm-connectors',{body:{action,...data}});
  if(error||result?.error)throw Error(result?.error||error?.message||'Apple Calendar unavailable');return result;
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
  await Promise.all([refresh(),checkStripe()]);
 }
 function view(){return {title:'Settings',subtitle:'Apple Calendar, invoice payments and studio account',html:`<section class="card"><h2>Phone consultations</h2><p>Client times remain pending until Chanel approves in the CRM. Approval sends the booking email; the client does not confirm again.</p><p>Normally at least three days before makeup, with a recorded exception for short notice.</p><a class="btn" href="#/calendar">Open CRM calendar</a></section><section class="card"><h2>Connectors</h2><div class="connector-grid"><article class="card connector-card"><div class="connector-brand"></div><h2>Apple Calendar</h2><p id="appleStatus" role="status">Not checked</p><p>Sync approved consultations and makeup appointments to iCloud. Check Apple appointments for conflicts.</p><button class="btn" id="appleSetup">Connect Apple Calendar</button><button class="btn" id="appleCheck">Check connection</button><button class="btn" id="appleSync">Sync existing appointments</button></article><article class="card connector-card"><div class="connector-brand stripe">S</div><h2>Stripe</h2><p id="stripeStatus" role="status">Not checked</p><p>Deposit and final invoice payments. Stripe webhook confirmations automatically record payments and update invoice status. Booking approval stays with Chanel. Phone consultations are free.</p><button class="btn" id="stripeCheck" type="button">Check Stripe connection</button><a class="btn" href="https://dashboard.stripe.com" target="_blank" rel="noopener">Manage Stripe ↗</a><a class="btn" href="#/invoices">Open CRM invoices</a></article></div></section><section class="card"><h2>Business & account</h2><a class="btn" href="#/profile">Open profile & business settings</a></section>`,after:mount}}
 function bookingPanel(b){return `<section class="card"><h2>Makeup appointment time block</h2><p class="muted">Save exact start and finish times in Brisbane time to prevent CRM phone consultation conflicts.</p><form data-form="calendarBlock" data-id="${esc(b.id)}" class="form-grid"><label>Start · Brisbane<input type="datetime-local" name="calendarStart" value="${esc(brisbaneInput(b.calendarStart))}" required></label><label>Finish · Brisbane<input type="datetime-local" name="calendarEnd" value="${esc(brisbaneInput(b.calendarEnd))}" required></label><div class="span-2"><button class="btn" type="submit">Save CRM calendar time block</button></div></form></section>`}
 async function ensureBlock(b,apple=true){
  const start=b.calendarStart?+new Date(b.calendarStart):null,end=b.calendarEnd?+new Date(b.calendarEnd):null;
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
  const next={...b,calendarStart:a.toISOString(),calendarEnd:z.toISOString(),calendarSync:null};await ensureBlock(next,false);
  if(b.callAt&&+new Date(b.callAt)+15*60000>=+a)throw Error('The phone consultation must finish before makeup starts');
  await DB.save('bookings',next);
  const result=await request(['booked','day'].includes(b.stage)?'sync-booking':'check-booking',{bookingId:b.id});if(result.skipped)UI.toast('Saved in CRM; Apple Calendar is not connected');
 }
 async function removeBlock(b){await request('remove-block',{bookingId:b.id});if(b.callAt)await request('remove-consult',{bookingId:b.id});await DB.save('bookings',{...b,calendarSync:null})}
 window.Connectors={view,bookingPanel,ensureBlock,saveBlock,removeBlock,brisbaneInput,request};
})();
