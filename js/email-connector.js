/* Microsoft 365 through GoDaddy: setup can be saved while imports remain paused. */
(function(){
 const {esc,fmtDateTime}=UI;
 const secrets='https://supabase.com/dashboard/project/qxiugfatpybldluipcyy/functions/secrets';
 async function call(action,data={}){
  const {data:result,error}=await DB.client.functions.invoke('crm-email',{body:{action,...data}});
  if(error||result?.error)throw Error(result?.error||error?.message||'Email backend is not available. See setup instructions.');
  return result;
 }
 function panel(){return `<article class="card connector-card"><div class="connector-brand" aria-hidden="true">✉</div><h2>Microsoft 365 email</h2><p class="small muted">GoDaddy · makeup@chanelmonroe.net</p><p id="mailStatus" role="status">Prepared · checking setup…</p><p>Save client replies with the enquiry and flag new details for review. Dates, prices and approvals change only when Chanel edits them.</p><div class="row gap" style="flex-wrap:wrap"><button class="btn" type="button" data-mail-action="setup">Set up email</button><button class="btn" type="button" data-mail-action="test">Test connection</button><button class="btn" type="button" data-mail-action="enable">Enable import</button><button class="btn" type="button" data-mail-action="sync">Sync now</button><button class="btn" type="button" data-mail-action="pause">Pause import</button><button class="btn" type="button" data-mail-action="inbox">Review client messages</button></div><p id="mailLastSync" class="small muted"></p><p class="small muted">Read-only Inbox access. Attachment names and the original Outlook message are available; files stay in Microsoft 365.</p></article>`;}
 function safeLink(value){try{const u=new URL(value);return u.protocol==='https:'&&['outlook.office.com','outlook.office365.com','outlook.cloud.microsoft'].includes(u.hostname)?u.href:null}catch{return null}}
 function messages(){return DB.missing?.emails?[]:DB.list('emails');}
 function messageCard(m,allowLink=false){
  const link=safeLink(m.webLink),reviewed=!!m.reviewedAt;
  return `<article class="card"><div class="card-head"><h3>${esc(m.subject||'Client email')}</h3><span class="badge">${reviewed?'Reviewed':'New client details'}</span></div><p class="small muted">${esc(m.sender)} · ${esc(fmtDateTime(m.receivedAt))}</p><details><summary>Read client message</summary><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(m.bodyText||'(No message text)')}</p></details>${(m.attachments||[]).length?`<p class="small">Attachments: ${m.attachments.map(a=>esc(a.name)).join(', ')}</p>`:''}${link?`<a class="btn sm" href="${esc(link)}" target="_blank" rel="noopener noreferrer">View in Outlook</a>`:''}${!reviewed?`<button class="btn sm" type="button" data-mail-action="${allowLink&&!m.bookingId?'link':'review'}" data-message-id="${esc(m.id)}">${allowLink&&!m.bookingId?'Link to enquiry & review':'Mark reviewed'}</button>`:''}</article>`;
 }
 function bookingPanel(b){const list=messages().filter(m=>m.bookingId===b.id).sort((a,z)=>z.receivedAt.localeCompare(a.receivedAt));return `<section class="card"><div class="card-head"><h2>Client messages</h2><span class="badge">${list.filter(m=>!m.reviewedAt).length} new</span></div>${list.length?list.map(m=>messageCard(m)).join(''):'<p class="muted">Email replies appear here after Microsoft 365 is connected. New details are saved for review before booking details change.</p>'}</section>`;}
 async function refresh(){
  const status=document.getElementById('mailStatus');if(!status)return;
  try{const r=await call('status');status.textContent=(r.enabled?'Import enabled':r.configured?'Configured · import paused':'Not connected · set up when ready')+` · ${r.pending} messages to review (${r.unmatched} need linking)`;
   document.getElementById('mailLastSync').textContent=(r.lastSync?'Last sync: '+fmtDateTime(r.lastSync):'No emails imported yet.')+(r.error?' Last error: '+r.error:'');
  }catch(e){status.textContent='Prepared · backend setup required';document.getElementById('mailLastSync').textContent=e.message;}
 }
 async function setup(){
  let cfg={};try{cfg=await call('status')}catch{}
  const date=(cfg.syncFrom||new Date().toISOString()).slice(0,10);
  await UI.modal({title:'Microsoft 365 email setup',wide:true,submitLabel:'Save setup · keep paused',body:`<p><b>GoDaddy Microsoft 365</b> · connect the business Inbox when you are ready. Use your Microsoft tenant administrator; GoDaddy support may need to help enable app registration or Exchange permissions.</p><ol><li>Create a single-tenant Microsoft Entra app registration.</li><li>Grant read-only mail access scoped to <b>makeup@chanelmonroe.net</b> using Exchange Online Application RBAC (Application Mail.Read). Test the scope. Do not add unscoped tenant-wide mail permissions.</li><li>Create a client secret and save its <b>value</b> as <b>M365_CLIENT_SECRET</b> in secure server settings. Never enter your mailbox password here.</li><li>Save the tenant and application IDs below, then test the connection and enable imports.</li><li>Enable the prepared five-minute server schedule using the repository setup guide. Import stays off until you enable it.</li></ol><p><a class="btn sm" href="https://entra.microsoft.com" target="_blank" rel="noopener">Microsoft Entra</a> <a class="btn sm" href="${secrets}" target="_blank" rel="noopener">Secure server settings</a> <a class="btn sm" href="https://github.com/lachlanbruce944-droid/chanel-monroe-crm/blob/main/docs/MICROSOFT-365-EMAIL.md" target="_blank" rel="noopener">Full setup guide</a></p><label>Mailbox<input name="mailbox" type="email" value="makeup@chanelmonroe.net" readonly></label><label>Directory (tenant) ID<input name="tenantId" value="${esc(cfg.tenantId||'')}" required autocomplete="off"></label><label>Application (client) ID<input name="clientId" value="${esc(cfg.clientId||'')}" required autocomplete="off"></label><label>Import emails from<input name="syncFrom" type="date" value="${esc(date)}" required></label><p class="small muted">Saving pauses import and restarts scanning from this date. Messages already imported are deduplicated. Only messages from email addresses already in CRM client profiles are imported; ambiguous enquiries wait for you to link them.</p>`,onSubmit:async values=>{await call('save',values);UI.toast('Setup saved. Email import remains paused.');return true;}});
  await refresh();
 }
 async function inbox(){
  if(DB.missing?.emails){UI.toast('Install the email connector backend first. Open Set up email for instructions.','error');return;}
  await DB.refresh();
  const list=messages().filter(m=>!m.reviewedAt).sort((a,z)=>z.receivedAt.localeCompare(a.receivedAt));
  await UI.modal({title:'Client messages to review',wide:true,hideSubmit:true,cancelLabel:'Done',body:list.length?list.map(m=>messageCard(m,true)).join(''):'<p>No client messages waiting for review.</p>'});
 }
 async function review(id,link){
  const m=DB.get('emails',id);if(!m)throw Error('Message not found. Refresh the CRM.');
  if(link){
   const bookings=DB.list('bookings',b=>b.status==='open').sort((a,z)=>(z.eventDate||'').localeCompare(a.eventDate||''));
   if(!bookings.length)throw Error('No open enquiries are available to link');
   await UI.modal({title:'Link client message',submitLabel:'Link & mark reviewed',body:`<p>From ${esc(m.sender)} · ${esc(m.subject)}. Check the client before linking.</p><label>Enquiry<select name="bookingId" required><option value="">Choose an enquiry</option>${bookings.map(b=>{const c=DB.get('clients',b.clientId);return `<option value="${esc(b.id)}">${esc([c?.firstName,c?.lastName,b.eventType,b.eventDate].filter(Boolean).join(' · '))}</option>`}).join('')}</select></label>`,onSubmit:async values=>{await call('review',{messageId:id,bookingId:values.bookingId});return true;}});
  }else await call('review',{messageId:id});
  await DB.refresh();await refresh();
  document.querySelectorAll('[data-message-id="'+id+'"]').forEach(button=>{if(DB.get('emails',id)?.reviewedAt){button.textContent='Reviewed';button.disabled=true;}});
 }
 document.addEventListener('click',async e=>{
  const button=e.target.closest('[data-mail-action]');if(!button)return;
  button.disabled=true;
  try{
   const action=button.dataset.mailAction;
   if(action==='setup')await setup();else if(action==='inbox')await inbox();
   else if(action==='review'||action==='link')await review(button.dataset.messageId,action==='link');
   else{
    const r=await call(action);
    UI.toast(action==='sync'?`${r.imported} new messages imported${r.more?' · more queued for next sync':''}`:action==='test'?'Microsoft 365 connection verified':action==='enable'?'Email import enabled. Automatic sync needs the server schedule.':'Email import paused');
    if(action==='sync')await DB.refresh();await refresh();
   }
  }catch(err){UI.toast(err.message,'error')}finally{if(button.textContent!=='Reviewed')button.disabled=false;}
 });
 window.EmailConnector={panel,mount:refresh,bookingPanel,call};
})();