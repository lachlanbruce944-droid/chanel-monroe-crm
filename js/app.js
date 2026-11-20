/* ==========================================================================
   Chanel Monroe CRM — screens, routing and event handling
   ========================================================================== */
(function () {
  const { esc, money, fmtDate, fmtShort, fmtTime, fmtDateTime, relDays, daysUntil, today, ymd, parseYmd, addDays,
    icon, stars, toast, modal, confirmBox, toLocalInput, copyText, download, pad } = UI;
  const W = Workflow;
  const $app = () => document.getElementById('app');
  const state = { calMonth: null, calSelected: today(), showLost: false, invoiceFilter: 'all', pipelineFilter: 'active', connectionProfession: 'all' };
  const blobCache = new Map();

  /* ---------------- routing ---------------- */
  const parts = () => (location.hash.replace(/^#\/?/, '').split('?')[0] || '').split('/').filter(Boolean);

  function render() {
    const [p0, p1] = parts();
    if (Auth.recovery) return renderNewPassword();
    if (p0 === 'enquire') return renderPublicEnquiry();
    if (!Auth.session) return p0 === 'signup' ? renderSignup() : renderLogin();
    if (!Auth.isStaff()) return renderPending();
    let view;
    switch (p0) {
      case undefined: view = viewDashboard(); break;
      case 'pipeline': view = viewPipeline(); break;
      case 'booking': view = viewBooking(p1); break;
      case 'clients': view = viewClients(); break;
      case 'client': view = viewClient(p1); break;
      case 'calendar': view = viewCalendar(); break;
      case 'invoices': view = viewInvoices(); break;
      case 'invoice': view = viewInvoice(p1); break;
      case 'reviews': view = viewReviews(); break;
      case 'employees': view = viewEmployees(p1); break;
      case 'marketing': view = viewSoon('Marketing', 'megaphone', 'Campaigns, the mailing list, Instagram posts and referral offers will live here.'); break;
      case 'inventory': view = viewSoon('Inventory', 'box', 'Kit stock, product shades, expiry dates and reorder reminders will live here.'); break;
      case 'settings': view = window.Connectors ? Connectors.view() : {title:'Settings',html:'<p>Refresh the page to load connector settings.</p>'}; break;
      case 'profile': view = viewProfile(); break;
      case 'services': view = viewServices(); break;
      case 'new': view = viewNewEnquiry(p1); break;
      default: view = { title: 'Not found', html: '<div class="empty">That page doesn’t exist. <a href="#/">Go home</a></div>' };
    }
    if (p0 === 'settings' && Auth.current.role === 'owner') {
      const enabled = W.developerModeEnabled();
      view.html += `<section class="card"><h2>Developer mode</h2>
        <p>Complete a phone consult or advance past the booked event day early. Changes are saved to the live CRM.</p>
        <button type="button" class="btn" data-act="toggleDeveloperMode">${enabled ? 'Disable' : 'Enable'} developer mode</button>
      </section>`;
    }
    renderShell(view, p0 || '');
    initialiseEditCards();
    if (view.after) view.after();
    loadPhotos();
    loadClientPortraits().catch(err=>console.warn('Client portraits unavailable',err));
  }
  function rerender() { const y = window.scrollY; render(); window.scrollTo(0, y); }
  const go = h => { if (location.hash === h) rerender(); else location.hash = h; };

  /* ---------------- shell ---------------- */
  function renderShell(view, active) {
    const p = W.profile(); const u = Auth.current;
    const due = W.dueReminders().length;
    const newEnq = DB.list('bookings', b => b.stage === 'enquiry' && b.status !== 'lost').length;
    const nav = [['', 'home', 'Dashboard', due], ['pipeline', 'board', 'Enquiries', newEnq], ['calendar', 'calendar', 'Calendar'],
      ['clients', 'users', 'Clients'], ['employees', 'team', 'Connections', DB.list('people', x => x.status === 'applied').length], ['invoices', 'file', 'Invoices'], ['reviews', 'star', 'Reviews'],
      ['marketing', 'megaphone', 'Marketing'], ['inventory', 'box', 'Inventory'], ['services', 'layers', 'Services'], ['profile', 'user', 'Profile'], ['settings', 'settings', 'Settings']];
    const isActive = k => active === k || (k === 'employees' && active === 'employees') || (k === 'pipeline' && active === 'booking') || (k === 'clients' && active === 'client') || (k === 'invoices' && active === 'invoice');
    const tabs = nav.filter(n => ['', 'pipeline', 'calendar', 'clients', 'employees', 'settings'].includes(n[0]));
    $app().innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <a class="brand" href="#/">${avatarHtml(p, 'brand-mark')}<div><div class="brand-name">${esc(p.businessName)}</div><div class="brand-sub">Client studio</div></div></a>
        <nav class="side-nav">${nav.map(([k, ic, l, n]) => `<a href="#/${k}" class="${isActive(k) ? 'active' : ''}">${icon(ic)}<span>${l}</span>${n ? `<b class="count">${n}</b>` : ''}</a>`).join('')}</nav>
        <a class="btn primary block" href="#/new">${icon('plus')} New enquiry</a>
        <div class="side-foot"><div><strong>${esc(u.name)}</strong><small>${esc(u.email)}</small></div>
          <button class="icon-btn" data-act="logout" title="Sign out" aria-label="Sign out">${icon('logout')}</button></div>
      </aside>
      <div class="main">
        <header class="topbar">
          ${view.back ? `<a class="icon-btn back" href="${view.back}" aria-label="Back">${icon('chevL')}</a>` : ''}
          <div class="titles"><h1>${icon((nav.find(n=>isActive(n[0]))||[])[1]||'file','section-icon')}${esc(view.title)}</h1>${view.subtitle ? `<p>${view.subtitle}</p>` : ''}</div>
          ${W.developerModeEnabled() ? `<button type="button" class="developer-mode-indicator" data-act="toggleDeveloperMode" title="Turn off developer mode">
            <span aria-hidden="true"></span>Developer mode enabled
          </button>` : ''}
          <div class="top-actions">${view.actions || ''}</div>
        </header>
        <main class="content">${view.html}</main>
      </div>
      <nav class="tabbar">${tabs.map(([k, ic, l, n]) => `<a href="#/${k}" class="${isActive(k) ? 'active' : ''}">${icon(ic)}<span>${l === 'Dashboard' ? 'Home' : l}</span>${n ? '<i></i>' : ''}</a>`).join('')}</nav>
      <a class="fab" href="#/new" aria-label="New enquiry">${icon('plus')}</a>
    </div>`;
  }
  const avatarHtml = (p, cls) => p.avatar ? `<img class="${cls}" src="${p.avatar}" alt="">` : `<div class="${cls}">${esc((p.artistName || 'CM').split(' ').map(s => s[0]).join('').slice(0, 2))}</div>`;

  /* ---------------- shared bits ---------------- */
  const stageBadge = b => b.archivedAt ? '<span class="badge lost">Archived</span>' : b.status === 'lost' ? '<span class="badge lost">Lost</span>' : `<span class="badge s-${b.stage}">${esc(W.stage(b.stage).short)}</span>`;
  const daysBadge = b => {
    if (!b.eventDate) return '';
    const n = daysUntil(b.eventDate);
    const cls = n < 0 ? 'past' : n <= 7 ? 'soon' : '';
    return `<span class="days ${cls}">${n === 0 ? 'Today' : n > 0 ? n + 'd' : Math.abs(n) + 'd ago'}</span>`;
  };
  function reminderRow(r, showClient = true) {
    const b = DB.get('bookings', r.bookingId); const c = b ? W.clientOf(b) : null;
    const overdue = new Date(r.dueAt) < new Date(new Date().setHours(0, 0, 0, 0));
    return `<li class="rem ${overdue ? 'overdue' : ''} ${r.status !== 'pending' ? 'closed' : ''}">
      <div class="rem-ic">${icon(r.kind === 'call' ? 'phone' : r.templateKey ? 'message' : 'bell')}</div>
      <div class="rem-main"><strong>${esc(r.title)}</strong>
        <small>${overdue ? 'Overdue · ' : ''}${fmtDateTime(r.dueAt)}${showClient && b ? ` · <a href="#/booking/${b.id}">${esc(W.clientName(c))}</a>` : ''}${r.status !== 'pending' ? ' · ' + r.status : ''}</small></div>
      ${r.status === 'pending' ? `<div class="rem-act">
        ${r.templateKey ? `<button class="btn sm" data-act="remSend" data-id="${r.id}">Send</button>` : ''}
        <button class="icon-btn" data-act="remDone" data-id="${r.id}" title="Done">${icon('check')}</button>
        <button class="icon-btn" data-act="remSkip" data-id="${r.id}" title="Skip">${icon('x')}</button></div>` : ''}
    </li>`;
  }
  const empty = (text, cta = '') => `<div class="empty">${text}${cta ? '<div>' + cta + '</div>' : ''}</div>`;

  /* ================= DASHBOARD ================= */
  function viewDashboard() {
    const u = Auth.current; const td = today();
    const open = DB.list('bookings', b => b.status !== 'lost');
    const newEnq = open.filter(b => b.stage === 'enquiry');
    const upcoming = open.filter(b => b.eventDate && b.eventDate >= td && W.idx(b.stage) >= W.idx('deposit') && W.idx(b.stage) <= W.idx('day'))
      .sort((a, b) => a.eventDate.localeCompare(b.eventDate));
    const outstanding = open.filter(b => W.idx(b.stage) >= W.idx('deposit')).reduce((s, b) => s + W.totals(b).balance, 0);
    const month = td.slice(0, 7);
    const paidMonth = DB.list('payments', x => (x.paidAt || '').slice(0, 7) === month).reduce((s, x) => s + +x.amount, 0);
    const confirmedMonth = open.filter(b => (b.eventDate || '').slice(0, 7) === month && W.idx(b.stage) >= W.idx('booked')).length;
    const due = W.dueReminders();
    const hr = new Date().getHours();
    const greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    const counts = W.STAGES.map(s => [s, open.filter(b => b.stage === s.key).length]);
    return {
      title: `${greet}, ${u.name.split(' ')[0]}`,
      subtitle: new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }),
      html: `
      <section class="stats">
        <a class="stat" href="#/pipeline"><span>New enquiries</span><strong>${newEnq.length}</strong></a>
        <a class="stat" href="#/calendar"><span>Booked this month</span><strong>${confirmedMonth}</strong></a>
        <a class="stat" href="#/invoices"><span>Owing to you</span><strong>${money(outstanding)}</strong></a>
        <a class="stat" href="#/invoices"><span>Paid this month</span><strong>${money(paidMonth)}</strong></a>
      </section>
      <div class="grid-2">
        <section class="card">
          <div class="card-head"><h2>To do today</h2><span class="muted">${due.length} item${due.length === 1 ? '' : 's'}</span></div>
          ${due.length ? `<ul class="rem-list">${due.map(r => reminderRow(r)).join('')}</ul>` : empty('Nothing due. Enjoy the breather ✨')}
        </section>
        <section class="card">
          <div class="card-head"><h2>Coming up</h2><a href="#/calendar" class="muted">Calendar →</a></div>
          ${upcoming.length ? `<ul class="list">${upcoming.slice(0, 6).map(b => {
            const c = W.clientOf(b);
            return `<li><a href="#/booking/${b.id}" class="list-row"><div class="date-chip"><b>${parseYmd(b.eventDate).getDate()}</b><small>${parseYmd(b.eventDate).toLocaleDateString('en-AU', { month: 'short' })}</small></div>
              <div class="grow"><strong>${esc(W.clientName(c))}</strong><small>${esc(b.eventType || '')}${b.readyBy ? ' · ready by ' + fmtTime(b.readyBy) : ''}${b.location ? ' · ' + esc(b.location) : ''}</small></div>${stageBadge(b)}</a></li>`;
          }).join('')}</ul>` : empty('No confirmed bookings coming up yet.')}
        </section>
      </div>
      <section class="card">
        <div class="card-head"><h2>Pipeline</h2><a href="#/pipeline" class="muted">Open board →</a></div>
        <div class="funnel">${counts.map(([s, n]) => `<a href="#/pipeline" class="funnel-step ${n ? '' : 'zero'}"><strong>${n}</strong><span>${s.short}</span></a>`).join('')}</div>
      </section>
      <section class="card soft">
        <div class="card-head"><h2>Client enquiry form</h2></div>
        <p class="muted">Enquiries from the website chat land in the Enquiry column automatically, for review and phone consultation approval. This backup form works the same way. Use it to take an enquiry over the phone.</p>
        <div class="row gap"><a class="btn" href="#/enquire" target="_blank">Open client form</a><a class="btn ghost" href="#/new">Add enquiry manually</a></div>
      </section>`
    };
  }

  /* ================= PIPELINE ================= */
  function viewPipeline() {
    const all = DB.list('bookings').sort((a,b)=>(a.eventDate||'9999').localeCompare(b.eventDate||'9999'));
    const active = all.filter(b=>b.status!=='lost'&&b.stage!=='complete');
    const matches = b => state.pipelineFilter==='archived' ? !!b.archivedAt : !b.archivedAt && matchesUnarchived(b);
    const matchesUnarchived = b => state.pipelineFilter==='active' ? b.status!=='lost'&&b.stage!=='complete' : state.pipelineFilter==='lost' ? b.status==='lost' : b.status!=='lost'&&b.stage===state.pipelineFilter;
    const list=all.filter(matches);
    const filters=[['active','Active',active.length],['enquiry','New enquiries',active.filter(b=>b.stage==='enquiry').length],['deposit','Awaiting deposit',active.filter(b=>b.stage==='deposit').length],['booked','Booked',active.filter(b=>b.stage==='booked').length],['complete','Completed',all.filter(b=>b.status!=='lost'&&b.stage==='complete').length],['lost','Lost / cancelled',all.filter(b=>b.status==='lost'&&!b.archivedAt).length],['archived','Archived',all.filter(b=>b.archivedAt).length]];
    const rows=list.map(b=>{
      const c=W.clientOf(b),t=W.totals(b),r=DB.list('reminders',r=>r.bookingId===b.id&&r.status==='pending').sort((a,b)=>(a.dueAt||'').localeCompare(b.dueAt||''))[0];
      const overdue=r&&new Date(r.dueAt)<new Date();
      const next=b.archivedAt?'Archived':b.status==='lost'?'Closed':b.stage==='complete'?'Completed':r?.title||STAGE_ACTIONS[b.stage]?.[0]?.[2]||'Review booking';
      return `<article class="enquiry-row deal" data-search="${esc([W.clientName(c),c.email,c.phone,b.eventType,b.location].join(' ').toLowerCase())}">
        <div class="enquiry-identity"><strong>${esc(W.clientName(c))}</strong><span class="muted">${esc(b.eventType||'Service to confirm')}</span><small>${esc(c.email||c.phone||'Add contact details')}</small></div>
        <div><small class="muted">Event date</small><div>${fmtShort(b.eventDate)}</div><small class="muted">${esc(b.location||'Location to confirm')}</small></div>
        <div>${stageBadge(b)}<div class="enquiry-next ${overdue?'overdue':''}">${overdue?'● ':''}${esc(next)}${r?' · '+fmtShort(r.dueAt):''}</div></div>
        <div class="enquiry-value"><strong>${t.total?money(t.total):'Quote needed'}</strong>${t.total?`<small class="muted">${money(t.balance)} remaining</small>`:''}</div>
        <a class="btn sm" href="#/booking/${b.id}">Open ${b.stage==='enquiry'?'enquiry':'booking'} →</a></article>`;
    }).join('');
    return {title:'Enquiries & bookings',subtitle:`${active.length} active · see the next step for every client`,
      actions:`<label class="search">${icon('search')}<input type="search" placeholder="Search name, email or service" data-filter=".deal"></label><a class="btn primary sm" href="#/new">${icon('plus')} New enquiry</a>`,
      html:`<nav class="enquiry-filters">${filters.map(([k,l,n])=>`<button class="enquiry-filter ${state.pipelineFilter===k?'selected':''}" data-act="pipelineFilter" data-arg="${k}"><span>${l}</span><strong>${n}</strong></button>`).join('')}</nav>
      <section class="card"><div class="card-head"><div><h2>${esc(filters.find(f=>f[0]===state.pipelineFilter)?.[1]||'Enquiries')}</h2><span class="muted small">${list.length} records · earliest event first</span></div></div>
      ${list.length ? `<div class="enquiry-list">${rows}</div>` : empty('Nothing in this view yet. New website enquiries arrive automatically.','<a class="btn" href="#/new">Add an enquiry</a>')}</section>`};
  }

  /* ================= BOOKING DETAIL ================= */
  const STAGE_ACTIONS = {
    enquiry: [['scheduleCall', '', 'Schedule phone consultation', ''], ['approveConsultation', '', 'Chanel: approve consultation', 'primary']],
    call: [['scheduleCall', '', 'Reschedule consultation', ''], ['approveConsultation', '', 'Chanel: approve consultation', ''], ['logCall', '', 'Complete call & save details', 'primary']],
    updates: [['logCall', '', 'Add update', 'ghost'], ['sendQuote', '', 'Review quote & deposit', 'primary']],
    deposit: [['tpl', 'deposit_reminder', 'Chase deposit', ''], ['payment', 'deposit', 'Record deposit', 'primary']],
    booked: [['tpl', 'deposit_received', 'Send booking confirmation', ''], ['advance', '', 'Start the day', 'primary']],
    day: [['photo', '', 'Upload photos / videos', ''], ['addReview', '', 'Record verbal / written feedback', ''], ['advance', '', 'Review final invoice', 'primary']],
    invoice: [['tpl', 'final_invoice', 'Send final invoice', ''], ['payment', 'final', 'Record payment', 'primary']],
    review: [['tpl', 'service_followup', 'Send thank-you & receipt', 'primary'], ['tpl', 'review_request', 'Ask for a review', ''], ['addReview', '', 'Record review', 'primary']],
    complete: []
  };


  function referenceImageUrl(src) {
    if (typeof src !== 'string' || !src.trim()) return '';
    if (/^https?:\/\//i.test(src)) return safeWeb(src);
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) || /^\/\//.test(src)) return '';
    const path = src.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
    return window.CRM_CONFIG.supabaseUrl + '/storage/v1/object/public/media/' + path;
  }

  function showEnquiryImage(title, src, credit = '') {
    return modal({title, wide:true, hideSubmit:true, cancelLabel:'Close',
      body:`<img class="photo-full" src="${esc(src)}" alt="${esc(title)}">
        ${credit ? `<p class="muted small">${esc(credit)}</p>` : ''}
        <a class="btn sm" href="${esc(src)}" target="_blank" rel="noopener">Open full image ↗</a>`});
  }

  /** Everything the client chose in the website's chat enquiry. */
  function websiteCard(b) {
    const w = (b.answers || {}).website; if (!w) return '';
    const arr = v => Array.isArray(v) ? v : [];
    const lessons = arr(w.lessonFocus).map(x => typeof x === 'string' ? x : (x.name || JSON.stringify(x)));
    const rows = [
      ['Category', w.category], ['Look', [w.look, w.subStyle].filter(Boolean).join(' · ')], ['How many', w.quantity],
      ['Time given as', w.timeType === 'ready_by' ? 'Ready by' : w.timeType ? 'Start time' : ''],
      ['Lashes', w.lashes], ['Patch test wanted', w.patchTest ? 'Yes' : ''], ['Lesson focus', lessons.join(', ')],
      ['Other services', arr(w.extras).join(', ')],
      ['Website estimate', w.estimate ? `${w.estimateIsFrom ? 'from ' : ''}${money(w.estimate)}${w.deposit ? ` (deposit ~${money(w.deposit)})` : ''}` : ''],
      ['Travel', w.travelKm ? `about ${w.travelKm} km · ${w.travelIncluded ? 'included' : 'fee ' + money(w.travelFee || 0)}` : ''],
      ['Mailing list', w.mailingList ? 'Opted in' : '']
    ].filter(r => r[1]);
    const refs = arr(w.refs).filter(r => r && r.src);
    const team = arr(w.affiliates).filter(a => a && (a.handle || a.name));
    return `<div class="notes web">
      <h3>From the website enquiry</h3>
      <dl class="answers">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${refs.length ? `<h3>Reference looks they picked</h3><div class="ref-grid">${refs.map(r => `<button type="button" data-act="viewReference" data-src="${esc(referenceImageUrl(r.src))}" data-title="${esc(r.desc || 'Reference look')}" data-credit="${esc(r.by || '')}" aria-label="View reference image"><img src="${esc(referenceImageUrl(r.src))}" alt="" loading="lazy"><span>${esc(r.by || '')}</span></button>`).join('')}</div>` : ''}
      ${b.websiteEnquiryId || w.enquiryId ? `<button type="button" class="btn sm" data-act="viewEnquirySelfie" data-id="${esc(b.websiteEnquiryId || w.enquiryId)}">View enquiry selfie</button>` : ''}
      ${team.length ? `<h3>Beauty team they’re interested in</h3><ul class="team">${team.map(a => `<li><a href="${esc(a.instagram || a.site || '#')}" target="_blank" rel="noopener">@${esc(a.handle || a.name)}</a> <small class="muted">${esc(a.category || '')}</small></li>`).join('')}</ul>` : ''}
    </div>`;
  }

  function viewBooking(id) {
    const b = DB.get('bookings', id);
    if (!b) return { title: 'Booking not found', back: '#/pipeline', html: empty('This booking may have been deleted.') };
    const c = W.clientOf(b); const t = W.totals(b); const chk = W.checkNext(b); const si = W.idx(b.stage);
    const lost = b.status === 'lost';
    const invoices = DB.list('invoices', x => x.bookingId === b.id).sort((a, z) => a.number.localeCompare(z.number));
    const pays = DB.list('payments', x => x.bookingId === b.id).sort((a, z) => (a.paidAt || '').localeCompare(z.paidAt || ''));
    const rems = DB.list('reminders', r => r.bookingId === b.id).sort((a, z) => a.dueAt.localeCompare(z.dueAt));
    const photos = DB.list('photos', p => p.bookingId === b.id).sort((a, z) => a.createdAt.localeCompare(z.createdAt));
    const acts = DB.list('activity', a => a.bookingId === b.id).sort((a, z) => z.at.localeCompare(a.at));
    const review = DB.find('reviews', r => r.bookingId === b.id);
    const clashes = b.eventDate ? W.dateClashes(b) : [];
    const ans = b.answers || {};
    const svcOptions = W.services(true).map(s => `<option value="${s.id}">${esc(s.name)} — ${money(s.price)}</option>`).join('');

    const nextCard = lost
      ? `<section class="card next lost"><h2>Marked lost</h2><p>${esc(b.lostReason || 'No reason given')}</p><button class="btn primary" data-act="reopen" data-id="${b.id}">Reopen booking</button></section>`
      : `<section class="card next">
        <div class="next-head"><span class="eyebrow">Step ${si + 1} of ${W.STAGES.length}</span><h2>${esc(W.stage(b.stage).label)}</h2></div>
        <p>${esc(W.stage(b.stage).hint)}</p>
        ${b.enquiryReviewNotes ? `<div class="notes"><h3>Enquiry review</h3><p>${esc(b.enquiryReviewNotes).replace(/\n/g, '<br>')}</p></div>` : ''}
        ${!b.callAt && b.stage === 'enquiry' ? '<p class="callout">Choose the phone consultation time in the CRM calendar. Chanel approves it; the client does not need to confirm.</p>' : ''}
        ${b.consultation ? `<p class="callout">${icon('phone')} CRM phone consultation · ${b.consultation.status === 'confirmed' && b.consultation.provider === 'crm' ? 'Approved by Chanel' : 'Pending Chanel’s approval'} · ${fmtDateTime(b.consultation.startTime)} · Brisbane time${b.consultation.emailStatus ? ' · Email: ' + esc(b.consultation.emailStatus) : ''}</p>` : ''}
        ${b.stage === 'call' && b.callAt ? `<p class="callout">${icon('phone')} Call ${relDays(ymd(new Date(b.callAt)))} · ${fmtDateTime(b.callAt)}</p>` : ''}
        ${chk.next && chk.reasons.length ? `<ul class="checks">${chk.reasons.map(r => `<li class="${r.soft ? 'soft' : 'hard'}">${esc(r.text)}</li>`).join('')}</ul>` : ''}
        <div class="next-actions">${STAGE_ACTIONS[b.stage].map(([act, arg, label, cls]) => `<button class="btn ${cls}" data-act="${act}" data-id="${b.id}" data-arg="${arg}">${label}</button>`).join('')}</div>
        <div class="next-foot">
          ${si > 0 ? `<button class="link" data-act="back" data-id="${b.id}">← Back a step</button>` : '<span></span>'}
          ${chk.next && !['enquiry','call'].includes(b.stage) ? `<button class="link" data-act="advance" data-id="${b.id}">Skip to ${esc(chk.next.short)} →</button>` : ''}
        </div>
      </section>`;

    return {
      title: W.clientName(c),
      subtitle: `${esc(b.eventType || 'Event')} · ${b.eventDate ? fmtDate(b.eventDate) + ' (' + relDays(b.eventDate) + ')' : 'date TBC'}`,
      back: '#/pipeline',
      actions: `${stageBadge(b)}<button class="btn ghost sm" data-act="bookingMenu" data-id="${b.id}">More</button>`,
      html: `
      <ol class="stepper ${lost ? 'is-lost' : ''}">${W.STAGES.map((s, i) => `<li class="${i < si ? 'done' : i === si ? 'current' : ''}"><span>${i < si ? icon('check') : i + 1}</span><em>${s.short}</em></li>`).join('')}</ol>
      <div class="detail">
        <div class="detail-main">
          ${nextCard}

          ${window.Connectors ? Connectors.bookingPanel(b) : ''}
          ${window.EmailConnector ? EmailConnector.bookingPanel(b) : ''}
          <section class="card" id="details">
            <div class="card-head"><h2>Event details</h2><span class="eyebrow">Occasion & preparation</span></div>
            ${clashes.length ? `<p class="warn">Heads up: ${clashes.map(x => esc(W.clientName(W.clientOf(x)))).join(', ')} also booked on this date.</p>` : ''}
            <form data-form="details" data-id="${b.id}" class="form-grid">
              <div class="span-2 detail-group"><h3>Occasion & timing</h3><p class="muted">All appointment times use Brisbane time.</p></div>
              <label>Event type<select name="eventType">${[...new Set(['', ...W.EVENT_TYPES, b.eventType || ''])].map(e => `<option ${e === b.eventType ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select></label>
              <label>Event date<input type="date" name="eventDate" value="${esc(b.eventDate)}"></label>
              <label>Ready by<input type="time" name="readyBy" value="${esc(b.readyBy)}"></label>
              <label>Start time<input type="time" name="startTime" value="${esc(b.startTime || '')}"></label>
              <div class="span-2 detail-group"><h3>Venue & people</h3></div>
              <label class="span-2">Location / address<input name="location" value="${esc(b.location)}" placeholder="Venue, suburb or full address"></label>
              <label>People needing makeup<input type="number" min="1" name="partySize" value="${esc(b.partySize || 1)}"></label>
              <label>Trial<select name="trial">${['', 'Yes', 'No', 'Not sure', 'Done'].map(o => `<option ${o === (ans.trial || '') ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
              <div class="span-2 detail-group"><h3>Style & preparation</h3></div>
              <label class="span-2">Look / notes<textarea name="look" rows="3">${esc(ans.look || '')}</textarea></label>
              <div class="span-2 row end"><button class="btn sm">Save details</button></div>
            </form>
            ${ans.callPref || ans.heardFrom || ans.notes ? `<dl class="answers">
              ${ans.callPref ? `<dt>Best time to call</dt><dd>${esc(ans.callPref)}</dd>` : ''}
              ${ans.heardFrom ? `<dt>Found you via</dt><dd>${esc(ans.heardFrom)}</dd>` : ''}
              ${ans.notes ? `<dt>Other notes</dt><dd>${esc(ans.notes).replace(/\n/g, '<br>')}</dd>` : ''}</dl>` : ''}
            ${websiteCard(b)}
            ${b.callNotes ? `<div class="notes"><h3>Call notes</h3><p>${esc(b.callNotes).replace(/\n/g, '<br>')}</p></div>` : ''}
          </section>

          <section class="card" id="quote">
            <div class="card-head"><h2>Service Quote</h2>${t.total ? `<strong>${money(t.total)}</strong>` : ''}</div>
            <table class="lines">
              <thead><tr><th>Service</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th><th></th></tr></thead>
              <tbody>${(b.lines || []).map((l, i) => `<tr>
                <td><input value="${esc(l.name)}" data-change="line" data-id="${b.id}" data-i="${i}" data-field="name"></td>
                <td class="num"><input type="number" min="0" value="${esc(l.qty)}" data-change="line" data-id="${b.id}" data-i="${i}" data-field="qty"></td>
                <td class="num"><input type="number" min="0" step="0.01" value="${esc(l.price)}" data-change="line" data-id="${b.id}" data-i="${i}" data-field="price"></td>
                <td class="num">${money(l.qty * l.price)}</td>
                <td><button class="icon-btn" data-act="removeLine" data-id="${b.id}" data-i="${i}" title="Remove">${icon('x')}</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No services yet — add one below.</td></tr>'}
              </tbody>
            </table>
            <form data-form="addLine" data-id="${b.id}" class="row gap add-line"><select name="serviceId" required><option value="">Add a service…</option>${svcOptions}</select><input type="number" name="qty" min="1" value="1" class="qty"><button class="btn sm">${icon('plus')} Add</button></form>
            ${b.callLoggedAt ? Object.entries(window.QuoteExtras.catalog).map(([phase, extras]) => `<form data-form="addQuoteExtra" data-id="${esc(b.id)}" data-phase="${phase}" class="row gap add-line">
              <label>${phase === 'before' ? 'Before appointment' : 'After appointment'}<select name="extra" required><option value="">Choose an extra…</option>${Object.entries(extras).map(([key, label]) => `<option value="${key}">${esc(label)}</option>`).join('')}</select></label>
              <label>Qty<input name="qty" type="number" class="qty" min="1" value="1" required></label>
              <label>Unit price (AUD)<input name="price" type="number" min="0" step="0.01" required></label>
              <button class="btn sm" type="submit">${icon('plus')} Add extra</button>
            </form>`).join('') : '<p class="muted">Complete the phone consultation to add before- and after-appointment extras.</p>'}
            <div class="totals">
              <label>Travel fee<input type="number" min="0" step="0.01" value="${esc(b.travelFee)}" data-change="money" data-id="${b.id}" data-field="travelFee" placeholder="0"></label>
              <label>Discount<input type="number" min="0" step="0.01" value="${esc(b.discount)}" data-change="money" data-id="${b.id}" data-field="discount" placeholder="0"></label>
              <label>Deposit<input type="number" min="0" step="0.01" value="${esc(b.depositAmount)}" data-change="money" data-id="${b.id}" data-field="depositAmount" placeholder="${t.deposit} (${W.profile().depositPercent}%)"></label>
              <dl><dt>Total</dt><dd>${money(t.total)}</dd>${t.gst ? `<dt>incl. GST</dt><dd>${money(t.gst)}</dd>` : ''}<dt>Deposit</dt><dd>${money(t.deposit)}</dd><dt>Paid</dt><dd>${money(t.paid)}</dd><dt class="strong">Balance</dt><dd class="strong">${money(t.balance)}</dd></dl>
            </div>
            <div class="row end"><button type="button" class="btn primary" data-act="quoteStripe" data-id="${b.id}">Review quote for Stripe</button></div>
          </section>

          ${b.callLoggedAt ? `<section class="card"><h2>Service notes & additional costs</h2><form data-form="serviceNotes" data-id="${b.id}" class="form-grid"><label class="span-2">Additional notes<textarea name="serviceNotes" rows="4">${esc(b.serviceNotes || '')}</textarea></label><label>Agreed additional costs<input name="additionalCosts" type="number" min="0" step="0.01" value="${esc(b.additionalCosts || 0)}"></label><label>Cost description<input name="additionalCostsReason" value="${esc(b.additionalCostsReason || '')}"></label><div class="span-2"><button class="btn sm">Save service notes & costs</button></div></form></section>` : ''}
          <section class="card" id="photos">
            <div class="card-head"><h2>Photos & videos</h2><label class="btn sm">${icon('camera')} Upload<input type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple hidden data-change="photos" data-id="${b.id}"></label></div>
            <div class="row gap kind-pick"><span class="muted">Upload as (videos up to 6 MB):</span>${['inspo', 'before', 'after', 'day'].map(k => `<label class="chip"><input type="radio" name="photoKind" value="${k}" ${k === (b.stage === 'day' || si > W.idx('day') ? 'day' : 'inspo') ? 'checked' : ''}>${k === 'inspo' ? 'Inspiration' : k[0].toUpperCase() + k.slice(1)}</label>`).join('')}</div>
            ${photos.length ? `<div class="photo-grid">${photos.map(p => `<button class="photo" data-act="viewPhoto" data-id="${p.id}">${p.mediaType === 'video' ? '<span aria-label="Video">▶ Video</span>' : `<img data-photo="${p.id}" alt="">`}<span>${esc(p.kind)}</span></button>`).join('')}</div>` : empty('No photos yet. Add inspiration pics now and before/after shots on the day.')}
          </section>
        </div>

        <div class="detail-side">
          <section class="card client-card">
            <div class="card-head"><h2>Client</h2><a href="#/client/${c.id}" class="muted">Profile →</a></div>
            <div class="contact">
              ${c.phone ? `<a href="tel:${esc(c.phone.replace(/\s/g, ''))}">${icon('phone')}${esc(c.phone)}</a>` : ''}
              ${c.email ? `<a href="mailto:${esc(c.email)}">${icon('mail')}${esc(c.email)}</a>` : ''}
              ${c.instagram ? `<a href="https://instagram.com/${esc(c.instagram.replace('@', ''))}" target="_blank">${icon('insta')}${esc(c.instagram)}</a>` : ''}
            </div>
            ${c.skinType || c.allergies ? `<dl class="answers"><dt>Skin</dt><dd>${esc(c.skinType || '—')}</dd>${c.allergies ? `<dt>Allergies / sensitivities</dt><dd class="alert">${esc(c.allergies)}</dd>` : ''}</dl>` : ''}
          </section>

          <section class="card">
            <div class="card-head"><h2>Messages</h2></div>
            <div class="tpl-list">${Object.entries(W.TEMPLATES).filter(([k, v]) => !['enquiry_reply','call_confirm'].includes(k) && Math.abs(W.idx(v.stage) - si) <= 1).map(([k, v]) => `<button class="tpl" data-act="tpl" data-id="${b.id}" data-arg="${k}">${icon('message')}${esc(v.label)}</button>`).join('')}
              <button class="tpl muted" data-act="allTemplates" data-id="${b.id}">All templates…</button></div>
          </section>

          <section class="card">
            <div class="card-head"><h2>Payments</h2><button class="btn sm" data-act="payment" data-id="${b.id}" data-arg="${si < W.idx('booked') ? 'deposit' : 'final'}">${icon('plus')} Payment</button></div>
            ${invoices.length ? `<ul class="list inv">${invoices.map(i => `<li><a class="list-row" href="#/invoice/${i.id}"><div class="grow"><strong>${esc(i.number)}</strong><small>${i.type === 'deposit' ? 'Deposit' : 'Final'} · due ${fmtShort(i.dueAt)}</small></div><span>${money(i.total)}</span><span class="badge inv-${i.status}">${i.status}</span></a></li>`).join('')}</ul>` : '<p class="muted small">Invoices are created automatically when you send the quote and when the day is done.</p>'}
            ${pays.length ? `<ul class="list pays">${pays.map(p => `<li class="list-row"><div class="grow"><strong>${money(p.amount)}</strong><small>${esc(p.type)} · ${esc(p.method || '')} · ${fmtShort(p.paidAt)}</small></div><button class="icon-btn" data-act="deletePayment" data-id="${p.id}" title="Remove payment">${icon('x')}</button></li>`).join('')}</ul>` : ''}
          </section>

          <section class="card">
            <div class="card-head"><h2>Reminders</h2><button class="btn sm" data-act="addReminder" data-id="${b.id}">${icon('plus')} Add</button></div>
            ${rems.length ? `<ul class="rem-list compact">${rems.map(r => reminderRow(r, false)).join('')}</ul>` : '<p class="muted small">Reminders are scheduled automatically once the deposit is in.</p>'}
          </section>

          ${review ? `<section class="card"><div class="card-head"><h2>Review</h2></div><div class="stars">${stars(review.rating)}</div><p>${esc(review.text)}</p><small class="muted">${esc(review.source)} · ${fmtShort(review.receivedAt)}</small></section>` : ''}

          <section class="card">
            <div class="card-head"><h2>Activity</h2></div>
            ${b.callLoggedAt ? `<form data-form="note" data-id="${b.id}" class="row gap"><input name="text" placeholder="Add a note…" required><button class="btn sm">Add</button></form>` : '<p class="small muted">Add staff notes after the phone consultation.</p>'}
            <ul class="timeline">${acts.slice(0, 40).map(a => `<li class="t-${a.type}"><p>${esc(a.text)}</p><small>${fmtDateTime(a.at)}</small></li>`).join('')}</ul>
          </section>
        </div>
      </div>`
    };
  }

  /* ================= CLIENTS ================= */
  const portraitUrls = new Map();
  function clientPortrait(c,large=false){return `<span class="avatar client-portrait ${large?'large':''}"><span>${esc((c.firstName||'?')[0])}${esc((c.lastName||'')[0]||'')}</span><img data-client-photo="${c.id}" alt="${esc(W.clientName(c))}" hidden></span>`}
  async function loadClientPortraits(){
    const images=[...document.querySelectorAll('img[data-client-photo]')];if(!images.length||!Auth.isStaff())return;
    const missing=images.map(i=>DB.get('clients',i.dataset.clientPhoto)).filter(c=>c&&!c.portraitPhotoId&&!c.portraitHidden);
    const bookings=DB.list('bookings').filter(b=>missing.some(c=>c.id===b.clientId)).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
    const ids=[...new Set(bookings.map(b=>b.websiteEnquiryId||b.answers?.website?.enquiryId).filter(Boolean))],paths=new Map();
    for(let n=0;n<ids.length;n+=100){const {data,error}=await DB.client.from('enquiries').select('id,selfie_path').in('id',ids.slice(n,n+100));if(!error)(data||[]).forEach(e=>{if(e.selfie_path)paths.set(e.id,e.selfie_path)})}
    for(const img of images){const c=DB.get('clients',img.dataset.clientPhoto);if(!c||c.portraitHidden)continue;
      const booking=bookings.find(b=>b.clientId===c.id&&paths.has(b.websiteEnquiryId||b.answers?.website?.enquiryId));
      const path=booking&&paths.get(booking.websiteEnquiryId||booking.answers?.website?.enquiryId);const key=c.portraitPhotoId?'crm:'+c.portraitPhotoId:path?'selfie:'+path:'';if(!key)continue;
      let cached=portraitUrls.get(key);if(!cached||cached.until<Date.now()){
        let url=null;if(c.portraitPhotoId)url=await DB.getBlob(c.portraitPhotoId);else{const {data,error}=await DB.client.storage.from('selfies').createSignedUrl(path,600);if(!error)url=data.signedUrl}
        cached={url,until:Date.now()+(url?540000:60000)};portraitUrls.set(key,cached);
      }
      if(cached.url&&img.isConnected){img.onload=()=>{img.hidden=false;img.previousElementSibling.hidden=true};img.onerror=()=>{img.hidden=true;img.previousElementSibling.hidden=false};img.src=cached.url}
    }
  }
  async function saveClientPortrait(c,file){
    if(!file||!file.type.startsWith('image/'))throw Error('Choose an image file.');if(file.size>10*1024*1024)throw Error('Choose an image smaller than 10 MB.');
    const image=await UI.resizeImage(file,600,.85),id=DB.uid();await DB.putBlob(id,image);
    try{await DB.save('clients',{...c,portraitPhotoId:id,portraitHidden:false})}catch(e){await DB.removeBlob(id).catch(()=>{});throw e}
    if(c.portraitPhotoId)await DB.removeBlob(c.portraitPhotoId).catch(()=>{});
  }
  function viewClients() {
    const clients = DB.list('clients').sort((a, b) => W.clientName(a).localeCompare(W.clientName(b)));
    return {
      title: 'Clients', subtitle: `${clients.length} client${clients.length === 1 ? '' : 's'}`,
      actions: `<label class="search">${icon('search')}<input type="search" placeholder="Search" data-filter=".client-row"></label><button class="btn primary sm" data-act="addClient">${icon('plus')} Client</button>`,
      html: clients.length ? `<section class="card flush"><ul class="list">${clients.map(c => {
        const bs = DB.list('bookings', b => b.clientId === c.id).sort((a, z) => (z.eventDate || '').localeCompare(a.eventDate || ''));
        const spent = DB.list('payments', p => p.clientId === c.id).reduce((s, p) => s + +p.amount, 0);
        return `<li class="client-row" data-search="${esc((W.clientName(c) + ' ' + (c.email || '') + ' ' + (c.phone || '') + ' ' + (c.instagram || '')).toLowerCase())}">
          <a class="list-row" href="#/client/${c.id}">${clientPortrait(c)}
          <div class="grow"><strong>${esc(W.clientName(c))}</strong><small>${esc(c.phone || '')}${c.email ? ' · ' + esc(c.email) : ''}</small></div>
          <div class="right"><small>${bs.length} booking${bs.length === 1 ? '' : 's'}</small>${spent ? `<small>${money(spent)} paid</small>` : ''}</div>${bs[0] ? stageBadge(bs[0]) : ''}</a></li>`;
      }).join('')}</ul></section>` : empty('No clients yet.', '<a class="btn primary" href="#/new">Add the first enquiry</a>')
    };
  }

  function viewClient(id) {
    const c = DB.get('clients', id);
    if (!c) return { title: 'Client not found', back: '#/clients', html: empty('This client may have been deleted.') };
    const bs = DB.list('bookings', b => b.clientId === c.id).sort((a, z) => (z.eventDate || '').localeCompare(a.eventDate || ''));
    const photos = DB.list('photos', p => p.clientId === c.id);
    const reviews = DB.list('reviews', r => r.clientId === c.id);
    const spent = DB.list('payments', p => p.clientId === c.id).reduce((s, p) => s + +p.amount, 0);
    const f = (name, label, type = 'text', span = '') => `<label class="${span}">${label}<input type="${type}" name="${name}" value="${esc(c[name] || '')}"></label>`;
    return {
      title: W.clientName(c), subtitle: `Client since ${fmtShort(c.createdAt)} · ${money(spent)} paid · ${esc(c.source || '')}`, back: '#/clients',
      actions: `<a class="btn primary sm" href="#/new/${c.id}">${icon('plus')} New booking</a><button class="btn ghost sm" data-act="deleteClient" data-id="${c.id}">Delete</button>`,
      html: `<section class="card"><div class="client-photo-head">${clientPortrait(c,true)}<div><strong>${esc(W.clientName(c))}</strong><p class="small muted">Private client photo · enquiry selfie used when available</p><label class="btn sm">Add / change photo<input type="file" accept="image/*" hidden data-change="clientPhoto" data-id="${c.id}"></label><button class="btn ghost sm" data-act="removeClientPhoto" data-id="${c.id}">Remove photo</button></div></div></section><div class="detail">
        <div class="detail-main">
          <section class="card"><div class="card-head"><h2>Details</h2></div>
            <form data-form="client" data-id="${c.id}" class="form-grid">
              ${f('firstName', 'First name')}${f('lastName', 'Last name')}${f('email', 'Email', 'email')}${f('phone', 'Phone', 'tel')}${f('instagram', 'Instagram')}${f('birthday', 'Birthday', 'date')}
              <label>Skin type<select name="skinType">${['', 'Normal', 'Dry', 'Oily', 'Combination', 'Sensitive', 'Mature', 'Not sure'].map(o => `<option ${o === (c.skinType || '') ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
              ${f('shades', 'Shades / products used')}
              <label class="span-2">Allergies & sensitivities<input name="allergies" value="${esc(c.allergies || '')}" placeholder="e.g. lash glue, fragrance"></label>
              <label class="span-2">Private notes<textarea name="notes" rows="3">${esc(c.notes || '')}</textarea></label>
              <label class="span-2 check"><input type="checkbox" name="marketingOk" ${c.marketingOk ? 'checked' : ''}> Happy to receive offers & updates</label>
              <div class="span-2 row end"><button class="btn sm">Save client</button></div>
            </form></section>
          <section class="card"><div class="card-head"><h2>Photos</h2></div>
            ${photos.length ? `<div class="photo-grid">${photos.map(p => `<button class="photo" data-act="viewPhoto" data-id="${p.id}">${p.mediaType === 'video' ? '<span aria-label="Video">▶ Video</span>' : `<img data-photo="${p.id}" alt="">`}<span>${esc(p.kind)}</span></button>`).join('')}</div>` : empty('No photos yet.')}</section>
        </div>
        <div class="detail-side">
          <section class="card"><div class="card-head"><h2>Bookings</h2></div>
            ${bs.length ? `<div class="deal-stack">${bs.map(bookingCard).join('')}</div>` : empty('No bookings yet.')}</section>
          ${reviews.length ? `<section class="card"><div class="card-head"><h2>Reviews</h2></div>${reviews.map(r => `<div class="review"><div class="stars">${stars(r.rating)}</div><p>${esc(r.text)}</p></div>`).join('')}</section>` : ''}
        </div></div>`
    };
  }

  /* ================= CALENDAR ================= */
  const calendarStatus = {
    'makeup-hold': 'Makeup hold',
    'makeup-booked': 'Makeup booked',
    'phone-pending': 'Call pending',
    'phone-approved': 'Call approved',
    reminder: 'Reminder'
  };

  function viewCalendar() {
    const td = today();
    if (!state.calMonth) state.calMonth = td.slice(0, 7);
    const [y, m] = state.calMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const start = addDays(first, -((first.getDay() + 6) % 7));        // Monday start
    const items = {};
    const push = (day, it) => { (items[day] = items[day] || []).push(it); };
    DB.list('bookings', b => b.status !== 'lost').forEach(b => {
      const c = W.clientOf(b);
      const href = `#/booking/${b.id}`;
      const name = W.clientName(c);
      if (b.eventDate) {
        const time = b.readyBy || b.startTime;
        const status = W.idx(b.stage) < W.idx('booked') ? 'makeup-hold' : 'makeup-booked';
        const timing = time ? ` · ${b.readyBy ? 'Ready by' : 'Starts'} ${fmtTime(time)}` : '';
        push(b.eventDate, { status, name, sub: (b.eventType || 'Makeup') + timing, href, time });
      }
      if (b.callAt && !b.callLoggedAt) {
        const call = Connectors.brisbaneInput(b.callAt);
        const time = call.slice(11);
        const approved = b.consultation?.provider === 'crm' && b.consultation?.status === 'confirmed';
        push(call.slice(0,10), { status: approved ? 'phone-approved' : 'phone-pending', name,
          sub: fmtTime(time) + ' AEST', href, time });
      }
    });
    DB.list('reminders', r => r.status === 'pending' && !DB.get('bookings',r.bookingId)?.archivedAt && r.kind !== 'call' && !r.kind.startsWith('event_day'))
      .forEach(r => push(ymd(new Date(r.dueAt)), { status:'reminder', name:r.title, href:r.bookingId ? `#/booking/${r.bookingId}` : '#/' }));
    const chronological = (a,b) => (a.time || '99').localeCompare(b.time || '99');
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i); const key = ymd(d);
      const its = (items[key] || []).sort(chronological);
      cells.push(`<button class="day ${d.getMonth() !== m - 1 ? 'out' : ''} ${key === td ? 'today' : ''} ${key === state.calSelected ? 'sel' : ''}" data-act="calDay" data-day="${key}" aria-pressed="${key === state.calSelected}" aria-label="${esc([fmtDate(key), ...its.map(it => calendarStatus[it.status] + ' · ' + it.name)].join(', '))}">
        <span class="n">${d.getDate()}</span>
        <div class="evs">${its.slice(0, 3).map(it => `<span class="cal-entry cal-${it.status}" title="${esc(calendarStatus[it.status] + ' · ' + it.name)}"><strong>${calendarStatus[it.status]}</strong><small>${esc(it.name)}</small></span>`).join('')}${its.length > 3 ? `<i class="more">+${its.length - 3}</i>` : ''}</div>
        ${its.length ? `<span class="dots">${its.slice(0, 4).map(it => `<b class="cal-${it.status}"></b>`).join('')}</span>` : ''}
      </button>`);
    }
    const sel = (items[state.calSelected] || []).sort(chronological);
    return {
      title: first.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }),
      actions: `<button class="btn primary sm" data-act="calendarConsultation">Schedule phone call</button><button class="icon-btn" data-act="calNav" data-arg="-1">${icon('chevL')}</button><button class="btn ghost sm" data-act="calNav" data-arg="0">Today</button><button class="icon-btn" data-act="calNav" data-arg="1">${icon('chevR')}</button>`,
      html: `<section class="card flush cal">
          <div class="cal-head">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<span>${d}</span>`).join('')}</div>
          <div class="cal-grid">${cells.join('')}</div>
        </section>
        <div class="legend cal-legend" aria-label="Calendar statuses">${Object.entries(calendarStatus).map(([status,label]) => `<span class="cal-pill cal-${status}">${label}</span>`).join('')}</div>
        <section class="card">
          <div class="card-head"><h2>${fmtDate(state.calSelected)}</h2><a class="btn sm" href="#/new?date=${state.calSelected}" data-act="newOnDate" data-day="${state.calSelected}">${icon('plus')} Booking</a></div>
          ${sel.length ? `<ul class="list">${sel.map(it => `<li><a class="list-row cal-agenda" href="${it.href}"><div class="grow"><strong>${esc(it.name)}</strong>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</div><span class="cal-pill cal-${it.status}">${calendarStatus[it.status]}</span></a></li>`).join('')}</ul>` : empty('Nothing on this day — it’s free.')}
        </section>`
    };
  }

  /* ================= INVOICES ================= */
  function viewInvoices() {
    const invoices=DB.list('invoices').filter(i=>['deposit','final'].includes(i.type));
    const groups=[...new Set(invoices.map(i=>i.bookingId))].map(id=>({booking:DB.get('bookings',id)||{id},invoices:invoices.filter(i=>i.bookingId===id)}));
    const paid=g=>g.invoices.length===2&&g.invoices.every(i=>i.status==='paid');
    const filter=state.invoiceFilter;
    const visible=groups.filter(g=>filter==='all'||(filter==='paid'?paid(g):!paid(g)));
    const paymentCell=(g,type)=>{const i=g.invoices.find(i=>i.type===type);return `<div class="payment-status ${i?.status==='paid'?'is-paid':'is-pending'}"><span>${icon(i?.status==='paid'?'check':'clock')}${i?.status==='paid'?'Confirmed paid':'Pending'}</span>${i?`<strong class="amount">${money(i.total)}</strong><small>${esc(i.number)}${i.status!=='paid'&&i.dueAt?' · Due '+fmtShort(i.dueAt):''}${['void','voided','uncollectible'].includes(i.stripeStatus)?' · Needs review':''}</small>`:'<small>Not issued yet</small>'}</div>`};
    return {title:'Invoices',subtitle:'Deposit and final payment status',actions:'<button class="btn sm ghost" data-act="exportCsv">'+icon('file')+' Export</button>',html:`
      <nav class="chips" aria-label="Invoice status">${[['all','All'],['pending','Pending'],['paid','Confirmed paid']].map(([key,label])=>`<button class="chip ${filter===key?'on':''}" data-act="invFilter" data-arg="${key}" aria-pressed="${filter===key}">${label} <span>${groups.filter(g=>key==='all'||(key==='paid'?paid(g):!paid(g))).length}</span></button>`).join('')}</nav>
      <section class="card invoice-tracker">${visible.length?`<div class="table-scroll"><table class="table payment-table"><thead><tr><th>Booking</th><th>Deposit</th><th>Final invoice</th><th><span class="sr-only">Open booking</span></th></tr></thead><tbody>${visible.map(g=>{const c=DB.get('clients',g.booking.clientId||g.invoices[0].clientId)||{};return `<tr><td><strong>${esc(W.clientName(c))}</strong><small>${g.booking.eventDate?fmtShort(g.booking.eventDate):'Date to confirm'}</small></td><td>${paymentCell(g,'deposit')}</td><td>${paymentCell(g,'final')}</td><td><a class="btn sm" href="#/booking/${esc(g.booking.id)}">Open booking</a></td></tr>`}).join('')}</tbody></table></div>`:empty('No '+(filter==='all'?'invoices':filter==='paid'?'confirmed payments':'pending payments')+' yet.')}</section>
      <p class="small muted">Review charges and payment links inside the booking.</p>`};
  }

  function viewInvoice(id) {
    const inv = DB.get('invoices', id);
    if (!inv) return { title: 'Invoice not found', back: '#/invoices', html: empty('Missing invoice.') };
    const b = DB.get('bookings', inv.bookingId) || {}; const c = DB.get('clients', inv.clientId) || {}; const p = W.profile();
    return {
      title: `Invoice ${inv.number}`, back: b.id ? `#/booking/${b.id}` : '#/invoices',
      actions: `<button class="btn sm" data-act="stripeInvoice" data-id="${inv.id}" data-arg="create">${inv.stripeInvoiceId ? "View payment link" : "Review for Stripe"}</button><button class="btn sm" data-act="stripeInvoice" data-id="${inv.id}" data-arg="refresh">Refresh payment status</button><button class="btn primary sm" data-act="print">${icon('printer')} Print / save PDF</button>`,
      html: `<article class="invoice">
        <header><div>${avatarHtml(p, 'inv-logo')}<h2>${esc(p.businessName)}</h2><p>${esc(p.artistName)}${p.abn ? '<br>ABN ' + esc(p.abn) : ''}${p.phone ? '<br>' + esc(p.phone) : ''}${p.email ? '<br>' + esc(p.email) : ''}</p></div>
          <div class="inv-meta"><h1>${p.gstRegistered ? 'Tax invoice' : 'Invoice'}</h1><p><b>${esc(inv.number)}</b><br>Issued ${fmtDate(inv.issuedAt)}<br>Due ${fmtDate(inv.dueAt)}</p><span class="badge inv-${inv.status}">${inv.status}</span></div></header>
        <section class="bill"><h3>Bill to</h3><p>${esc(W.clientName(c))}${c.email ? '<br>' + esc(c.email) : ''}${c.phone ? '<br>' + esc(c.phone) : ''}</p>
          ${b.eventDate ? `<h3>Booking</h3><p>${esc(b.eventType || '')} · ${fmtDate(b.eventDate)}${b.location ? '<br>' + esc(b.location) : ''}</p>` : ''}</section>
        <table class="table"><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr></thead>
          <tbody>${inv.items.map(i => `<tr><td>${esc(i.desc)}</td><td class="num">${i.qty}</td><td class="num">${money(i.price)}</td><td class="num">${money(i.qty * i.price)}</td></tr>`).join('')}</tbody>
          <tfoot>${inv.gst ? `<tr><td colspan="3" class="num">GST included</td><td class="num">${money(inv.gst)}</td></tr>` : ''}<tr class="grand"><td colspan="3" class="num">Total ${inv.status === 'paid' ? 'paid' : 'due'}</td><td class="num">${money(inv.total)}</td></tr></tfoot></table>
        <section class="pay"><h3>How to pay</h3>${inv.stripeUrl && /^https:\/\/invoice\.stripe\.com\//.test(inv.stripeUrl) ? `<p><a class="btn primary" href="${esc(inv.stripeUrl)}" target="_blank" rel="noopener">Pay invoice securely with Stripe ↗</a></p>` : ""}${inv.stripeStatus ? `<p class="small muted">Stripe: ${esc(inv.stripeStatus)}</p>` : ""}<p>${[p.bankAccountName && 'Account name: ' + esc(p.bankAccountName), p.bsb && 'BSB: ' + esc(p.bsb), p.accountNumber && 'Account: ' + esc(p.accountNumber), p.payId && 'PayID: ' + esc(p.payId)].filter(Boolean).join('<br>') || '<em>Add payment details in Profile → Business settings.</em>'}<br>Reference: ${esc(inv.number)}</p>
          ${p.cancellationPolicy ? `<p class="small muted">${esc(p.cancellationPolicy)}</p>` : ''}</section>
        <footer>Thank you for choosing ${esc(p.businessName)} ♡</footer>
      </article>`
    };
  }

  /* ================= REVIEWS ================= */
  function viewReviews() {
    const rs = DB.list('reviews').sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || ''));
    const avg = rs.length ? rs.reduce((s, r) => s + r.rating, 0) / rs.length : 0;
    const waiting = DB.list('bookings', b => b.stage === 'review' && b.status !== 'lost');
    return {
      title: 'Reviews',
      html: `<section class="stats three"><div class="stat"><span>Average rating</span><strong>${rs.length ? avg.toFixed(1) + ' ★' : '—'}</strong></div>
        <div class="stat"><span>Reviews</span><strong>${rs.length}</strong></div><div class="stat"><span>Waiting on a review</span><strong>${waiting.length}</strong></div></section>
        ${waiting.length ? `<section class="card"><div class="card-head"><h2>Waiting on</h2></div><div class="deal-stack">${waiting.map(bookingCard).join('')}</div></section>` : ''}
        <section class="card"><div class="card-head"><h2>All reviews</h2></div>
        ${rs.length ? rs.map(r => { const c = DB.get('clients', r.clientId) || {}; return `<div class="review"><div class="row between"><strong>${esc(W.clientName(c))}</strong><div class="stars">${stars(r.rating)}</div></div><p>${esc(r.text)}</p><small class="muted">${esc(r.source)} · ${fmtDate(r.receivedAt)}${r.consentToShare ? ' · OK to share on website' : ''}</small></div>`; }).join('') : empty('No reviews yet. They’ll show here once you record them on a booking.')}</section>`
    };
  }


  /* ================= EMPLOYEES (team + affiliates, fed by the website's Join the team / Become an affiliate forms) ================= */
  const PEOPLE_TABS = [['applications', 'Applications', x => x.status === 'applied'], ['team', 'Associates', x => x.kind === 'team' && x.status === 'active'],
    ['affiliates', 'Affiliates', x => x.kind === 'affiliate' && x.status === 'active'], ['past', 'Past & declined', x => x.status === 'declined' || x.status === 'inactive']];
  const personName = x => [x.firstName, x.lastName].filter(Boolean).join(' ') || x.businessName || 'Unnamed';
  const safeWeb = value => { try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch (_) { return ''; } };
  const handleOf = value => String(value || '').toLowerCase().replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/^@/, '').split(/[/?#]/)[0].trim();
  const CONNECTION_STATES = { prospect: 'Not contacted', contacted: 'Contacted', connected: 'Connected' };
  const PROFESSIONS=['Hair','Makeup','Nails','Lashes & brows','Spray tan','Skin care','Tattoo','Photography','Beauty','Other'];
  function profileProfessions(x){
    if(Array.isArray(x.professions)&&x.professions.length)return x.professions.filter(p=>PROFESSIONS.includes(p));
    const role=String(x.role||'').toLowerCase(),notes=String(x.notes||'').toLowerCase(),found=[];
    const add=p=>{if(!found.includes(p))found.push(p)};
    if(/hair/.test(role))add('Hair');if(/make.?up|\bmua\b/.test(role))add('Makeup');if(/nail/.test(role))add('Nails');if(/lash|brow/.test(role))add('Lashes & brows');if(/spray.?tan/.test(role))add('Spray tan');if(/tattoo/.test(role))add('Tattoo');if(/photo/.test(role))add('Photography');
    if(/hair\s*(?:&|and|\/)\s*make.?up|make.?up\s*(?:&|and|\/)\s*hair/.test(notes)){add('Hair');add('Makeup')}
    if(/make.?up artist|\bmua\b/.test(notes))add('Makeup');
    if(/hairstylist|hair stylist|hairdresser/.test(notes))add('Hair');if(/nail tech|nail artist/.test(notes))add('Nails');if(/lash|brow/.test(notes))add('Lashes & brows');if(/spray.?tan/.test(notes))add('Spray tan');if(/facials|skin therapist|skin treatments|skin clinic/.test(notes))add('Skin care');if(/cosmetic tattoo|tattoo artist/.test(notes))add('Tattoo');
    if(!found.length)add(/cosmetic|beauty/.test(role)?'Beauty':'Other');return found;
  }
  function viewEmployees(tab) {
    if (DB.missing.people) return { title: 'Connections', html: empty('Connections needs the people database table. See supabase/README.md.') };
    const t = PEOPLE_TABS.find(x => x[0] === tab) || PEOPLE_TABS[0];
    const all = DB.list('people'), list = all.filter(t[2]).sort((a, b) => personName(a).localeCompare(personName(b)));
    const candidates = (window.WEBSITE_CONNECTIONS || []).filter(a => !all.some(x => handleOf(x.instagram) === a.handle || x.websiteAffiliateHandle === a.handle));
    const row = x => {
      const status = CONNECTION_STATES[x.connectionStatus] || 'Not contacted', connected = x.connectionStatus === 'connected';
      const photo = safeWeb(x.photoUrl), site = safeWeb(x.website), scheduling = safeWeb(x.schedulingUrl);
      return `<article class="connection-card person-row" data-search="${esc([personName(x),x.role,x.email,x.phone,x.instagram,x.areas].join(' ').toLowerCase())}">
        <div class="connection-cover">${photo ? `<img src="${esc(photo)}" alt="${esc(personName(x))}" loading="lazy" referrerpolicy="no-referrer">` : `<div class="connection-placeholder">${esc(personName(x).slice(0,2).toUpperCase())}</div>`}
          <span class="connection-state ${connected ? 'connected' : ''}" title="Relationship status, manually confirmed"><span aria-hidden="true">${connected ? '●' : '○'}</span> ${esc(status)}</span></div>
        <div class="connection-body"><span class="badge">${x.kind === 'team' ? (connected?'Associate':'Prospective associate') : 'Affiliate'}</span><h2>${esc(personName(x))}</h2><div class="profession-tags">${profileProfessions(x).map(p=>`<span class="badge">${esc(p)}</span>`).join('')}</div><p class="muted">${esc(x.role || 'Add a role')}${x.areas ? ' · '+esc(x.areas) : ''}</p>
          ${safeWeb(x.schedulingUrl)?`<a class="btn sm" href="${esc(safeWeb(x.schedulingUrl))}" target="_blank" rel="noopener noreferrer">Book via ${esc(x.schedulingProvider||'booking page')} ↗</a>`:''}<div class="connection-contact">${x.email ? `<a href="mailto:${esc(x.email)}">${icon('mail')} ${esc(x.email)}</a>` : '<span class="muted">Email not provided</span>'}
          ${x.phone ? `<a href="tel:${esc(x.phone.replace(/[^+0-9]/g,''))}">${icon('phone')} ${esc(x.phone)}</a>` : '<span class="muted">Mobile not provided</span>'}</div>
          ${x.prospectBatch?`<p class="small muted">${esc(x.specialties||'')}</p><p class="small">${esc(x.activityEvidence||'Recent Instagram activity not verified')}</p><span class="badge">${x.showOnSite?'Published':'CRM only'}</span>`:''}<details><summary>Profile & availability</summary><dl class="kv">${[['Instagram',x.instagram?`<a href="https://www.instagram.com/${esc(handleOf(x.instagram))}/" target="_blank" rel="noopener noreferrer">@${esc(handleOf(x.instagram))}</a>`:'Not provided'],['Research source',safeWeb(x.researchSource)?`<a href="${esc(safeWeb(x.researchSource))}" target="_blank" rel="noopener noreferrer">View source</a>`:'Not recorded'],['Outreach recorded',x.contactedAt?esc(fmtDateTime(x.contactedAt)):'Not contacted'],['Website',site ? `<a href="${esc(site)}" target="_blank" rel="noopener noreferrer">Open website ↗</a>` : 'Not provided'],['Availability',esc(x.availability || 'Not provided').replace(/\n/g,'<br>')],['Time zone',esc(x.scheduleTimezone || 'Australia/Brisbane')],['Scheduling software',esc(x.schedulingProvider || 'Not set')],['Booking page',scheduling ? `<a href="${esc(scheduling)}" target="_blank" rel="noopener noreferrer">Open booking page ↗</a>` : 'Not provided'],['Booking link review',esc(x.bookingLinkStatus||'Not reviewed')],['Published booking links',(x.bookingLinks||[]).filter(l=>safeWeb(l.url)).map(l=>`<a href="${esc(safeWeb(l.url))}" target="_blank" rel="noopener noreferrer">${esc(l.label||l.provider||'Booking page')} ↗</a>${l.status==='Provider booking unavailable'?' — provider unavailable':''}`).join('<br>')||'No direct booking link verified'],['Published bio links',(x.publishedLinks||[]).filter(l=>safeWeb(l.url)).map(l=>`<a href="${esc(safeWeb(l.url))}" target="_blank" rel="noopener noreferrer">${esc(l.label||'Published link')} ↗</a>`).join('<br>')||'Not reviewed'],['Booking note',esc(x.bookingNote||'')],['Calendar sync','Not linked — availability is entered manually'],['Notes',esc(x.notes || '').replace(/\n/g,'<br>')],['Source',esc(x.source || '')]].map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></details>
          <div class="row gap">${x.instagram?`<a class="btn sm" href="https://www.instagram.com/${esc(handleOf(x.instagram))}/" target="_blank" rel="noopener noreferrer">View Instagram profile</a>`:''}<button class="btn primary sm" data-act="editPerson" data-id="${x.id}">Edit profile</button>
          ${x.status === 'applied' ? `<button class="btn sm" data-act="personStatus" data-id="${x.id}" data-arg="active">Approve</button><button class="btn ghost sm" data-act="personStatus" data-id="${x.id}" data-arg="declined">Decline</button>` : x.status === 'active' ? `<button class="btn ghost sm" data-act="personStatus" data-id="${x.id}" data-arg="inactive">Archive</button>` : `<button class="btn sm" data-act="personStatus" data-id="${x.id}" data-arg="active">Restore</button>`}
          ${x.kind === 'team' && x.status === 'active' ? `<button class="btn ghost sm" data-act="personShow" data-id="${x.id}" ${!x.showOnSite&&(x.connectionStatus!=='connected'||!x.contactedAt)?'disabled title="Record outreach and connection before publishing"':''}>${x.showOnSite ? 'Hide from website' : 'Publish to website'}</button>` : ''}
          <button class="btn ghost sm" data-act="deletePerson" data-id="${x.id}">Delete</button></div></div></article>`;
    };
    return { title: 'Connections', subtitle: `${all.filter(x=>x.kind==='team'&&x.status==='active').length} associates · ${all.filter(x=>x.kind==='affiliate'&&x.status==='active').length} affiliates · ${all.filter(x=>x.connectionStatus==='connected').length} connected`,
      actions: `<label class="search">${icon('search')}<input type="search" placeholder="Name, service or contact" data-filter=".person-row"></label><button class="btn primary sm" data-act="addPerson">${icon('plus')} Add a connection</button>`,
      html: `<section class="card soft"><div class="card-head"><h2>Your professional network</h2><div class="row gap"><button class="btn sm" data-act="refreshBookingLinks">Update Instagram booking links</button><button class="btn sm" data-act="importAffiliates" ${candidates.length ? '' : 'disabled'}>Import website affiliates (${candidates.length})</button></div></div><p class="muted">Photo profiles, contact details and manually entered availability. The status dot records your relationship; scheduling software is not connected yet. Import keeps existing profiles and does not send messages.</p><div class="row gap"><a href="https://lachlanbruce944-droid.github.io/chanel-monroe-makeup/apply.html?type=team" target="_blank" rel="noopener">Associate application ↗</a><a href="https://lachlanbruce944-droid.github.io/chanel-monroe-makeup/apply.html?type=affiliate" target="_blank" rel="noopener">Affiliate application ↗</a></div></section>
      <nav class="seg">${PEOPLE_TABS.map(([k,l,f])=>`<a href="#/employees/${k}" class="${k===t[0]?'active':''}">${l} <b>${all.filter(f).length}</b></a>`).join('')}</nav><nav class="profession-filters" aria-label="Filter connections by profession"><button class="btn sm" data-act="connectionProfession" data-arg="all" aria-pressed="${!state.connectionProfession||state.connectionProfession==='all'}">All professions</button>${PROFESSIONS.filter(p=>list.some(x=>profileProfessions(x).includes(p))).map(p=>`<button class="btn sm" data-act="connectionProfession" data-arg="${esc(p)}" aria-pressed="${state.connectionProfession===p}">${esc(p)} (${list.filter(x=>profileProfessions(x).includes(p)).length})</button>`).join('')}</nav>
      ${list.length ? PROFESSIONS.filter(p=>(!state.connectionProfession||state.connectionProfession==='all'||state.connectionProfession===p)&&list.some(x=>profileProfessions(x).includes(p))).map(p=>`<section class="profession-group"><h2>${esc(p)} <small class="muted">${list.filter(x=>profileProfessions(x).includes(p)).length}</small></h2><div class="connections-grid">${list.filter(x=>profileProfessions(x).includes(p)).map(row).join('')}</div></section>`).join('')||empty('No profiles for this profession in this view. Choose All professions.') : empty(t[0]==='applications'?'New website applications appear here.':'No profiles here yet. Add a connection or import website affiliates.')}` };
  }
  async function editConnection(id) {
    const x = id ? DB.get('people', id) : {kind:'team',status:'active',connectionStatus:'prospect'}; if(!x)return;
    const field = (name,label,type='text') => `<label>${label}<input type="${type}" name="${name}" value="${esc(x[name] || '')}"></label>`;
    await modal({title:id?'Edit connection':'Add a connection',submitLabel:id?'Confirm adjustments':'Add connection',wide:true,body:`<div class="form-grid">
      <label>Type<select name="kind"><option value="team" ${x.kind==='team'?'selected':''}>Associate</option><option value="affiliate" ${x.kind==='affiliate'?'selected':''}>Affiliate</option></select></label>
      <label>Relationship status<select name="connectionStatus">${Object.entries(CONNECTION_STATES).map(([k,v])=>`<option value="${k}" ${x.connectionStatus===k?'selected':''}>${v}</option>`).join('')}</select></label>
      <fieldset class="span-2"><legend>Professions — select all that apply</legend><div class="profession-options">${PROFESSIONS.map(p=>`<label class="check"><input type="checkbox" name="professions[]" value="${esc(p)}" ${profileProfessions(x).includes(p)?'checked':''}>${esc(p)}</label>`).join('')}</div></fieldset>${field('firstName','First name')}${field('lastName','Last name')}${field('businessName','Business / profile name')}${field('role','Role / service')}${field('email','Email','email')}${field('phone','Mobile','tel')}${field('instagram','Instagram handle')}${field('website','Website','url')}${field('photoUrl','Profile image URL','url')}${field('areas','Service areas')}
      <label class="span-2">Availability / weekly schedule<textarea name="availability" rows="4" placeholder="Mon 9–5, Tue unavailable; dates or exceptions…">${esc(x.availability||'')}</textarea></label>
      ${field('scheduleTimezone','Time zone (e.g. Australia/Brisbane)')}${field('schedulingProvider','Scheduling software (e.g. Fresha, Timely)')}${field('schedulingUrl','Public booking page URL','url')}
      <label class="span-2">Notes<textarea name="notes" rows="4">${esc(x.notes||'')}</textarea></label></div><p class="small muted">A booking page link does not grant calendar access. Never paste passwords or API keys here.</p>`,
      async onSubmit(f){ if(!f.firstName&&!f.businessName)throw Error('Enter a first name or business name.');
        for(const k of ['website','photoUrl','schedulingUrl'])if(f[k]&&!safeWeb(f[k]))throw Error('Use a full http or https URL for '+k);
        if(f.scheduleTimezone){try{new Intl.DateTimeFormat('en',{timeZone:f.scheduleTimezone})}catch(_){throw Error('Enter a valid time zone, such as Australia/Brisbane.')}}
        const saved={...x,...f,professions:(f.professions||[]).filter(p=>PROFESSIONS.includes(p)),showOnSite:f.kind==='team'&&f.connectionStatus==='connected' ? !!x.showOnSite : false,source:x.source||'Added manually',application:x.application||{}};
        if(['contacted','connected'].includes(f.connectionStatus)&&!x.contactedAt)saved.contactedAt=new Date().toISOString();
        if(f.connectionStatus==='connected'&&x.connectionStatus!=='connected')saved.connectedAt=new Date().toISOString();
        await DB.save('people',saved);toast('Profile saved');setTimeout(()=>go('#/employees/'+(saved.status==='applied'?'applications':saved.kind==='team'?'team':'affiliates')));
      }});
  }
  function viewSoon(title, ic, text) {
    return { title, html: `<section class="card soon-card"><div class="soon-ic">${icon(ic)}</div><h2>${esc(title)} is coming soon</h2><p class="muted">${esc(text)}</p></section>` };
  }

  /* ================= PROFILE & SETTINGS ================= */
  function viewProfile() {
    const p = W.profile(); const u = Auth.current;
    const inp = (name, label, type = 'text', extra = '') => `<label>${label}<input type="${type}" name="${name}" value="${esc(p[name] ?? '')}" ${extra}></label>`;
    const users = Auth.team.map(account => account.id === u.id ? { ...account, name:u.name, email:u.email } : account);
    return {
      title: 'Profile & settings',
      html: `<div class="detail">
        <div class="detail-main">
          <section class="card profile-hero">
            <label class="avatar-up">${avatarHtml(p, 'big-avatar')}<input type="file" accept="image/*" hidden data-change="avatar"><span>Change photo</span></label>
            <div><h2>${esc(p.artistName)}</h2><p class="muted">${esc(p.tagline || '')}</p><p class="small">${esc(p.instagram || '')}${p.serviceArea ? ' · ' + esc(p.serviceArea) : ''}</p></div>
          </section>
          <section class="card"><div class="card-head"><h2>Business profile</h2></div>
            <form data-form="profile" class="form-grid">
              ${inp('artistName', 'Artist name')}${inp('businessName', 'Business name')}
              ${inp('tagline', 'Tagline')}${inp('serviceArea', 'Service area', 'text', 'placeholder="e.g. Gold Coast & Brisbane"')}
              ${inp('email', 'Business email', 'email')}${inp('phone', 'Business phone', 'tel')}
              ${inp('instagram', 'Instagram')}${inp('website', 'Website', 'url')}
              ${inp('bookingLink', 'Booking / enquiry link', 'url')}${inp('abn', 'ABN')}
              <label class="span-2">Bio<textarea name="bio" rows="3">${esc(p.bio)}</textarea></label>
              <div class="span-2 row end"><button class="btn sm">Save profile</button></div>
            </form></section>
          <section class="card"><div class="card-head"><h2>Payments, policies & reminders</h2></div>
            <form data-form="profile" class="form-grid">
              ${inp('depositPercent', 'Deposit %', 'number', 'min="0" max="100"')}${inp('depositDueDays', 'Deposit due within (days)', 'number', 'min="0"')}
              ${inp('paymentTermsDays', 'Final invoice due within (days)', 'number', 'min="0"')}
              <label class="check"><input type="checkbox" name="gstRegistered" ${p.gstRegistered ? 'checked' : ''}> Registered for GST (prices include GST)</label>
              ${inp('bankAccountName', 'Account name')}${inp('bsb', 'BSB')}${inp('accountNumber', 'Account number')}${inp('payId', 'PayID')}
              ${inp('reviewLink', 'Review link (Google etc.)', 'url')}${inp('reminderOffsets', 'Reminder days before event', 'text', 'placeholder="14,7,2,1"')}
              <label class="span-2">Deposit & cancellation policy<textarea name="cancellationPolicy" rows="3">${esc(p.cancellationPolicy)}</textarea></label>
              <div class="span-2 row end"><button class="btn sm">Save settings</button></div>
            </form></section>

        </div>
        <div class="detail-side">
          <section class="card"><div class="card-head"><h2>Your account</h2></div>
            ${u.pendingEmail ? `<p class="callout" role="status">Sign-in email change pending for <strong>${esc(u.pendingEmail)}</strong>. Check both inboxes and follow any confirmation links you receive.</p>` : ''}
            <form data-form="me" class="stack"><label>Name<input name="name" value="${esc(u.name)}" required></label><label>Email (sign-in)<input type="email" name="email" value="${esc(u.email)}" required></label><button class="btn sm">Save</button></form>
            <form data-form="password" class="stack"><h3>Change password</h3><label>Current password<input type="password" name="old" required></label><label>New password<input type="password" name="next" minlength="8" required></label><button class="btn sm">Update password</button></form>
          </section>
          <section class="card"><div class="card-head"><h2>Team accounts</h2></div>
            <ul class="list">${users.map(x => `<li class="list-row"><div class="avatar">${esc(x.name[0] || '?')}</div><div class="grow"><strong>${esc(x.name)}</strong><small>${esc(x.email)} · ${esc(x.role)}</small></div></li>`).join('')}</ul>
            ${u.role === 'owner' ? `<button class="btn sm" data-act="addUser">${icon('plus')} Add an assistant</button>` : ''}
          </section>
          <section class="card"><div class="card-head"><h2>Your data</h2></div>
            <p class="small muted">Everything is saved securely in Supabase and syncs across every device you sign in on. Website enquiries arrive here automatically. Photos are stored privately.</p>
            <div class="stack">
              <button class="btn sm" data-act="exportData">Export backup (.json)</button>
              <label class="btn sm ghost">Import backup<input type="file" accept="application/json,.json" hidden data-change="importData"></label>
              ${u.role === 'owner' ? '<button class="btn sm danger-ghost" data-act="wipeData">Delete all client data</button>' : ''}
            </div></section>
          <button class="btn ghost block" data-act="logout">${icon('logout')} Sign out</button>
        </div></div>`
    };
  }

  function viewServices() {
    const all=W.services(),groups=all.reduce((a,s)=>{(a[s.category||'Other'] ||= []).push(s);return a},{});
    const field=(service,key,type='text',extra='')=>`<input type="${type}" value="${esc(service[key]??'')}" data-change="svc" data-id="${esc(service.id)}" data-field="${key}" aria-label="${esc(service.name)} · ${key==='durationMins'?'minutes':key}" ${extra}>`;
    return {title:'Services',subtitle:'Rates and appointment time',actions:'<button class="btn sm" data-act="focusServiceAdd">'+icon('plus')+' Add service</button>',html:`
      <section class="card service-buffer"><div class="card-head"><h2>${icon('calendar')} Booking buffer</h2></div>
      <form data-form="timingSettings" class="row gap"><label>Minutes between appointments<input type="number" name="bufferMins" min="0" max="240" step="5" value="${esc(DB.setting('appointmentBufferMins',60))}"></label><button class="btn sm" type="submit">Save buffer</button></form></section>
      <div class="service-directory">${Object.entries(groups).sort(([a],[b])=>{const order=['Bridal & events','Natural beauty','Editorial & creative','Parties & seasonal','Add-on','Other'];return (order.includes(a)?order.indexOf(a):99)-(order.includes(b)?order.indexOf(b):99)||a.localeCompare(b)}).map(([category,items])=>`<section class="card service-category">
        <div class="card-head"><h2>${esc(category)}</h2><span class="badge">${items.length}</span></div>
        <div class="table-scroll"><table class="lines svc service-table"><thead><tr><th>Service</th><th class="num">Rate · AUD</th><th class="num">Minutes</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
        ${items.map(service=>`<tr><td><div class="service-name">${field(service,'name')}</div><div class="service-group-fields"><label>Category${field(service,'category')}</label><label>Subcategory${field(service,'subcategory')}</label></div>${service.subcategory&&service.subcategory.toLowerCase()!==service.name.toLowerCase()?`<small class="service-subcategory">${esc(service.subcategory)}</small>`:''}</td>
        <td class="num">${field(service,'price','number','min="0" step="0.01"')}</td>
        <td class="num">${field(service,'durationMins','number','min="0" step="5"')}</td>
        <td><input type="checkbox" ${service.active!==false?'checked':''} data-change="svc" data-id="${esc(service.id)}" data-field="active" aria-label="${esc(service.name)} active"></td>
        <td><button class="icon-btn" data-act="deleteService" data-id="${esc(service.id)}" aria-label="Delete ${esc(service.name)}" title="Delete service">${icon('x')}</button></td></tr>`).join('')}
        </tbody></table></div></section>`).join('')}</div>
      <section class="card" id="service-add"><div class="card-head"><h2>${icon('plus')} Add service</h2></div><form data-form="addService" class="form-grid">
        <label>Name<input name="name" required></label><label>Category<input name="category" list="service-categories" placeholder="Other"><datalist id="service-categories">${Object.keys(groups).map(c=>`<option value="${esc(c)}">`).join('')}</datalist></label>
        <label>Rate · AUD<input name="price" type="number" min="0" step="0.01" required></label><label>Minutes<input name="durationMins" type="number" min="0" step="5" value="60"></label>
        <div class="span-2 row end"><button type="submit" class="btn primary">${icon('plus')} Add service</button></div></form></section>`};
  }

  /* ================= ENQUIRY FORMS ================= */
  function enquiryFields({ internal = false, client = null, date = '' } = {}) {
    const svc = W.services(true);
    const cats = [...new Set(svc.map(s => s.category || 'Other'))];
    const v = k => esc(client?.[k] || '');
    return `
      <fieldset><legend>About you</legend><div class="form-grid">
        <label>First name *<input name="firstName" required value="${v('firstName')}" autocomplete="given-name"></label>
        <label>Last name<input name="lastName" value="${v('lastName')}" autocomplete="family-name"></label>
        <label>Email ${internal ? '' : '*'}<input type="email" name="email" ${internal ? '' : 'required'} value="${v('email')}" autocomplete="email"></label>
        <label>Mobile ${internal ? '' : '*'}<input type="tel" name="phone" ${internal ? '' : 'required'} value="${v('phone')}" autocomplete="tel"></label>
        <label class="span-2">Instagram (optional)<input name="instagram" value="${v('instagram')}" placeholder="@yourhandle"></label>
      </div></fieldset>
      <fieldset><legend>Your event</legend><div class="form-grid">
        <label>What’s the occasion? *<select name="eventType" required><option value="">Choose…</option>${W.EVENT_TYPES.map(e => `<option>${esc(e)}</option>`).join('')}</select></label>
        <label>Date *<input type="date" name="eventDate" required min="${internal ? '' : today()}" value="${esc(date)}"></label>
        <label>What time do you need to be ready?<input type="time" name="readyBy"></label>
        <label>How many people need makeup?<input type="number" name="partySize" min="1" value="1"></label>
        <label class="span-2">Where are you getting ready?<input name="location" placeholder="Venue, hotel or suburb"></label>
      </div></fieldset>
      <fieldset><legend>Services you’re interested in</legend>
        ${cats.map(cat => `<div class="svc-group"><h4>${esc(cat)}</h4><div class="svc-pick">${svc.filter(s => (s.category || 'Other') === cat).map(s => `<label class="pick"><input type="checkbox" name="services[]" value="${s.id}"><span>${esc(s.name)}<small>from ${money(s.price)}</small></span></label>`).join('')}</div></div>`).join('')}
        <label>Would you like a trial?<select name="trial"><option value="">—</option><option>Yes</option><option>No</option><option>Not sure</option></select></label>
      </fieldset>
      <fieldset><legend>Your skin & look</legend><div class="form-grid">
        <label>Skin type<select name="skinType"><option value="">—</option>${['Normal', 'Dry', 'Oily', 'Combination', 'Sensitive', 'Mature', 'Not sure'].map(o => `<option>${o}</option>`).join('')}</select></label>
        <label>Allergies or sensitivities<input name="allergies" placeholder="e.g. lash glue, fragrance"></label>
        <label class="span-2">Describe the look you’re after<textarea name="look" rows="3" placeholder="Soft glam, natural, bold lip… links to Pinterest/Instagram welcome"></textarea></label>
        ${internal || Auth.isStaff() ? '<label class="span-2">Inspiration photos (optional)<input type="file" name="photos" accept="image/*" multiple></label>' : ''}
      </div></fieldset>
      <fieldset><legend>Last few questions</legend><div class="form-grid">
        <label>How did you find ${esc(W.profile().artistName.split(' ')[0])}?<select name="heardFrom"><option value="">—</option>${['Instagram', 'TikTok', 'Google', 'Friend / referral', 'Wedding vendor', 'Facebook', 'Other'].map(o => `<option>${o}</option>`).join('')}</select></label>
        <label>Preferred phone consultation · Brisbane time<input type="datetime-local" name="consultAt" required></label><p class="small muted span-2">Pending Chanel’s approval. Normally at least three days before makeup; confirmation will be emailed once approved.</p>
        ${internal ? '' : '<label class="span-2">Anything else?<textarea name="notes" rows="2"></textarea></label>'}
        ${internal ? '' : '<label class="span-2 check"><input type="checkbox" name="consent" required> I’m happy to be contacted about my enquiry</label>'}
      </div></fieldset>`;
  }

  function viewNewEnquiry(arg) {
    const client = arg ? DB.get('clients', arg) : null;
    const date = new URLSearchParams(location.hash.split('?')[1] || '').get('date') || '';
    return {
      title: client ? `New booking · ${W.clientName(client)}` : 'New enquiry', back: client ? `#/client/${client.id}` : '#/pipeline',
      subtitle: 'Fill in what you know — everything can be edited later.',
      html: `<form data-form="enquiry" data-mode="internal" class="card enquiry-form">${enquiryFields({ internal: true, client, date })}
        <div class="row end gap"><a class="btn ghost" href="#/pipeline">Cancel</a><button class="btn primary">Create enquiry</button></div></form>`
    };
  }

  function renderPublicEnquiry() {
    const p = W.profile();
    $app().innerHTML = `<div class="public">
      <header class="public-hero">${avatarHtml(p, 'big-avatar')}<h1>${esc(p.businessName)}</h1><p>${esc(p.tagline || '')}${p.serviceArea ? ' · ' + esc(p.serviceArea) : ''}</p></header>
      <main id="public-main"><form data-form="enquiry" data-mode="public" class="card enquiry-form">
        <h2>Booking enquiry</h2><p class="muted">Tell me a little about your day and I’ll be in touch within 24 hours to arrange a quick call.</p>
        ${enquiryFields()}
        <button class="btn primary block">Send enquiry</button>
      </form></main>
      <footer class="public-foot">${esc(p.instagram || '')}${Auth.current ? ' · <a href="#/">Back to dashboard</a>' : ''}</footer></div>`;
  }

  /* ================= AUTH SCREENS ================= */
  function authFrame(inner) {
    const p = W.profile();
    $app().innerHTML = `<div class="auth"><div class="auth-card">${avatarHtml(p, 'big-avatar')}<h1>${esc(p.businessName)}</h1>${inner}</div></div>`;
  }
  function renderSignup() {
    authFrame(`<p class="muted">Create your account. The first account becomes the studio owner; anyone after that needs the owner to let them in.</p>
      <form data-form="signup" class="stack">
        <label>Your name<input name="name" required autocomplete="name"></label>
        <label>Email<input type="email" name="email" required autocomplete="email"></label>
        <label>Password<input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
        <label>Confirm password<input type="password" name="confirm" required minlength="8" autocomplete="new-password"></label>
        <button class="btn primary block">Create account</button>
      </form>
      <p class="small">Already have an account? <a href="#/">Sign in</a></p>`);
  }
  function renderLogin() {
    authFrame(`<p class="muted">Sign in to your client studio</p>
      <form data-form="login" class="stack">
        <label>Email<input type="email" name="email" required autocomplete="email"></label>
        <label>Password<input type="password" name="password" required autocomplete="current-password"></label>
        <button class="btn primary block">Sign in</button>
      </form>
      <p class="small"><button class="link" data-act="forgot">Forgot password?</button> · <a href="#/signup">Create an account</a></p>`);
  }
  function renderPending() {
    authFrame(`<p>You’re signed in as <strong>${esc(Auth.current.email)}</strong>, but this account hasn’t been given access yet.</p>
      <p class="small muted">Ask the studio owner to add this email under Profile → Team accounts, then refresh this page.</p>
      <div class="stack"><button class="btn primary" data-act="recheck">I’ve been added — check again</button><button class="btn ghost" data-act="logout">Sign out</button></div>`);
  }
  function renderNewPassword() {
    authFrame(`<p class="muted">Choose a new password</p>
      <form data-form="newPassword" class="stack">
        <label>New password<input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
        <button class="btn primary block">Save password</button>
      </form>`);
  }

  /* ================= PHOTOS ================= */
  async function loadPhotos() {
    for (const img of document.querySelectorAll('img[data-photo]')) {
      const id = img.dataset.photo;
      if (!blobCache.has(id)) blobCache.set(id, await DB.getBlob(id));
      if (blobCache.get(id)) img.src = blobCache.get(id);
    }
  }

  /* ================= MESSAGE COMPOSER ================= */
  async function openComposer(bookingId, key, reminderId) {
    const b = DB.get('bookings', bookingId); const c = W.clientOf(b);
    const msg = W.renderTemplate(key, b);
    let channel = 'copied';
    await modal({
      title: W.TEMPLATES[key].label, wide: true, submitLabel: 'Mark as sent',
      body: `<p class="muted small">To: ${esc(W.clientName(c))} · ${esc(c.email || 'no email')} · ${esc(c.phone || 'no mobile')}</p>
        <label>Subject<input name="subject" value="${esc(msg.subject)}"></label>
        <label>Message<textarea name="body" rows="14">${esc(msg.body)}</textarea></label>
        <div class="row gap wrap"><button type="button" class="btn sm" data-cmp="copy">Copy</button>
          <button type="button" class="btn sm" data-cmp="email" ${c.email ? '' : 'disabled'}>${icon('mail')} Open in email</button>
          <button type="button" class="btn sm" data-cmp="sms" ${c.phone ? '' : 'disabled'}>${icon('message')} Open as text</button></div>
        <p class="small muted">Opens your email or messages app with this filled in. Click “Mark as sent” once it’s gone so it’s logged.</p>`,
      onOpen(form) {
        form.addEventListener('click', async e => {
          const btn = e.target.closest('[data-cmp]'); if (!btn) return;
          const subject = form.subject.value, body = form.body.value;
          if (btn.dataset.cmp === 'copy') { await copyText(body); channel = 'copy & paste'; toast('Copied'); }
          if (btn.dataset.cmp === 'email') { channel = 'email'; window.location.href = `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`; }
          if (btn.dataset.cmp === 'sms') { channel = 'text'; window.location.href = `sms:${encodeURIComponent((c.phone || '').replace(/\s/g, ''))}?&body=${encodeURIComponent(body)}`; }
        });
      },
      async onSubmit(d) {
        await W.logMessage(b, key, d.subject, channel);
        if (reminderId) await W.completeReminder(reminderId);
        toast('Logged as sent');
      }
    });
    rerender();
  }

  async function tryAdvance(id) {
    let r = await W.advance(id);
    if (!r.ok && r.canOverride) {
      const ok = await confirmBox(`Before moving on: ${r.reasons.join('; ')}. Continue anyway?`, 'Continue anyway');
      if (!ok) return null;
      r = await W.advance(id, { override: true });
    }
    if (!r.ok) { toast(r.reasons.join(' · '), 'error'); return null; }
    toast(`Moved to ${r.stage.label}`);
    return r;
  }

  /* ================= ACTIONS (buttons) ================= */
  const Actions = {
    async focusServiceAdd(){document.getElementById('service-add')?.scrollIntoView({behavior:'smooth',block:'start'});},
    async removeCalendarBlock(d){const b=DB.get('bookings',d.id);if(!await confirmBox('Remove this job’s exported Apple Calendar events? CRM appointment times stay reserved.','Remove events'))return;await Connectors.removeBlock(b);toast('Apple Calendar events removed');rerender();},
    async toggleDeveloperMode() {
      const enabled = W.developerModeEnabled();
      if (!enabled && !await confirmBox('Enable early pipeline testing in this tab? Changes still affect live records and normal actions can still send emails.', 'Enable developer mode')) return;
      W.setDeveloperMode(!enabled);
      rerender();
    },
    async logout() { if (W.developerModeEnabled()) W.setDeveloperMode(false); await Auth.logout(); location.hash = '#/'; render(); },
    async recheck() { await Auth.loadStaff(); if (Auth.isStaff()) await afterSignIn(); else toast('Still waiting for access', 'error'); },
    async forgot() {
      const email = document.querySelector('form[data-form=login] [name=email]')?.value;
      await Auth.sendReset(email);
      toast('Check your email for a reset link');
    },
    reloadForm() { renderPublicEnquiry(); window.scrollTo(0, 0); },
    pipelineFilter(d) { state.pipelineFilter=d.arg;rerender(); },
    toggleLost() { state.showLost = !state.showLost; rerender(); },
    tpl(d) { return openComposer(d.id, d.arg); },
    async allTemplates(d) {
      const key = await modal({ title: 'Message templates', hideSubmit: true, cancelLabel: 'Close',
        body: `<div class="tpl-list">${Object.entries(W.TEMPLATES).map(([k, v]) => `<button type="button" class="tpl" data-key="${k}">${icon('message')}${esc(v.label)} <small class="muted">· ${esc(W.stage(v.stage).short)}</small></button>`).join('')}</div>`,
        onOpen(form, close) { form.addEventListener('click', e => { const b = e.target.closest('[data-key]'); if (b) close(b.dataset.key); }); } });
      if (key) openComposer(d.id, key);
    },
    async stripeInvoice(d) {
      const invoice=DB.get('invoices',d.id);if(!invoice)throw Error('Invoice not found');
      const booking=DB.get('bookings',invoice.bookingId);if(!booking)throw Error('Booking not found');
      if(d.arg==='create'&&!invoice.stripeInvoiceId){
        const c=W.clientOf(booking),totals=W.totals(booking);
        const payments=DB.list('payments',p=>p.bookingId===booking.id);
        const paid=payments.filter(p=>invoice.type==='deposit'?p.type==='deposit':p.type!=='deposit').reduce((n,p)=>n+Math.round(Number(p.amount)*100),0);
        const due=(Math.round(Number(invoice.total)*100)-paid)/100;
        const expected=invoice.type==='deposit'?totals.deposit:Math.max(0,totals.total-totals.depositPaid);
        if(Math.abs(Number(invoice.total)-expected)>0.005)throw Error('Invoice differs from the current booking. Review and update it before sending to Stripe.');
        if(!c.email)throw Error('Add the client email before creating the payment link');
        if(!(due>=0.50))throw Error('There is no payable balance of at least $0.50');
        const confirmed=await modal({title:invoice.type==='deposit'?'Review deposit':'Review final invoice',submitLabel:'Confirm & create Stripe link',wide:true,
          body:`<div class="review-banner">${icon('file')} Check the details before creating the payment link.</div>
          <dl class="kv"><dt>Client</dt><dd>${esc(W.clientName(c))}</dd><dt>Email</dt><dd>${esc(c.email)}</dd><dt>Appointment</dt><dd>${booking.eventDate?fmtDate(booking.eventDate):'Not set'}${booking.readyBy?' · Ready by '+fmtTime(booking.readyBy):''}</dd><dt>Location</dt><dd>${esc(booking.clientAddress||booking.location||'Not set')}</dd></dl>
          <table class="table"><thead><tr><th>Charge</th><th class="num">Amount · AUD</th></tr></thead><tbody>${(invoice.items||[]).map(item=>`<tr><td>${esc(item.desc)}${item.qty>1?' × '+esc(item.qty):''}</td><td class="num amount">${money(item.qty*item.price)}</td></tr>`).join('')}</tbody></table>
          <dl class="review-totals"><dt>Booking total</dt><dd>${money(totals.total)}</dd><dt>Deposit received</dt><dd>${money(totals.depositPaid)}</dd><dt>Additional costs</dt><dd>${money(totals.additionalCosts)}</dd><dt>${invoice.type==='deposit'?'Deposit due now':'Final amount due'}</dt><dd class="amount due-now">${money(due)}</dd></dl>
          <p class="small muted">This creates and finalises a Stripe invoice. It does not email the client or charge a card. Review the client message separately before sending.</p>`,onSubmit:()=>true});
        if(!confirmed)return;
      }
      const { data, error } = await DB.client.functions.invoke('crm-stripe', { body: { action: d.arg, invoiceId: d.id } });
      if (error || !data?.ok) throw Error(data?.error || error?.message || 'Stripe invoice connection unavailable');
      await DB.refresh(); rerender();
      if (data.url && /^https:\/\/invoice\.stripe\.com\//.test(data.url)) await modal({title:'Stripe invoice payment link',hideSubmit:true,cancelLabel:'Done',body:`<p>Share this link with the client to collect their invoice payment.</p><label>Payment link<input readonly value="${esc(data.url)}"></label><a class="btn primary" href="${esc(data.url)}" target="_blank" rel="noopener">Open Stripe invoice ↗</a><p class="small muted">Payment is recorded after Stripe verification. Creating this link does not email the client or charge their card.</p>`});
      else toast('Stripe payment status refreshed');
    },
    async reviewEnquiry(d) {
      const b = DB.get('bookings', d.id);
      await modal({ title: 'Review enquiry', submitLabel: 'Save review',
        body: `<label>Review notes<textarea name="notes" rows="6" required>${esc(b.enquiryReviewNotes || '')}</textarea></label><p class="muted small">Reviewing this enquiry does not approve the consultation or confirm the makeup booking.</p>`,
        async onSubmit(f) { await W.reviewEnquiry(b, f.notes); toast('Review saved'); } });
      rerender();
    },
    async approveConsultation(d) {
      const b = DB.get('bookings', d.id);
      if (!b.callAt) return toast('Schedule the phone consultation first');
      if (!await confirmBox(`Approve the client’s requested call for ${fmtDateTime(b.callAt)} Brisbane time? This sends the phone consultation booking email. No client confirmation is required. The makeup booking still requires a quote and deposit.`, 'Approve & email')) return;
      await W.approveConsultation(b);
      toast('Phone consultation approved'); rerender();
    },
    async calendarConsultation() {
      const enquiries = DB.list('bookings', b => b.status !== 'lost' && ['enquiry','call'].includes(b.stage) && !b.callLoggedAt);
      if(!enquiries.length) return toast('Create an enquiry first, then schedule its phone consultation');
      const picked = await modal({ title:'Select enquiry for phone consultation', submitLabel:'Choose time',
        body:`<label>Enquiry<select name="bookingId" required>${enquiries.map(b => `<option value="${esc(b.id)}">${esc(W.clientName(W.clientOf(b)))} · ${esc(b.eventType || 'Enquiry')} · ${esc(b.eventDate || 'No date')}</option>`).join('')}</select></label>`,
        onSubmit:f => f.bookingId });
      if(picked) await Actions.scheduleCall({id:picked,day:state.calSelected});
    },
    async scheduleCall(d) {
      const b = DB.get('bookings', d.id); const def = b.callAt || (d.day ? new Date(d.day + 'T09:00:00+10:00').toISOString() : W.daysFromNow(1, '09:00'));
      await modal({ title: 'Schedule phone call', submitLabel: 'Save pending consultation & email',
        body: `<label>Date & time · Brisbane<input type="datetime-local" name="at" required value="${Connectors.brisbaneInput(def)}"></label>
          ${b.answers?.callPref ? `<p class="small muted">Client said: “${esc(b.answers.callPref)}”</p>` : ''}
          <p class="muted small">Free 15-minute call. Pending until Chanel approves. Normally at least three days before makeup. The client does not confirm.</p><label>Short-notice exception reason (if under three days)<input name="note" placeholder="Chanel’s reason for approving short notice"></label>`,
        async onSubmit(f) { await W.scheduleCall(b, new Date(f.at + ':00+10:00').toISOString(), f.note); toast('Consultation pending Chanel’s approval'); } });
      rerender();
    },
    async logCall(d) {
      const b = DB.get('bookings', d.id);
      const readyBy = b.readyBy || b.startTime || '';
      await modal({ title: b.stage === 'updates' ? 'Add an update' : 'Complete phone consultation', submitLabel: b.stage === 'updates' ? 'Confirm adjustments' : 'Confirm adjustments & prepare quote', wide: true,
        body: `<label>Notes (optional)<textarea name="notes" rows="6" placeholder="Look, timings, number of people, trial, budget, parking…"></textarea></label>
          <p class="small muted">Update anything that changed:</p>
          <div class="form-grid"><label>Event date<input type="date" name="eventDate" value="${esc(b.eventDate)}"></label>
          <label>Ready by<input type="time" name="readyBy" value="${esc(readyBy)}"></label>
          <label>Location<input name="location" value="${esc(b.location)}"></label>
          <label class="span-2">Client address (entered by Chanel)<input name="clientAddress" autocomplete="street-address" value="${esc(b.clientAddress || '')}" placeholder="Street address, suburb, state, postcode"></label>
          <label>People<input type="number" min="1" name="partySize" value="${esc(b.partySize || 1)}"></label></div>`,
        async onSubmit(f) {
          if (!b.readyBy && f.readyBy === readyBy) delete f.readyBy;
          await W.logCall(b, f.notes, f);
          toast(b.stage === 'call' ? 'Call completed — ready to prepare the quote' : 'Details saved');
        } });
      rerender();
      if (DB.get('bookings', d.id).stage === 'updates') document.getElementById('quote')?.scrollIntoView({ behavior: 'smooth' });
    },
    async quoteStripe(d) {
      let b=DB.get('bookings',d.id);
      if(b.stage==='updates'){if(!await tryAdvance(d.id))return;b=DB.get('bookings',d.id);}
      const type=W.idx(b.stage)>=W.idx('invoice')?'final':'deposit';
      const invoice=DB.find('invoices',i=>i.bookingId===b.id&&i.type===type);
      if(!invoice)throw Error('Complete and approve the phone consultation before preparing the quote');
      rerender();
      await Actions.stripeInvoice({id:invoice.id,arg:'create'});
    },
    async sendQuote(d) {
      const r = await tryAdvance(d.id);
      rerender();
      if (r) openComposer(d.id, 'quote');
    },
    async advance(d) {
      const b = DB.get('bookings', d.id);
      const from = b.stage;
      const r = await tryAdvance(d.id); rerender();
      if (r && from === 'day') openComposer(d.id, 'final_invoice');
      if (r && from === 'updates') openComposer(d.id, 'quote');
    },
    async back(d) { await W.moveBack(d.id); toast('Moved back a step'); rerender(); },
    async payment(d) {
      const b = DB.get('bookings', d.id); const t = W.totals(b);
      const type = d.arg || 'final';
      const amount = type === 'deposit' ? Math.max(0, t.deposit - t.depositPaid) : t.balance;
      await modal({ title: 'Record payment', submitLabel: 'Save payment',
        body: `<div class="form-grid"><label>Type<select name="type">${['deposit', 'final', 'other'].map(x => `<option ${x === type ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
          <label>Amount<input type="number" step="0.01" min="0" name="amount" value="${amount || ''}" required></label>
          <label>Method<select name="method">${W.PAY_METHODS.map(m => `<option>${m}</option>`).join('')}</select></label>
          <label>Date received<input type="date" name="paidAt" value="${today()}"></label>
          <label class="span-2">Reference (optional)<input name="reference"></label></div>`,
        async onSubmit(f) {
          const r = await W.recordPayment(b, f);
          toast(r.advancedTo ? `Payment saved — moved to ${r.advancedTo.label}` : 'Payment saved');
          if (r.advancedTo?.key === 'booked') setTimeout(() => openComposer(b.id, 'deposit_received'), 50);
          if (r.advancedTo?.key === 'review') setTimeout(() => openComposer(b.id, 'review_request'), 50);
        } });
      rerender();
    },
    async deletePayment(d) { if (await confirmBox('Remove this payment?', 'Remove', true)) { await W.deletePayment(d.id); rerender(); } },
    async addReview(d) {
      const b = DB.get('bookings', d.id);
      await modal({ title: 'Record review', submitLabel: 'Save review',
        body: `<div class="rating">${[5, 4, 3, 2, 1].map(n => `<input type="radio" name="rating" id="r${n}" value="${n}" ${n === 5 ? 'checked' : ''}><label for="r${n}">★</label>`).join('')}</div>
          <label>Review text<textarea name="text" rows="4" placeholder="Record what they said or paste their written review"></textarea></label>
          <label>Where<select name="source">${['Verbal', 'Written', 'Google', 'Instagram', 'Facebook', 'Direct message', 'Website'].map(s => `<option>${s}</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" name="consent"> Client gave permission to share on the website</label>`,
        async onSubmit(f) { const r = await W.addReview(b, f); toast(r.advancedTo ? 'Review saved — booking complete!' : 'Review saved'); } });
      rerender();
    },
    photo() { document.querySelector('[data-change="photos"]')?.click(); },
    async viewReference(d) {
      if (d.src) await showEnquiryImage(d.title, d.src, d.credit);
    },
    async viewEnquirySelfie(d) {
      const {data, error} = await DB.client.from('enquiries').select('selfie_path').eq('id',d.id).maybeSingle();
      if (error) throw Error('Unable to access this enquiry selfie');
      if (!data?.selfie_path) { toast('No selfie was attached to this enquiry'); return; }
      const signed = await DB.client.storage.from('selfies').createSignedUrl(data.selfie_path,600);
      if (signed.error) throw Error('Unable to open this enquiry selfie');
      await showEnquiryImage('Enquiry selfie',signed.data.signedUrl);
    },
    async viewPhoto(d) {
      const p = DB.get('photos', d.id); const src = await DB.getBlob(d.id);
      const res = await modal({ title: `${p.kind[0].toUpperCase() + p.kind.slice(1)} photo`, wide: true, submitLabel: 'Delete photo', danger: true, cancelLabel: 'Close',
        body: `${p.mediaType === 'video' ? `<video class="photo-full" src="${esc(src)}" controls playsinline></video>` : `<img class="photo-full" src="${esc(src)}" alt="">`}<p class="small muted">${esc(p.caption || '')} ${fmtDate(p.createdAt)}</p><a class="btn sm" download="${esc(p.fileName || 'media')}" href="${src}">Download</a>`,
        onSubmit: () => 'delete' });
      if (res === 'delete' && await confirmBox('Delete this photo?', 'Delete', true)) { await W.deletePhoto(d.id); blobCache.delete(d.id); rerender(); }
    },
    async remDone(d) { await W.completeReminder(d.id); toast('Done'); rerender(); },
    async remSkip(d) { await W.completeReminder(d.id, 'skipped'); rerender(); },
    remSend(d) { const r = DB.get('reminders', d.id); return openComposer(r.bookingId, r.templateKey, r.id); },
    async addReminder(d) {
      const b = DB.get('bookings', d.id);
      await modal({ title: 'Add reminder', submitLabel: 'Add reminder',
        body: `<label>What<input name="title" required placeholder="e.g. Order extra lashes"></label>
          <label>When<input type="datetime-local" name="dueAt" required value="${toLocalInput(W.daysFromNow(1, '09:00'))}"></label>
          <label>Message template (optional)<select name="templateKey"><option value="">None</option>${Object.entries(W.TEMPLATES).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select></label>`,
        async onSubmit(f) { await W.addReminder(b, { title: f.title, dueAt: new Date(f.dueAt).toISOString(), templateKey: f.templateKey }); toast('Reminder added'); } });
      rerender();
    },
    async removeLine(d) {
      const b = DB.get('bookings', d.id); const lines = [...(b.lines || [])]; lines.splice(+d.i, 1);
      await W.saveBooking(b, { lines }, 'Quote updated'); rerender();
    },
    async bookingMenu(d) {
      const b = DB.get('bookings', d.id);
      const choice = await modal({ title: 'Booking options', hideSubmit: true, cancelLabel: 'Close',
        body: `<div class="stack">${b.archivedAt ? '<button type="button" class="btn" data-pick="restore">Restore booking</button>' : b.status === 'lost' ? '<button type="button" class="btn" data-pick="reopen">Reopen booking</button>' : '<button type="button" class="btn" data-pick="lost">Mark as lost</button>'}
          <button type="button" class="btn" data-pick="client">Open client profile</button>
          ${b.archivedAt ? '' : '<button type="button" class="btn" data-pick="archive">Archive booking</button>'}</div>`,
        onOpen(form, close) { form.addEventListener('click', e => { const p = e.target.closest('[data-pick]'); if (p) close(p.dataset.pick); }); } });
      if (choice === 'reopen') return Actions.reopen(d);
      if (choice === 'restore' && await confirmBox('Restore this booking to its previous status?', 'Restore booking')) { await W.restoreBooking(b); toast('Booking restored'); rerender(); }
      if (choice === 'client') return go(`#/client/${b.clientId}`);
      if (choice === 'lost') {
        await modal({ title: 'Mark as lost', submitLabel: 'Mark lost', danger: true,
          body: `<label>Reason<select name="reason">${['Date unavailable', 'Went with someone else', 'Over budget', 'Event cancelled', 'No response', 'Other'].map(r => `<option>${r}</option>`).join('')}</select></label>`,
          async onSubmit(f) { await W.markLost(b, f.reason); } });
        rerender();
      }
      if (choice === 'archive' && await confirmBox('Archive this booking and keep its history in the database?', 'Archive booking')) {
        await W.archiveBooking(b); state.pipelineFilter = 'archived'; toast('Booking archived'); go('#/pipeline');
      }
    },
    async reopen(d) { const b = DB.get('bookings', d.id); if (b.archivedAt) { await W.restoreBooking(b); toast('Booking restored'); } else { await W.reopen(b); toast('Reopened'); } rerender(); },
    async personStatus(d) {
      const x = DB.get('people', d.id); if (!x) return;
      await DB.save('people', { ...x, status: d.arg, showOnSite: d.arg === 'active' ? x.showOnSite : false });
      toast(d.arg === 'active' ? `${personName(x)} added` : d.arg === 'declined' ? 'Application declined' : 'Moved to past'); rerender();
    },
    async personShow(d) {
      const x=DB.get('people',d.id);if(!x)return;
      if(!x.showOnSite&&(x.connectionStatus!=='connected'||!x.contactedAt))throw Error('Record outreach and a confirmed connection before publishing.');
      if(!x.showOnSite&&!await confirmBox('Publish this connected associate’s profile on the live website? Confirm Chanel has contacted them and they agree to be listed.','Publish to website'))return;
      const {data,error}=await DB.client.rpc('crm_publish_associate',{p_person:x.id,p_publish:!x.showOnSite});
      if(error||data?.error)throw Error(error?.message||data.error);
      await DB.refresh();toast(x.showOnSite?'Hidden from the website':'Published to the website. Refresh the website to see it.');rerender();
    },
    async deletePerson(d) { const x = DB.get('people', d.id); if (x && await confirmBox(`Delete ${personName(x)}?`, 'Delete', true)) { await DB.remove('people', d.id); toast('Deleted'); rerender(); } },
    connectionProfession(d){state.connectionProfession=d.arg;rerender();},
    async addPerson() { await editConnection(); },
    async editPerson(d) { await editConnection(d.id); },
    async refreshBookingLinks(d,el){
      const audit=window.AFFILIATE_BOOKING_LINKS||[];if(!audit.length)throw Error('Booking-link review data is not loaded. Refresh the page.');
      if(!await confirmBox('Update existing connection profiles with the Instagram link review? Manual booking URLs and relationship statuses are preserved. No bookings or messages will be created.','Update links'))return;
      el.disabled=true;let updated=0;
      try{for(const review of audit){for(const x of DB.list('people').filter(x=>handleOf(x.instagram)===review.handle||x.websiteAffiliateHandle===review.handle)){
        if(x.bookingLinkAuditVersion==='2026-11-17-v1')continue;
        const primary=review.bookingLinks.find(l=>l.status==='Published booking link'&&safeWeb(l.url));
        const next={...x,bookingLinks:review.bookingLinks,publishedLinks:review.publishedLinks,bookingNote:review.bookingNote,bookingLinkStatus:review.status,bookingLinksCheckedAt:review.checkedAt,bookingLinkSource:review.source,bookingLinkAuditVersion:'2026-11-17-v1'};
        if(!x.schedulingUrl&&primary&&!review.bookingNote){next.schedulingUrl=primary.url;next.schedulingProvider=x.schedulingProvider||primary.provider}
        await DB.save('people',next);updated++;
      }}toast(updated+' profiles updated');rerender();}finally{el.disabled=false}
    },
    async importAffiliates(d,el) {
      if(!await confirmBox('Import public website affiliates as editable profiles? Existing Instagram profiles are skipped. Missing contacts stay blank. No messages will be sent.','Import profiles'))return;
      el.disabled=true;let n=0;
      try { for(const a of (window.WEBSITE_CONNECTIONS||[])){
        if(DB.list('people').some(x=>handleOf(x.instagram)===a.handle||x.websiteAffiliateHandle===a.handle))continue;
        await DB.save('people',{id:a.id,kind:'affiliate',status:'active',businessName:a.businessName,role:a.role,email:a.email,phone:a.phone,instagram:a.handle,website:a.website,photoUrl:a.photoUrl,notes:a.notes,source:'Website affiliate directory (17 Nov 2026)',websiteAffiliateHandle:a.handle,connectionStatus:'prospect',showOnSite:false,application:{}});n++;
      } toast(n+' profiles imported');go('#/employees/affiliates'); }
      catch(e){toast(n+' imported before the error. Retry safely to import the rest.','error');throw e}
      finally{el.disabled=false;}
    },
    async removeClientPhoto(d){const c=DB.get('clients',d.id);if(!c)return;await DB.save('clients',{...c,portraitPhotoId:'',portraitHidden:true});if(c.portraitPhotoId)await DB.removeBlob(c.portraitPhotoId).catch(()=>{});toast('Profile photo removed');rerender();},
    async addClient() {
      await modal({ title: 'New client', submitLabel: 'Add client',
        body: `<div class="form-grid"><label>First name<input name="firstName" required></label><label>Last name<input name="lastName"></label>
          <label>Email<input type="email" name="email"></label><label>Mobile<input type="tel" name="phone"></label>
          <label class="span-2">Instagram<input name="instagram"></label><label class="span-2">Selfie / profile photo (optional)<input type="file" name="portraitFiles" accept="image/*"></label></div>`,
        async onSubmit(f) { const {portraitFiles,...fields}=f;const c={...fields,id:DB.uid(),source:'Added manually'};if(portraitFiles?.[0])await saveClientPortrait(c,portraitFiles[0]);else await DB.save('clients',c);setTimeout(() => go(`#/client/${c.id}`)); } });
    },
    async deleteClient(d) {
      const c = DB.get('clients', d.id);
      if (await confirmBox(`Delete ${W.clientName(c)} and all their bookings, invoices and photos?`, 'Delete client', true)) { await W.deleteClient(c); toast('Client deleted'); go('#/clients'); }
    },
    calNav(d) {
      if (d.arg === '0') { state.calMonth = today().slice(0, 7); state.calSelected = today(); }
      else { const [y, m] = state.calMonth.split('-').map(Number); const n = new Date(y, m - 1 + (+d.arg), 1); state.calMonth = `${n.getFullYear()}-${pad(n.getMonth() + 1)}`; }
      rerender();
    },
    calDay(d) { state.calSelected = d.day; rerender(); },
    newOnDate(d) { location.hash = `#/new?date=${d.day}`; },
    invFilter(d) { state.invoiceFilter = d.arg; rerender(); },
    print() { window.print(); },
    exportCsv() {
      const rows = [['Invoice', 'Client', 'Type', 'Issued', 'Due', 'Status', 'Total']];
      DB.list('invoices').forEach(i => rows.push([i.number, W.clientName(DB.get('clients', i.clientId) || {}), i.type, i.issuedAt, i.dueAt, i.status, i.total.toFixed(2)]));
      download(`invoices-${today()}.csv`, rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
    },
    async deleteService(d) { if (await confirmBox('Delete this service? Existing quotes keep their lines.', 'Delete', true)) { await DB.remove('services', d.id); rerender(); } },
    async addUser() {
      await modal({ title: 'Add an assistant', submitLabel: 'Give access',
        body: `<p class="small muted">First ask them to open this site and choose “Create an account”. Then enter the same email here to let them in.</p>
          <label>Name<input name="name" required></label><label>Their account email<input type="email" name="email" required></label>`,
        async onSubmit(f) { await Auth.addStaff(f.email, f.name); toast('Access granted'); } });
      rerender();
    },
    async exportData() {
      const data = await DB.exportAll();
      download(`chanel-monroe-crm-backup-${today()}.json`, JSON.stringify(data));
      toast('Backup downloaded');
    },
    async wipeData() {
      if (!await confirmBox('Delete every client, booking, invoice and photo? Your account, profile and services are kept.', 'Delete everything', true)) return;
      for (const s of ['clients', 'bookings', 'payments', 'invoices', 'reminders', 'photos', 'reviews', 'activity'])
        for (const r of DB.list(s)) await DB.remove(s, r.id);
      blobCache.clear(); toast('All client data deleted'); go('#/');
    }
  };

  /* ================= FORMS ================= */
  const Forms = {
    async signup(f) {
      const res = await Auth.signup(f);
      if (res === 'confirm-email') {
        authFrame(`<h2>Check your email</h2><p>We’ve sent a confirmation link to <strong>${esc(f.email)}</strong>. Click it, then come back here and sign in.</p><a class="btn primary block" href="#/">Back to sign in</a>`);
        return;
      }
      if (Auth.isStaff()) { await afterSignIn(); if (Auth.current.role === 'owner' && !DB.setting('profileTouched')) { await W.saveProfile({ artistName: f.name }); await DB.setSetting('profileTouched', true); } toast('Welcome! Your studio is ready'); }
      location.hash = '#/'; render();
    },
    async login(f) {
      await Auth.login(f.email, f.password);
      if (Auth.isStaff()) await afterSignIn();
      location.hash = '#/'; render();
    },
    async newPassword(f) { await Auth.setNewPassword(f.password); toast('Password updated'); await Auth.loadStaff(); if (Auth.isStaff()) await afterSignIn(); location.hash = '#/'; render(); },
    async enquiry(f, form) {
      const files = [...(f.photos || [])];
      const internal = form.dataset.mode === 'internal';
      let b = null;
      if (internal || Auth.isStaff()) {
        b = await W.createEnquiry(f, { source: internal ? 'Added manually' : 'Enquiry form', photos: files });
        if (internal) { toast('Enquiry created'); go(`#/booking/${b.id}`); return; }
      } else {
        await submitPublicEnquiry(f);       // goes to the website enquiries table → database trigger creates the CRM booking
      }
      const p = W.profile();
      document.getElementById('public-main').innerHTML = `<div class="card thanks"><h2>Thank you, ${esc(f.firstName)}! ♡</h2>
        <p>Your enquiry for ${fmtDate(f.eventDate)} has been received. ${esc(p.artistName.split(' ')[0])} will be in touch within 24 hours to arrange a quick call.</p>
        <p class="muted">In the meantime, come say hi on Instagram ${esc(p.instagram || '')}.</p>
        ${b ? `<a class="btn primary" href="#/booking/${b.id}">View in CRM</a>` : '<a class="btn" href="#/enquire" data-act="reloadForm">Send another enquiry</a>'}</div>`;
      window.scrollTo(0, 0);
    },
    async timingSettings(f){ const n=Number(f.bufferMins); if(!Number.isInteger(n)||n<0||n>240)throw Error('Buffer must be 0–240 minutes'); await DB.setSetting('appointmentBufferMins',n); toast('Appointment buffer saved'); rerender(); },
    async calendarBlock(f,form){await Connectors.saveBlock(DB.get('bookings',form.dataset.id),f.calendarStart,f.calendarEnd);toast('CRM calendar time block saved');rerender();},
    async serviceNotes(f, form) {
      const b = DB.get('bookings', form.dataset.id);
      await W.saveBooking(b, {serviceNotes:f.serviceNotes, additionalCosts:+f.additionalCosts, additionalCostsReason:f.additionalCostsReason}, 'Service notes and agreed additional costs updated');
      toast('Saved'); rerender();
    },
    async details(f, form) {
      const b = DB.get('bookings', form.dataset.id);
      await W.saveBooking(b, { eventType: f.eventType, eventDate: f.eventDate, readyBy: f.readyBy, startTime: f.startTime, location: f.location,
        partySize: +f.partySize || 1, answers: { ...(b.answers || {}), trial: f.trial, look: f.look } }, 'Event details updated');
      toast('Details saved'); rerender();
    },
    async addQuoteExtra(f, form) {
      const b = DB.get('bookings', form.dataset.id);
      if (!b.callLoggedAt) throw Error('Complete the phone consultation before adding extras');
      const line = window.QuoteExtras.line(form.dataset.phase, f.extra, f.qty, f.price);
      await W.saveBooking(b, { lines: [...(b.lines || []), line] }, `Added ${line.name} to quote`);
      rerender();
    },
    async addLine(f, form) {
      const b = DB.get('bookings', form.dataset.id); const s = DB.get('services', f.serviceId); if (!s) return;
      await W.saveBooking(b, { lines: [...(b.lines || []), { serviceId: s.id, name: s.name, qty: +f.qty || 1, price: s.price }] }, `Added ${s.name} to quote`);
      rerender();
    },
    async note(f, form) { const b = DB.get('bookings', form.dataset.id); if (!b.callLoggedAt) throw Error('Add notes after the phone consultation'); await W.log(b, 'note', f.text); rerender(); },
    async client(f, form) {
      const c = DB.get('clients', form.dataset.id);
      await DB.save('clients', { ...c, ...f }); toast('Client saved'); rerender();
    },
    async profile(f) {
      if ('depositPercent' in f) { f.depositPercent = +f.depositPercent || 0; f.paymentTermsDays = +f.paymentTermsDays || 0; f.depositDueDays = +f.depositDueDays || 0; }
      await W.saveProfile(f); toast('Saved'); rerender();
    },
    async addService(f, form) {
      await DB.save('services', { name: f.name, price: +f.price || 0, category: f.category?.trim() || 'Other', durationMins: +f.durationMins || 0, active: true, sort: DB.list('services').length });
      form.reset(); rerender();
    },
    async me(f) { const r = await Auth.updateMe(f); toast(r === 'confirm-email' ? 'Email change pending. Check both inboxes for confirmation links.' : 'Account updated'); rerender(); },
    async password(f, form) { await Auth.changePassword(f.old, f.next); form.reset(); toast('Password updated'); }
  };

  /* ================= CHANGE HANDLERS (inline edits, uploads) ================= */
  const Changes = {
    async line(el) {
      const b = DB.get('bookings', el.dataset.id); const lines = (b.lines || []).map(l => ({ ...l }));
      const l = lines[+el.dataset.i]; if (!l) return;
      l[el.dataset.field] = el.dataset.field === 'name' ? el.value : (+el.value || 0);
      await W.saveBooking(b, { lines }, 'Quote updated'); rerender();
    },
    async money(el) {
      const b = DB.get('bookings', el.dataset.id);
      await W.saveBooking(b, { [el.dataset.field]: el.value === '' ? '' : +el.value }, 'Quote updated'); rerender();
    },
    async photos(el) {
      const b = DB.get('bookings', el.dataset.id);
      const kind = document.querySelector('input[name=photoKind]:checked')?.value || 'day';
      const files = [...el.files]; if (!files.length) return;
      toast(`Uploading ${files.length} photo${files.length > 1 ? 's' : ''}…`);
      for (const f of files) await W.addPhoto(b, f, kind);
      await W.log(b, 'photo', `${files.length} ${kind} photo${files.length > 1 ? 's' : ''} added`);
      rerender();
    },
    async clientPhoto(el){const c=DB.get('clients',el.dataset.id);if(!c||!el.files?.[0])return;await saveClientPortrait(c,el.files[0]);toast('Client photo saved');rerender();},
    async avatar(el) {
      const f = el.files[0]; if (!f) return;
      await W.saveProfile({ avatar: await UI.resizeImage(f, 400, 0.85) }); rerender();
    },
    async svc(el) {
      const s = DB.get('services', el.dataset.id); const k = el.dataset.field;
      const v = el.type === 'checkbox' ? el.checked : (k === 'price' || k === 'durationMins') ? (+el.value || 0) : el.value;
      await DB.save('services', { ...s, [k]: v }); toast('Saved');
    },
    async importData(el) {
      const f = el.files[0]; if (!f) return;
      if (!await confirmBox('Importing adds or overwrites records from the backup file. Continue?', 'Import backup', true)) return;
      await DB.importAll(JSON.parse(await f.text())); blobCache.clear();
      toast('Backup imported'); go('#/');
    }
  };

  /* ================= GLOBAL LISTENERS ================= */
  function initialiseEditCards() {
    const formNames = ['timingSettings', 'details', 'calendarBlock', 'serviceNotes', 'client', 'profile', 'me', 'password', 'note'];
    for (const form of $app().querySelectorAll(formNames.map(name => `form[data-form="${name}"]`).join(','))) {
      const controls = [...form.querySelectorAll('input:not([type=hidden]),select,textarea,button[type=submit],button:not([type])')];
      const card = form.closest('.card');
      lockEditCard(form, controls, () => form.reset(), card?.querySelectorAll('form').length === 1 ? card : form);
    }
    for (const section of new Set([...$app().querySelectorAll('[data-change="line"],[data-change="money"],[data-change="svc"]')].map(el => el.closest('.card')).filter(Boolean))) {
      const controls = [...section.querySelectorAll('[data-change="line"],[data-change="money"],[data-change="svc"],[data-act="removeLine"],[data-act="deleteService"],form[data-form="addService"],form[data-form="addLine"],form[data-form="addQuoteExtra"]')];
      lockEditCard(section, controls, () => controls.forEach(restoreInlineEdit));
    }
  }

  function lockEditCard(container, controls, reset, footerHost = container) {
    const snapshot = controls.map(control => {
      control.classList.add('edit-card-control');
      const value = document.createElement('span');
      value.className = 'edit-card-value';
      control.before(value);
      return {control, value, disabled:control.disabled, hidden:control.hidden};
    });
    const footer = document.createElement('div');
    footer.className = 'edit-card-footer';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn sm';
    footer.append(button);
    footerHost.append(footer);
    let editing = false;
    const sectionLabel=(footerHost.closest('.card')?.querySelector('h2')?.textContent||'details').trim();
    container.classList.add('editable-section');
    function refresh() {
      container.classList.toggle('is-editing',editing);
      for (const {control, value, disabled, hidden} of snapshot) {
        control.hidden = !editing || hidden;
        if (disabled !== undefined) control.disabled = !editing || disabled;
        value.hidden = editing || hidden || !control.matches('input:not([type=password]):not([type=file]),select,textarea');
        if (!value.hidden) {
          const monetary=['price','travelFee','discount','depositAmount','additionalCosts'].includes(control.dataset.field||control.dataset.change||control.name);
          value.classList.toggle('amount',monetary);
          const display = control.type === 'checkbox' ? (control.dataset.field==='active'?(control.checked?'Active':'Inactive'):(control.checked?'Yes':'No')) :
            monetary&&control.value!=='' ? money(control.value) :
            control.tagName === 'SELECT' ? control.selectedOptions[0]?.textContent :
            control.type === 'time' && control.value ? fmtTime(control.value) :
            control.type === 'date' && control.value ? fmtShort(control.value) : control.value;
          value.textContent = display || '—';
        }
      }
      button.innerHTML=icon(editing?'check':'edit')+(editing?(container.tagName==='FORM'?'Cancel':'Done editing'):(container.dataset.editLabel||'Edit'));
      button.setAttribute('aria-label',(editing?'Finish editing ':'Edit ')+sectionLabel);
      button.setAttribute('aria-expanded',String(editing));
    }
    button.onclick = () => {
      if (editing) reset();
      editing = !editing;
      refresh();
      // Opening Edit reveals controls without automatically launching the mobile keyboard.
      // The user taps the particular field they want to change.
    };
    refresh();
  }

  const adjustmentForms = new Set(['details', 'calendarBlock', 'serviceNotes', 'addQuoteExtra', 'addLine',
    'note', 'client', 'profile', 'addService', 'me', 'password']);
  const adjustmentActions = new Set(['removeLine', 'personStatus', 'personShow', 'removeClientPhoto']);
  const confirmAdjustments = () => confirmBox('Save these changes to the CRM?', 'Confirm adjustments');

  function restoreInlineEdit(el) {
    if (el.type === 'file') el.value = '';
    else if (el.type === 'checkbox') el.checked = el.defaultChecked;
    else if ('defaultValue' in el) el.value = el.defaultValue;
  }
  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.closest('.modal-wrap')) return;
    const fn = Actions[el.dataset.act]; if (!fn) return;
    e.preventDefault();
    try {
      if (adjustmentActions.has(el.dataset.act) && !await confirmAdjustments()) return;
      await fn(el.dataset, el);
    } catch (err) { console.error(err); toast(err.message || String(err), 'error'); }
  });
  document.addEventListener('submit', async e => {
    const f = e.target.closest('form[data-form]'); if (!f) return;
    e.preventDefault();
    const btn = f.querySelector('button:not([type=button])'); if (btn) btn.disabled = true;
    try {
      const fields = UI.formToObj(f);
      if (adjustmentForms.has(f.dataset.form) && !await confirmAdjustments()) return;
      await Forms[f.dataset.form](fields, f);
    } catch (err) { console.error(err); toast(err.message || String(err), 'error'); }
    finally { if (btn && btn.isConnected) btn.disabled = false; }
  });
  document.addEventListener('change', async e => {
    const el = e.target; if (el.closest('.modal-wrap') || !el.dataset.change) return;
    try {
      if (el.dataset.change !== 'importData' && !await confirmAdjustments()) {
        restoreInlineEdit(el);
        return;
      }
      await Changes[el.dataset.change](el);
      if (el.type === 'checkbox') el.defaultChecked = el.checked;
      else if (el.type !== 'file') el.defaultValue = el.value;
      else el.value = '';
    } catch (err) {
      restoreInlineEdit(el);
      console.error(err);
      toast(err.message || String(err), 'error');
    }
  });
  document.addEventListener('input', e => {
    const el = e.target; if (!el.dataset.filter) return;
    const q = el.value.toLowerCase().trim();
    document.querySelectorAll(el.dataset.filter).forEach(n => { n.hidden = q && !(n.dataset.search || '').includes(q); });
  });
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

  /* ================= BOOT ================= */
  async function afterSignIn() {
    await DB.init();
    await W.ensureDefaults();
  }

  /** Public (signed-out) enquiry: saved to the same table the website uses, so it flows into the CRM the same way. */
  async function submitPublicEnquiry(f) {
    const svc = W.services(true).filter(s => (f.services || []).includes(s.id));
    const notes = [f.look && `Look: ${f.look}`, f.notes, f.callPref && `Best time to call: ${f.callPref}`, f.heardFrom && `Found via: ${f.heardFrom}`, f.instagram && `Instagram: ${f.instagram}`].filter(Boolean).join('\n');
    const { error } = await DB.client.from('enquiries').insert({
      name: [f.firstName, f.lastName].filter(Boolean).join(' '), email: f.email, phone: f.phone,
      category: 'crm-form', category_name: f.eventType, look_name: svc.map(s => s.name).join(', ') || null,
      event_date: f.eventDate || null, time: f.readyBy || null, time_type: 'ready_by', location: f.location,
      quantity: String(f.partySize || 1), bridal_trial: f.trial || null, skin_type: f.skinType || null, allergies: f.allergies || null,
      consult_requested_at: f.consultAt ? new Date(f.consultAt + ':00+10:00').toISOString() : null,
      notes, extra_services: svc.map(s => s.name), estimate_total: svc.reduce((t, s) => t + +s.price, 0) || null, estimate_is_from: true,
      consent: !!f.consent, status: 'new', source: 'crm-form'
    });
    if (error) throw new Error('Sorry, your enquiry couldn’t be sent. Please try again or message us on Instagram.');
  }

  // pick up new website enquiries and changes made on other devices
  async function backgroundRefresh() {
    if (!Auth.isStaff() || document.hidden || document.querySelector('.modal-wrap') || document.activeElement?.matches('input,textarea,select')) return;
    try {
      if (await DB.refresh()) { blobCache.clear(); if (parts()[0] !== 'enquire') rerender(); }
    } catch (err) { console.warn('Refresh failed', err); }
  }

  (async function boot() {
    try {
      await Auth.init(() => render());
      if (Auth.isStaff()) await afterSignIn();
      render();
      setInterval(backgroundRefresh, 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) backgroundRefresh(); });
    } catch (err) {
      console.error(err);
      $app().innerHTML = `<div class="auth"><div class="auth-card"><h1>Couldn’t connect</h1><p>${esc(err.message)}</p><p class="small muted">Check your internet connection and refresh the page.</p><button class="btn" onclick="location.reload()">Try again</button></div></div>`;
    }
  })();
})();
