/* Scheduling uses Cal.com. Invoice payments use Stripe directly. Keys stay server-side. */
(function(){
 const {esc,modal,toast}=UI;
 const LINKS={cal:'https://app.cal.com/settings/developer/api-keys',google:'https://app.cal.com/settings/my-account/calendars',stripe:'https://dashboard.stripe.com/apikeys',secrets:'https://supabase.com/dashboard/project/qxiugfatpybldluipcyy/functions/secrets'};
 let snapshot=null;
 async function request(action,data={}){
  const {data:auth,error}=await DB.client.auth.getSession();if(error||!auth.session)throw Error('Sign in to the CRM');
  const r=await fetch(window.CRM_CONFIG.supabaseUrl+'/functions/v1/crm-connectors',{method:'POST',headers:{'Content-Type':'application/json',apikey:window.CRM_CONFIG.supabaseKey,Authorization:'Bearer '+auth.session.access_token},body:JSON.stringify({action,...data}),signal:AbortSignal.timeout(65000)});
  let body;try{body=await r.json()}catch{throw Error('Connector service unavailable')}
  if(!r.ok)throw Error(body.error||'Connector request failed');return body;
 }
 const providerLabel={cal:'Cal.com',google:'Google Calendar',stripe:'Stripe'};
 const description={cal:'Phone consultations and connected scheduling accounts.',google:'One calendar for phone calls, makeup bookings and time off.',stripe:'Collect deposit and final invoices through Stripe. Phone consultations in Cal.com are free.'};
 const status=(key)=>key==='stripe'?'Verified per invoice':(key!=='stripe'&&snapshot?.[key]?.connected)?'Connected':snapshot?'Not connected':'Not checked';
 function cards(){return ['google','stripe','cal'].map(key=>`<article class="card connector-card"><div class="connector-brand ${key}">${key==='google'?'G':key==='stripe'?'S':'Cal'}</div><h2>${providerLabel[key]}</h2><span class="badge ${(key!=='stripe'&&snapshot?.[key]?.connected)?'s-booked':''}">${status(key)}</span><p class="muted">${description[key]}</p><button type="button" class="btn" data-connector="${key}">${(key!=='stripe'&&snapshot?.[key]?.connected)?'Manage connection':'Connect '+providerLabel[key]}</button></article>`).join('')}
 function settingsHtml(){return `<section class="card"><div class="card-head"><h2>Connectors</h2><button type="button" class="btn sm" id="connectorRefresh">Check connections</button></div><p>Use the same Google calendar for makeup bookings and Cal.com phone consultations.</p><p id="connectorMessage" class="muted" role="status">Checking connections…</p><div class="connector-grid" id="connectorCards">${cards()}</div></section><section class="card" id="connectorProtection">${protectionHtml()}</section><section class="card"><h2>Business & account</h2><p class="muted">Business details, pricing, payment policies and staff access.</p><a class="btn" href="#/profile">Open profile & business settings</a></section>`}
 function protectionHtml(){
  const p=snapshot?.preferences||DB.setting('connectorPreferences',{}),calendars=snapshot?.google?.calendars||[],owner=Auth.current?.role==='owner';
  const options=calendars.filter(c=>c.writable&&c.selected);
  const pending=DB.list('bookings',b=>b.status!=='lost'&&['booked','day'].includes(b.stage)&&(!b.calendarSync||!b.calendarStart||!b.calendarEnd)).length;
  return `<h2>Prevent appointment conflicts</h2><p>Publish each makeup booking as a busy block. Cal.com must check this same calendar before offering a phone-call time.</p><form id="connectorPreferences" class="form-grid"><label class="span-2">Shared Google calendar<select name="target" ${!owner?'disabled':''}><option value="">Connect Google Calendar first</option>${options.map(c=>`<option value="${esc(c.connectionId+'|'+c.id)}" ${c.id===p.calendarId&&c.connectionId===p.connectionId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><label>Buffer before (minutes)<input name="before" type="number" min="0" max="180" value="${esc(p.before||0)}" ${!owner?'disabled':''}></label><label>Buffer after (minutes)<input name="after" type="number" min="0" max="180" value="${esc(p.after||0)}" ${!owner?'disabled':''}></label><label class="check span-2"><input type="checkbox" name="phoneConflictConfirmed" ${p.phoneConflictConfirmed?'checked':''} ${!owner?'disabled':''}> I have selected this calendar for conflict checks on Cal.com’s Enquiry phone-call event.</label><label class="check span-2"><input type="checkbox" name="enabled" ${p.enabled?'checked':''} ${!owner?'disabled':''}> Check calendar availability before moving a makeup booking to Booked.</label>${owner?'<div class="span-2 row gap"><button class="btn primary" type="submit">Save calendar settings</button><button type="button" class="btn" id="connectorSyncAll">Sync existing booked jobs</button></div>':'<p class="muted">The studio owner manages connector settings.</p>'}</form><p class="muted small">${pending} booked job${pending===1?'':'s'} need a calendar time block or sync. Set exact start/finish times on each booking. Provider sync can take a moment; existing conflicting appointments need manual review.</p>`;
 }
 async function refresh(){
  const message=document.getElementById('connectorMessage');if(message)message.textContent='Checking connections…';
  try{snapshot=await request('status');if(message)message.textContent=snapshot.error||(!snapshot.configured?'Connect Cal.com to activate the scheduling connectors.':'Connection status checked just now.');}
  catch(e){snapshot=null;if(message)message.textContent=e.message}
  const cardsEl=document.getElementById('connectorCards');if(cardsEl)cardsEl.innerHTML=cards();
  const protection=document.getElementById('connectorProtection');if(protection)protection.innerHTML=protectionHtml();
 }
 async function showWindow(key){
  if(!providerLabel[key])return;
  const setup=key==='cal'?`<ol><li>Open Cal.com and sign in to Chanel’s account.</li><li>Create an API key with calendar read/write and account/app read access.</li><li>Save it as <code>CAL_API_KEY</code> in the studio’s secure server settings.</li><li>Return here and choose Check connections.</li></ol><p><a class="btn" href="${LINKS.secrets}" target="_blank" rel="noopener">Secure server settings ↗</a></p>`:key==='google'?'<ol><li>Connect Google Calendar in Cal.com.</li><li>Choose a calendar the studio can write to.</li><li>Check it for conflicts on the Enquiry phone-call event, then select it in CRM Settings.</li></ol>':'<ol><li>Open the studio’s Stripe account and complete account verification.</li><li>Save its secret API key as <code>STRIPE_SECRET_KEY</code> in the secure server settings.</li><li>Open a CRM deposit or final invoice and choose Create Stripe payment link.</li><li>After payment, choose Refresh payment status on that invoice to verify and record the payment.</li></ol><p>Cal.com phone consultations collect no payments. Creating an invoice link does not email the client or charge a card. Payment status is verified per invoice; this window does not check Stripe credentials.</p><p><a class="btn" href="https://supabase.com/dashboard/project/qxiugfatpybldluipcyy/functions/secrets" target="_blank" rel="noopener">Secure server settings ↗</a></p>';
  await modal({title:providerLabel[key]+' connector',wide:true,hideSubmit:true,cancelLabel:'Done',body:`<p><span class="badge">${status(key)}</span></p><p>${description[key]}</p>${setup}<a class="btn primary" href="${LINKS[key]}" target="_blank" rel="noopener">Open ${providerLabel[key]} connection ↗</a><p class="small muted">Account authorization happens with the provider. Secret keys are never stored in the CRM page or browser storage.</p>`});
  await refresh();
 }
 function mount(){
  const root=document.getElementById('connectorSettings');if(!root)return;
  root.addEventListener('click',async e=>{
   const btn=e.target.closest('[data-connector],#connectorRefresh,#connectorSyncAll');if(!btn)return;
   if(btn.dataset.connector){showWindow(btn.dataset.connector);return}
   btn.disabled=true;try{
    if(btn.id==='connectorRefresh')await refresh();
    else {let n=0;const failures=[];for(const b of DB.list('bookings',b=>b.status!=='lost'&&['booked','day'].includes(b.stage))){try{await ensureBlock(b,true);n++}catch(err){failures.push(err.message)}}toast(`${n} calendar blocks synced${failures.length?' · '+failures.length+' need review':''}`);await refresh();if(failures.length)toast(failures[0],'error')}
   }catch(err){toast(err.message,'error')}finally{btn.disabled=false}
  });
  root.addEventListener('submit',async e=>{
   if(e.target.id!=='connectorPreferences')return;e.preventDefault();e.stopPropagation();
   const f=UI.formToObj(e.target),[connectionId,...ids]=(f.target||'').split('|'),btn=e.target.querySelector('[type=submit]');btn.disabled=true;
   try{await request('preferences',{...f,connectionId,calendarId:ids.join('|')});await DB.refresh();await refresh();toast('Calendar settings saved')}catch(err){toast(err.message,'error')}finally{btn.disabled=false}
  });
  refresh();
 }
 function view(){return {title:'Settings',subtitle:'Connections, calendar protection and your studio account',html:`<div id="connectorSettings" class="stack">${settingsHtml()}</div>`,after:mount}}
 const brisbaneInput=iso=>iso?new Intl.DateTimeFormat('sv-SE',{timeZone:'Australia/Brisbane',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso)).replace(' ','T'):'';
 function bookingPanel(b){return `<section class="card"><div class="card-head"><h2>Google Calendar time block</h2><a href="#/settings">Connectors</a></div><p class="muted">Set the exact time to keep clear for this job, in Brisbane time. Phone consultations will avoid this block once shared-calendar protection is configured.</p><form data-form="calendarBlock" data-id="${esc(b.id)}" class="form-grid"><label>Start · Brisbane<input type="datetime-local" name="calendarStart" value="${esc(brisbaneInput(b.calendarStart))}" required></label><label>Finish · Brisbane<input type="datetime-local" name="calendarEnd" value="${esc(brisbaneInput(b.calendarEnd))}" required></label><div class="span-2 row gap"><button class="btn sm" type="submit">Save & sync time block</button>${b.calendarSync?`<button type="button" class="btn sm" data-act="removeCalendarBlock" data-id="${esc(b.id)}">Remove calendar block</button>`:''}</div></form><p class="small muted">${b.calendarSync?'Last synced '+esc(UI.fmtDateTime(b.calendarSync.syncedAt)):'Not synced to Google Calendar yet.'}</p></section>`}
 async function ensureBlock(b,force=false){
  if(!force&&!DB.setting('connectorPreferences',{}).enabled)return;
  await request('sync-booking',{bookingId:b.id,start:b.calendarStart,end:b.calendarEnd});await DB.refresh();
 }
 async function saveBlock(b,start,end){
  const a=new Date(start+':00+10:00'),z=new Date(end+':00+10:00');if(!Number.isFinite(+a)||!Number.isFinite(+z)||z<=a)throw Error('Choose a finish time after the start');
  await request('sync-booking',{bookingId:b.id,start:a.toISOString(),end:z.toISOString()});await DB.refresh();
 }
 async function removeBlock(b){if(!b.calendarSync)return;await request('remove-block',{bookingId:b.id});await DB.refresh()}
 window.Connectors={view,bookingPanel,ensureBlock,saveBlock,removeBlock,request,brisbaneInput};
})();
