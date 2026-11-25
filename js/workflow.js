/* ==========================================================================
   Chanel Monroe CRM — workflow engine
   --------------------------------------------------------------------------
   One "booking" is one job, from first enquiry to review. It moves through
   STAGES in order. Each move is checked by a guard (checkNext) and running
   into a stage triggers side-effects (onEnter): invoices are raised,
   reminders are scheduled, follow-ups are skipped when no longer needed.

   Enquiry → Phone call → Updates & quote → Deposit → Booked (reminders)
           → The day (photos) → Final invoice → Review → Complete
   Any open booking can be marked Lost and later reopened.

   All business rules live here (no DOM code), so this file ports straight
   to a Supabase edge function or Swift.
   ========================================================================== */
(function () {
  const { ymd, today, parseYmd, addDays, fmtDate, fmtTime, fmtDateTime, money } = UI;

  const STAGES = [
    { key: 'enquiry',  label: 'Consultation approval',            short: 'Enquiry', hint: 'Check the client details and requested time. Approve the phone consultation and send confirmation; no notes are required before the call.' },
    { key: 'call',     label: 'Phone consult & notes',         short: 'Call',    hint: 'Complete the approved phone consultation and save the details before generating a quote.' },
    { key: 'updates',  label: 'Initial quote',    short: 'Quote',   hint: 'Lock in the details and services, then send the quote and deposit request.' },
    { key: 'deposit',  label: 'Deposit',            short: 'Deposit', hint: 'Deposit invoice is out. Waiting on payment to secure the date.' },
    { key: 'booked',   label: 'Booked · reminders', short: 'Booked',  hint: 'Date is secured. Reminders are scheduled in the lead-up.' },
    { key: 'day',      label: 'Day of service',   short: 'Day',     hint: 'Save before/after photos and videos, additional notes, agreed extra costs and verbal or written feedback.' },
    { key: 'invoice',  label: 'Final invoice',      short: 'Invoice', hint: 'Send the final invoice for the balance owing.' },
    { key: 'review',   label: 'Follow-up & review',  short: 'Follow-up', hint: 'Send a thank-you email with the Stripe receipt or final payment link. Record feedback or request a review.' },
    { key: 'complete', label: 'Complete',           short: 'Done',    hint: 'All wrapped up. Lovely work.' }
  ];
  const idx = key => STAGES.findIndex(s => s.key === key);
  const stage = key => STAGES[idx(key)] || STAGES[0];

  const EVENT_TYPES = ['Wedding (bride)', 'Wedding party', 'Formal', 'Event / party', 'Photoshoot', 'Makeup lesson', 'Other'];
  const PAY_METHODS = ['Bank transfer', 'PayID', 'Card', 'Cash', 'Stripe / online', 'Other'];

  const DEFAULT_PROFILE = {
    businessName: 'Chanel Monroe Makeup', artistName: 'Chanel Monroe', tagline: 'Bridal & event makeup artist',
    email: 'makeup@chanelmonroe.net', phone: '', abn: '', instagram: '@chanelmonroemakeup', website: 'https://lachlanbruce944-droid.github.io/chanel-monroe-makeup/',
    bookingLink: 'https://lachlanbruce944-droid.github.io/chanel-monroe-makeup/enquire.html', serviceArea: 'Gold Coast (travel included within 20 km)', bio: '', avatar: '',
    depositPercent: 30, gstRegistered: false, paymentTermsDays: 7, depositDueDays: 3,
    bankAccountName: '', bsb: '', accountNumber: '', payId: '',
    cancellationPolicy: 'Your deposit secures your date and is non-refundable. Date changes are subject to availability.',
    reviewLink: '', reminderOffsets: '14,7,2,1', callLengthMins: 15
  };

  /* Services = the website's price list (website repo: src/settings/pricing-settings.js, 16 Nov 2026), plus CRM-only add-ons.
     Seeded on first sign-in only; after that, edit services in Profile & settings. */
  const DEFAULT_SERVICES = [
    { name: "Bridal look", category: "Bridal & events", price: 375, durationMins: 90, websiteKey: "bridal-look", unit: "per bride" },
    { name: "Bridal party and family", category: "Bridal & events", price: 170, durationMins: 60, websiteKey: "bridal-party", unit: "per person" },
    { name: "Formal and graduation", category: "Bridal & events", price: 195, durationMins: 60, websiteKey: "formal", unit: "per person" },
    { name: "Gala, awards and race day", category: "Bridal & events", price: 220, durationMins: 60, websiteKey: "gala", unit: "per person" },
    { name: "Milestone celebration", category: "Bridal & events", price: 195, durationMins: 60, websiteKey: "milestone", unit: "per person" },
    { name: "Wedding trial", category: "Bridal & events", price: 250, durationMins: 90, websiteKey: "trial", unit: "per trial" },
    { name: "Photoshoot look", category: "Editorial & creative", price: 240, durationMins: 75, websiteKey: "shoot-look", unit: "per look" },
    { name: "Beauty close-up", category: "Editorial & creative", price: 275, durationMins: 75, websiteKey: "close-up", unit: "per look" },
    { name: "High fashion and statement", category: "Editorial & creative", price: 300, durationMins: 75, websiteKey: "statement", unit: "per look" },
    { name: "SFX and prosthetics", category: "Editorial & creative", price: 520, durationMins: 150, websiteKey: "sfx", unit: "per character", from: true },
    { name: "Body paint", category: "Editorial & creative", price: 600, durationMins: 150, websiteKey: "body-paint", unit: "per person", from: true },
    { name: "Half day on set", category: "Editorial & creative", price: 720, durationMins: 240, websiteKey: "half-day", unit: "per booking" },
    { name: "Full day on set", category: "Editorial & creative", price: 1350, durationMins: 480, websiteKey: "full-day", unit: "per booking" },
    { name: "Halloween", category: "Parties & seasonal", price: 150, durationMins: 60, websiteKey: "halloween", unit: "per person" },
    { name: "Easter", category: "Parties & seasonal", price: 110, durationMins: 60, websiteKey: "easter", unit: "per person" },
    { name: "Christmas and New Year", category: "Parties & seasonal", price: 145, durationMins: 60, websiteKey: "christmas", unit: "per person" },
    { name: "Birthdays and celebrations", category: "Parties & seasonal", price: 145, durationMins: 60, websiteKey: "birthday", unit: "per person" },
    { name: "Festivals and day parties", category: "Parties & seasonal", price: 100, durationMins: 60, websiteKey: "festival", unit: "per person" },
    { name: "Hens and themed nights", category: "Parties & seasonal", price: 150, durationMins: 60, websiteKey: "hens", unit: "per person" },
    { name: "Full character", category: "Parties & seasonal", price: 280, durationMins: 150, websiteKey: "character", unit: "per person" },
    { name: "Mini face paint (10 people or more)", category: "Parties & seasonal", price: 20, durationMins: 10, websiteKey: "mini-paint", unit: "per person" },
    { name: "Everyday natural", category: "Natural beauty", price: 145, durationMins: 60, websiteKey: "natural", unit: "per person" },
    { name: "Headshots and work", category: "Natural beauty", price: 165, durationMins: 60, websiteKey: "headshot", unit: "per person" },
    { name: "Outdoor and family portraits", category: "Natural beauty", price: 140, durationMins: 60, websiteKey: "portrait", unit: "per person" },
    { name: "Sensitive skin", category: "Natural beauty", price: 190, durationMins: 60, websiteKey: "sensitive", unit: "per person" },
    { name: "Makeup lesson", category: "Natural beauty", price: 280, durationMins: 120, websiteKey: "lesson", unit: "per person" },
    { name: 'Strip lashes', category: 'Add-on', price: 20, durationMins: 0 },
    { name: 'Early start (before 6am)', category: 'Add-on', price: 50, durationMins: 0 },
    { name: 'Touch-up kit', category: 'Add-on', price: 35, durationMins: 0 }
  ];

  /* ---------- settings ---------- */
  function bookingLink(value) {
    try {
      const url = new URL(value);
      if (['http:', 'https:'].includes(url.protocol) && !/(^|\.)cal\.com\.?$/i.test(url.hostname)) return url.href;
    } catch {}
    return DEFAULT_PROFILE.bookingLink;
  }
  const profile = () => {
    const saved = { ...DEFAULT_PROFILE, ...(DB.setting('profile', {}) || {}) };
    return { ...saved, bookingLink:bookingLink(saved.bookingLink) };
  };
  const saveProfile = patch => {
    const settings = { ...profile(), ...patch };
    return DB.setSetting('profile', { ...settings, bookingLink:bookingLink(settings.bookingLink) });
  };
  const services = (activeOnly = false) => DB.list('services', s => !activeOnly || s.active !== false)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));

  async function ensureDefaults() {
    if (!DB.setting('profile')) await saveProfile({});
    if (!DB.list('services').length) {
      let i = 0;
      for (const s of DEFAULT_SERVICES) await DB.save('services', { ...s, active: true, sort: i++ });
    }
  }

  /* ---------- helpers ---------- */
  const fresh = b => DB.get('bookings', typeof b === 'string' ? b : b.id);
  const clientOf = b => DB.get('clients', b.clientId) || {};
  const clientName = c => [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unnamed client';
  const atTime = (dateStr, hhmm = '10:00') => { const d = parseYmd(dateStr); const [h, m] = hhmm.split(':').map(Number); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const daysFromNow = (n, hhmm = '10:00') => atTime(ymd(addDays(new Date(), n)), hhmm);

  async function log(b, type, text, extra = {}) {
    return DB.save('activity', { bookingId: b?.id || null, clientId: b?.clientId || extra.clientId || null, type, text,
      userId: window.Auth?.current?.id || null, at: new Date().toISOString(), ...extra });
  }

  /* ---------- money ---------- */
  function totals(b) {
    const p = profile();
    const lines = b.lines || [];
    const servicesTotal = lines.reduce((s, l) => s + (+l.qty || 0) * (+l.price || 0), 0);
    const travel = +b.travelFee || 0;
    const discount = +b.discount || 0;
    const additionalCosts = +b.additionalCosts || 0;
    const total = Math.max(0, servicesTotal + travel + additionalCosts - discount);
    const gst = p.gstRegistered ? total / 11 : 0;
    const deposit = (b.depositAmount !== undefined && b.depositAmount !== null && b.depositAmount !== '')
      ? +b.depositAmount : Math.round(total * (+p.depositPercent || 0) / 100);
    const pays = DB.list('payments', x => x.bookingId === b.id);
    const paid = pays.reduce((s, x) => s + (+x.amount || 0), 0);
    const depositPaid = pays.filter(x => x.type === 'deposit').reduce((s, x) => s + (+x.amount || 0), 0);
    return { servicesTotal, travel, additionalCosts, discount, total, gst, deposit, paid, depositPaid, balance: Math.max(0, total - paid) };
  }

  const developerModeKey = () => {
    const user = window.Auth?.current;
    return user?.role === 'owner' && user.id ? `crm:developer-mode:${user.id}` : null;
  };

  function developerModeEnabled() {
    const key = developerModeKey();
    return !!key && window.sessionStorage?.getItem(key) === 'on';
  }

  function setDeveloperMode(enabled) {
    const key = developerModeKey();
    if (!key) throw Error('Only the CRM owner can change developer mode');
    if (enabled) window.sessionStorage.setItem(key, 'on');
    else window.sessionStorage.removeItem(key);
  }

  /* ---------- guards ---------- */
  // Each reason: { text, soft } — soft reasons can be overridden ("continue anyway").
  function checkNext(b) {
    b = fresh(b) || b;
    const i = idx(b.stage);
    const next = STAGES[i + 1] || null;
    const reasons = [];
    if (b.status === 'lost') return { next, ok: false, canOverride: false, reasons: [{ text: 'Booking is marked lost — reopen it first' }] };
    if (!next) return { next: null, ok: false, canOverride: false, reasons: [{ text: 'Booking is complete' }] };
    const t = totals(b);
    switch (b.stage) {
      case 'enquiry':
        if (b.consultation?.provider !== 'crm' || b.consultation?.status !== 'confirmed') reasons.push({ text: 'Chanel must approve the phone consultation in the CRM' });
        break;
      case 'call':
        if (!b.callLoggedAt || !b.callNotes?.trim()) reasons.push({ text: 'Complete the call and save consultation notes' });
        break;
      case 'updates':
        if (!b.eventDate) reasons.push({ text: 'Add the event date' });
        if (!(b.lines || []).length) reasons.push({ text: 'Add at least one service to the quote' });
        else if (t.total <= 0) reasons.push({ text: 'Quote total needs to be more than $0' });
        if (b.eventDate && dateClashes(b).length) reasons.push({ text: `You already have ${dateClashes(b).length} confirmed booking(s) that day`, soft: true });
        break;
      case 'deposit':
        if (t.deposit > 0 && t.depositPaid < t.deposit) reasons.push({ text: `Record the ${money(t.deposit)} deposit` });
        break;
      case 'booked':
        if (!developerModeEnabled() && b.eventDate && b.eventDate > today()) reasons.push({ text: `The day hasn’t arrived yet (${fmtDate(b.eventDate)})`, soft: true });
        break;
      case 'day':
        if (!DB.list('photos', p => p.bookingId === b.id).length) reasons.push({ text: 'No photos uploaded from the day yet', soft: true });
        break;
      case 'invoice':
        if (t.balance > 0) reasons.push({ text: `${money(t.balance)} still owing on the final invoice` });
        break;
      case 'review':
        if (!b.followUpSentAt) reasons.push({ text: 'Send and log the thank-you follow-up email' });
        if (!DB.find('reviews', r => r.bookingId === b.id)) reasons.push({ text: 'No review recorded yet', soft: true });
        break;
    }
    return { next, ok: reasons.length === 0, canOverride: reasons.length > 0 && reasons.every(r => r.soft), reasons };
  }

  function dateClashes(b) {
    return DB.list('bookings', x => x.id !== b.id && x.status !== 'lost' && x.eventDate === b.eventDate &&
      idx(x.stage) >= idx('booked') && idx(x.stage) <= idx('day'));
  }

  /* ---------- stage moves ---------- */
  async function setStage(b, key, note = '') {
    const prev = b.stage;
    if(key === 'booked' && (!b.callLoggedAt || b.consultation?.provider !== 'crm' || b.consultation?.status !== 'confirmed')) throw new Error('Complete the CRM-approved phone consultation before confirming the makeup appointment');
    if(key === 'booked' && window.Connectors) await window.Connectors.ensureBlock(fresh(b));
    b = await DB.save('bookings', { ...fresh(b), stage: key, stageChangedAt: new Date().toISOString() });
    await log(b, 'stage', `Moved to ${stage(key).label}${note ? ' — ' + note : ''}`, { from: prev, to: key });
    await onEnter(b, key);
    return fresh(b);
  }

  async function advance(b, { override = false } = {}) {
    b = fresh(b);
    const chk = checkNext(b);
    if (!chk.next) return { ok: false, reasons: chk.reasons.map(r => r.text) };
    if (!chk.ok && !(override && chk.canOverride))
      return { ok: false, canOverride: chk.canOverride, reasons: chk.reasons.map(r => r.text) };
    const note = (!chk.ok && override) ? 'continued anyway: ' + chk.reasons.map(r => r.text.toLowerCase()).join('; ') : '';
    const booking = await setStage(b, chk.next.key, note);
    return { ok: true, booking, stage: chk.next };
  }

  async function moveBack(b) {
    b = fresh(b);
    const i = idx(b.stage);
    if (i <= 0) return b;
    return setStage(b, STAGES[i - 1].key, 'moved back');
  }

  async function onEnter(b, key) {
    const name = clientName(clientOf(b));
    const p = profile();
    switch (key) {
      case 'deposit':
        await ensureInvoice(b, 'deposit');
        await upsertReminder(b, { kind: 'deposit_chase', title: `Chase deposit — ${name}`, dueAt: daysFromNow(+p.depositDueDays || 3), templateKey: 'deposit_reminder' });
        break;
      case 'booked':
        if(window.Connectors && b.calendarStart && b.calendarEnd) await window.Connectors.request('sync-booking',{bookingId:b.id});
        await skipKinds(b, ['deposit_chase', 'reply', 'call']);
        await refreshInvoices(b);
        await generateEventReminders(b);
        break;
      case 'day':
        await skipKinds(b, ['event_']);
        break;
      case 'invoice':
        await ensureInvoice(b, 'final');
        await upsertReminder(b, { kind: 'final_send', title: `Send final invoice — ${name}`, dueAt: new Date().toISOString(), templateKey: 'final_invoice' });
        await upsertReminder(b, { kind: 'final_chase', title: `Chase final payment — ${name}`, dueAt: daysFromNow(+p.paymentTermsDays || 7), templateKey: 'final_reminder' });
        break;
      case 'review':
        await upsertReminder(b, { kind: 'service_followup', title: `Thank ${name} and send receipt`, dueAt: daysFromNow(1), templateKey: 'service_followup' });
        await skipKinds(b, ['final_send', 'final_chase']);
        await refreshInvoices(b);
        await upsertReminder(b, { kind: 'review_request', title: `Ask ${name} for a review`, dueAt: daysFromNow(1), templateKey: 'review_request' });
        await upsertReminder(b, { kind: 'review_followup', title: `Review follow-up — ${name}`, dueAt: daysFromNow(6), templateKey: 'review_followup' });
        break;
      case 'complete':
        await skipKinds(b, ['review_request', 'review_followup', 'service_followup']);
        break;
    }
  }

  /* ---------- reminders ---------- */
  async function upsertReminder(b, { kind, title, dueAt, templateKey = '', channel = 'email' }) {
    const existing = DB.find('reminders', r => r.bookingId === b.id && r.kind === kind && r.status === 'pending');
    return DB.save('reminders', { ...(existing || {}), bookingId: b.id, clientId: b.clientId, kind, title, dueAt, templateKey, channel, status: 'pending' });
  }
  async function addReminder(b, data) {
    return DB.save('reminders', { bookingId: b?.id || null, clientId: b?.clientId || null, kind: 'custom', status: 'pending', channel: 'email', ...data });
  }
  async function skipKinds(b, kinds) {
    for (const r of DB.list('reminders', r => r.bookingId === b.id && r.status === 'pending' && kinds.some(k => r.kind.startsWith(k))))
      await DB.save('reminders', { ...r, status: 'skipped', closedAt: new Date().toISOString() });
  }
  async function completeReminder(id, status = 'done') {
    const r = DB.get('reminders', id); if (!r) return;
    await DB.save('reminders', { ...r, status, closedAt: new Date().toISOString() });
    const b = DB.get('bookings', r.bookingId);
    if (b) await log(b, 'reminder', `${status === 'done' ? 'Completed' : 'Skipped'}: ${r.title}`);
  }

  const TEMPLATE_FOR_OFFSET = { 14: 'remind_14', 7: 'remind_7', 2: 'remind_2', 1: 'remind_1' };
  async function generateEventReminders(b) {
    b = fresh(b);
    if (!b.eventDate) return;
    const name = clientName(clientOf(b));
    const offsets = String(profile().reminderOffsets || '').split(',').map(s => parseInt(s, 10)).filter(n => n > 0);
    // clear pending event reminders, then rebuild (handles date changes)
    for (const r of DB.list('reminders', r => r.bookingId === b.id && r.status === 'pending' && r.kind.startsWith('event_')))
      await DB.remove('reminders', r.id);
    const now = Date.now();
    for (const n of offsets) {
      const dueAt = atTime(ymd(addDays(parseYmd(b.eventDate), -n)), '10:00');
      if (new Date(dueAt).getTime() < now - 86400000) continue;     // already well past
      await upsertReminder(b, { kind: `event_${n}`, title: `${n}-day reminder — ${name}`, dueAt, templateKey: TEMPLATE_FOR_OFFSET[n] || 'remind_generic', channel: n <= 2 ? 'sms' : 'email' });
    }
    await upsertReminder(b, { kind: 'event_day', title: `Today: ${name}${b.readyBy ? ' — ready by ' + fmtTime(b.readyBy) : ''}`, dueAt: atTime(b.eventDate, '05:00') });
  }

  function dueReminders(untilEndOfDay = true) {
    const end = new Date(); if (untilEndOfDay) end.setHours(23, 59, 59, 999);
    return DB.list('reminders', r => {
      if (r.status !== 'pending' || new Date(r.dueAt) > end) return false;
      const b = DB.get('bookings', r.bookingId);
      return !b || b.status !== 'lost';
    }).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  }

  /* ---------- invoices ---------- */
  async function nextInvoiceNumber() {
    const n = (+DB.setting('invoiceCounter', 0) || 0) + 1;
    await DB.setSetting('invoiceCounter', n);
    return 'CM-' + String(n).padStart(4, '0');
  }

  async function ensureInvoice(b, type) {
    b = fresh(b);
    const t = totals(b); const p = profile();
    let items;
    if (type === 'deposit') {
      items = [{ desc: `Booking deposit — ${b.eventType || 'makeup'} on ${fmtDate(b.eventDate)}`, qty: 1, price: t.deposit }];
    } else {
      items = (b.lines || []).map(l => ({ desc: l.name, qty: +l.qty || 1, price: +l.price || 0 }));
      if (t.additionalCosts) items.push({ desc: b.additionalCostsReason || 'Agreed additional costs', qty: 1, price: t.additionalCosts });
      if (t.travel) items.push({ desc: 'Travel fee', qty: 1, price: t.travel });
      if (t.discount) items.push({ desc: 'Discount', qty: 1, price: -t.discount });
      if (t.depositPaid) items.push({ desc: 'Less deposit received', qty: 1, price: -t.depositPaid });
    }
    const total = items.reduce((s, i) => s + i.qty * i.price, 0);
    const inv = DB.find('invoices', x => x.bookingId === b.id && x.type === type);
    if (inv && (inv.status === 'paid' || inv.stripeInvoiceId)) return inv;
    const saved = await DB.save('invoices', {
      ...(inv || {}), bookingId: b.id, clientId: b.clientId, type,
      number: inv?.number || await nextInvoiceNumber(),
      items, total, gst: p.gstRegistered ? total / 11 : 0, status: 'draft',
      issuedAt: inv?.issuedAt || today(),
      dueAt: inv?.dueAt || ymd(addDays(new Date(), type === 'deposit' ? (+p.depositDueDays || 3) : (+p.paymentTermsDays || 7)))
    });
    if (!inv) await log(b, 'invoice', `${type === 'deposit' ? 'Deposit' : 'Final'} invoice ${saved.number} raised for ${money(total)}`);
    await refreshInvoices(b);
    return saved;
  }

  async function refreshInvoices(b) {
    b = fresh(b);
    const t = totals(b);
    for (const inv of DB.list('invoices', x => x.bookingId === b.id && x.status !== 'paid')) {
      const covered = inv.type === 'deposit' ? t.depositPaid : (t.paid - t.depositPaid);
      if (covered >= inv.total - 0.005) {
        await DB.save('invoices', { ...inv, status: 'paid', paidAt: today() });
        await log(b, 'invoice', `Invoice ${inv.number} paid in full`);
      }
    }
  }

  /* ---------- actions used by the UI ---------- */
  async function createEnquiry(f, { source = 'Enquiry form', photos = [] } = {}) {
    const requestedAt = f.consultAt ? new Date(f.consultAt + ':00+10:00') : null;
    if (requestedAt && (!Number.isFinite(+requestedAt) || +requestedAt <= Date.now())) throw Error('Choose a future phone consultation time');
    const email = (f.email || '').trim().toLowerCase();
    let client = email ? DB.find('clients', c => (c.email || '').toLowerCase() === email) : null;
    client = await DB.save('clients', {
      ...(client || {}),
      firstName: f.firstName || client?.firstName || '', lastName: f.lastName || client?.lastName || '',
      email: f.email || client?.email || '', phone: f.phone || client?.phone || '',
      instagram: f.instagram || client?.instagram || '',
      skinType: f.skinType || client?.skinType || '', allergies: f.allergies || client?.allergies || '',
      source: client?.source || f.heardFrom || source
    });
    const svc = DB.list('services');
    const party = Math.max(1, parseInt(f.partySize, 10) || 1);
    const lines = (f.services || []).map(id => {
      const s = svc.find(x => x.id === id); if (!s) return null;
      const qty = s.name.toLowerCase().includes('bridesmaid') ? Math.max(1, party - 1) : 1;
      return { serviceId: s.id, name: s.name, qty, price: s.price };
    }).filter(Boolean);
    const b = await DB.save('bookings', {
      clientId: client.id, stage: 'enquiry', status: 'open', source,
      eventType: f.eventType || '', eventDate: f.eventDate || '', readyBy: f.readyBy || '', location: f.location || '',
      partySize: party, lines, travelFee: '', discount: '', depositAmount: '',
      answers: { trial: f.trial || '', look: f.look || '', heardFrom: f.heardFrom || '', callPref: f.callPref || '', notes: f.notes || '', skinType: f.skinType || '', allergies: f.allergies || '' },
      stageChangedAt: new Date().toISOString()
    });
    if (requestedAt) await scheduleCall(b, requestedAt.toISOString());
    await log(b, 'enquiry', `New enquiry via ${source}`);
    await upsertReminder(b, { kind: 'enquiry_review', title: `Review ${clientName(client)}’s enquiry`, dueAt: daysFromNow(0, '23:00') });
    for (const file of photos) await addPhoto(b, file, 'inspo', 'Inspiration from enquiry');
    return fresh(b);
  }

  async function consultationAction(b, action, details = {}) {
    const { data, error } = await DB.client.functions.invoke('consultation-manage', { body: { bookingId: fresh(b).id, action, ...details } });
    if (error || !data?.ok) throw new Error(data?.error || error?.message || 'Consultation update failed');
    await DB.refresh();
    if (data.calendarError) UI.toast('Appointment saved; Apple Calendar needs a retry. ' + data.calendarError, 'error');
    if (data.emailError) throw new Error('Appointment saved, but the mail service could not send the consultation email. ' + data.emailError);
    return fresh(b);
  }
  async function scheduleCall(b, iso, exceptionReason = '') {
    return consultationAction(b, 'schedule', { start: iso, exceptionReason });
  }

  async function reviewEnquiry(b, notes) {
    if (!notes?.trim()) throw new Error('Add review notes');
    b = await DB.save('bookings', { ...fresh(b), enquiryReviewNotes: notes.trim(), enquiryReviewedAt: new Date().toISOString() });
    await log(b, 'review', 'Enquiry reviewed: ' + notes.trim());
    await skipKinds(b, ['reply', 'enquiry_review']);
    return b;
  }

  async function approveConsultation(b) {
    b = fresh(b);
    if (!b.callAt) throw new Error('Schedule the phone consultation first');
    return consultationAction(b, 'approve');
  }

  async function logCall(b, notes, updates = {}) {
    const cur = fresh(b);
    const callNote = notes?.trim();
    if (['enquiry', 'call'].includes(cur.stage) && (cur.consultation?.provider !== 'crm' || cur.consultation?.status !== 'confirmed')) throw new Error('Approve the phone consultation first');
    if (!developerModeEnabled() && ['enquiry', 'call'].includes(cur.stage) && new Date(cur.callAt) > new Date()) throw new Error('The scheduled call has not started yet');
    const patch = { callLoggedAt: cur.callLoggedAt || new Date().toISOString() };
    if (callNote) patch.callNotes = [cur.callNotes, callNote].filter(Boolean).join('\n\n');
    if (updates.readyBy !== undefined) patch.readyBy = updates.readyBy;
    if (updates.clientAddress !== undefined) patch.clientAddress = String(updates.clientAddress).trim();
    for (const k of ['eventDate', 'location', 'partySize', 'eventType']) if (updates[k]) patch[k] = updates[k];
    b = await DB.save('bookings', { ...cur, ...patch });
    await log(b, 'call', callNote ? `Call notes: ${callNote}` : 'Call details saved');
    const r = DB.find('reminders', r => r.bookingId === b.id && r.kind === 'call' && r.status === 'pending');
    if (r) await completeReminder(r.id);
    if (b.stage === 'enquiry' || b.stage === 'call') b = await setStage(b, 'updates');
    return fresh(b);
  }

  async function saveBooking(b, patch, what = 'Details updated') {
    const before = fresh(b);
    if (patch.lines && DB.find('invoices', i => i.bookingId === before.id &&
      (i.type === 'final' && (i.stripeInvoiceId || i.status === 'paid') ||
       i.type === 'deposit' && i.stripeInvoiceId && i.status !== 'paid'))) {
      throw Error('Reconcile the issued invoice in Stripe before changing quote lines');
    }
    if (patch.additionalCosts !== undefined) {
      if (!before.callLoggedAt) throw Error('Complete the phone consultation before adding costs');
      if (!Number.isFinite(+patch.additionalCosts) || +patch.additionalCosts < 0) throw Error('Enter a valid additional cost');
      if (+patch.additionalCosts > 0 && !String(patch.additionalCostsReason || '').trim()) throw Error('Describe the agreed additional cost');
      if (+patch.additionalCosts !== (+before.additionalCosts || 0) && DB.find('invoices', i => i.bookingId === before.id && i.type === 'final' && (i.stripeInvoiceId || i.status === 'paid'))) throw Error('Reconcile the issued final invoice in Stripe before changing its costs');
    }
    if(DB.setting('connectorPreferences',{}).enabled && before.calendarSync){
      const calendarStart = before.calendarStart && new Date(before.calendarStart).toLocaleDateString('en-CA',{timeZone:'Australia/Brisbane'});
      const calendarEnd = before.calendarEnd && new Date(before.calendarEnd).toLocaleDateString('en-CA',{timeZone:'Australia/Brisbane'});
      if(patch.eventDate && patch.eventDate !== before.eventDate && ![calendarStart,calendarEnd].includes(patch.eventDate))
        throw new Error('Move the CRM calendar time block to the new event date before saving details.');
    }
    let nextBooking={...before,...patch};
    if(window.Connectors?.automaticBlock && (!before.calendarStart || before.calendarTimeMode==='automatic') &&
      ['eventDate','startTime','readyBy','lines','partySize'].some(k=>k in patch)){
      nextBooking=window.Connectors.automaticBlock(nextBooking);
      await window.Connectors.ensureBlock(nextBooking,false);
    }
    b = await DB.save('bookings', nextBooking);
    await log(b, 'edit', what);
    if (patch.eventDate !== undefined && patch.eventDate !== before.eventDate && idx(b.stage) >= idx('booked') && idx(b.stage) <= idx('day'))
      await generateEventReminders(b);
    // keep open invoices in step with the quote
    const si = idx(b.stage);
    if (si === idx('deposit')) await ensureInvoice(b, 'deposit');
    if (si === idx('invoice')) await ensureInvoice(b, 'final');
    return fresh(b);
  }

  async function recordPayment(b, { type, amount, method, paidAt, reference }) {
    b = fresh(b);
    if (DB.find('invoices', i => i.bookingId === b.id && i.stripeInvoiceId && i.status !== 'paid')) throw Error('This booking has an open Stripe invoice. Refresh its payment status or reconcile it in Stripe before recording another payment.');
    amount = +amount;
    if (!(amount > 0)) throw new Error('Enter an amount above $0');
    await DB.save('payments', { bookingId: b.id, clientId: b.clientId, type, amount, method, paidAt: paidAt || today(), reference: reference || '' });
    await log(b, 'payment', `${money(amount)} ${type} payment received (${method || 'unspecified'})`);
    await refreshInvoices(b);
    let advancedTo = null;
    b = fresh(b);
    if ((b.stage === 'deposit' || b.stage === 'updates') && type === 'deposit') {
      if (b.stage === 'updates') { const r = await advance(b); if (r.ok) b = r.booking; }
      if (b.stage === 'deposit' && checkNext(b).ok) { const r = await advance(b); if (r.ok) advancedTo = r.stage; }
    } else if (b.stage === 'invoice' && checkNext(b).ok) {
      const r = await advance(b); if (r.ok) advancedTo = r.stage;
    }
    return { booking: fresh(b), advancedTo };
  }

  async function deletePayment(id) {
    const p = DB.get('payments', id); if (!p) return;
    await DB.remove('payments', id);
    const b = DB.get('bookings', p.bookingId);
    if (b) {
      for (const inv of DB.list('invoices', x => x.bookingId === b.id && x.status === 'paid')) {
        await DB.save('invoices', { ...inv, status: inv.stripeInvoiceId ? 'open' : 'draft', paidAt: '' });
      }
      await refreshInvoices(b);
      await log(b, 'payment', `Removed ${money(p.amount)} ${p.type} payment`);
    }
  }

  async function markLost(b, reason) {
    if(window.Connectors && (fresh(b)?.calendarSync || fresh(b)?.calendarStart || fresh(b)?.callAt)) await window.Connectors.removeBlock(fresh(b));
    b = await DB.save('bookings', { ...fresh(b), status: 'lost', lostReason: reason || '' });
    await log(b, 'status', `Marked lost${reason ? ': ' + reason : ''}`);
    for (const r of DB.list('reminders', r => r.bookingId === b.id && r.status === 'pending'))
      await DB.save('reminders', { ...r, status: 'skipped' });
    return b;
  }
  async function archiveBooking(b) {
    b = fresh(b);
    if (!b.archivedAt) b = await DB.save('bookings', { ...b, status:'lost',
      archivedAt:new Date().toISOString(), archivedBy:window.Auth?.current?.id || null,
      statusBeforeArchive:b.status });
    if (window.Connectors && (b.calendarSync || b.calendarStart || b.callAt)) {
      const actions = b.callAt ? ['remove-block', 'remove-consult'] : ['remove-block'];
      const results = await Promise.allSettled(actions.map(action => window.Connectors.request(action, { bookingId:b.id })));
      if (results.some(result => result.status === 'rejected')) UI.toast('Archived in the CRM. Check Apple Calendar for the old event.', 'error');
    }
    return b;
  }
  async function restoreBooking(b) {
    b = fresh(b);
    if (!b.archivedAt) return b;
    return DB.save('bookings', { ...b, status:b.statusBeforeArchive || 'open',
      archivedAt:null, archivedBy:null, statusBeforeArchive:null });
  }
  async function reopen(b) {
    b = await DB.save('bookings', { ...fresh(b), status: 'open', lostReason: '' });
    await log(b, 'status', 'Reopened');
    return b;
  }
  async function deleteBooking(b) {
    if(window.Connectors && (fresh(b)?.calendarSync || fresh(b)?.calendarStart || fresh(b)?.callAt)) await window.Connectors.removeBlock(fresh(b));
    for (const s of ['payments', 'invoices', 'reminders', 'reviews', 'activity'])
      for (const r of DB.list(s, x => x.bookingId === b.id)) await DB.remove(s, r.id);
    for (const p of DB.list('photos', x => x.bookingId === b.id)) { await DB.removeBlob(p.id); await DB.remove('photos', p.id); }
    await DB.remove('bookings', b.id);
  }
  async function deleteClient(c) {
    for (const b of DB.list('bookings', x => x.clientId === c.id)) await deleteBooking(b);
    for (const r of DB.list('reviews', x => x.clientId === c.id)) await DB.remove('reviews', r.id);
    await DB.remove('clients', c.id);
  }

  async function addReview(b, { rating, text, source, consent }) {
    b = fresh(b);
    await DB.save('reviews', { bookingId: b.id, clientId: b.clientId, rating: +rating || 5, text: text || '', source: source || 'Direct', consentToShare: !!consent, receivedAt: today() });
    await log(b, 'review', `${rating}★ review recorded (${source || 'Direct'})`);
    await skipKinds(b, ['review_request', 'review_followup']);
    let advancedTo = null;
    if (b.stage === 'review') { const r = await advance(b); if (r.ok) advancedTo = r.stage; }
    return { advancedTo };
  }

  async function addPhoto(b, file, kind = 'day', caption = '') {
    const video = ['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type);
    if (!video && !file.type.startsWith('image/')) throw Error('Choose an image or MP4, WebM or MOV video');
    if (video && file.size > 6 * 1024 * 1024) throw Error('Choose a video smaller than 6 MB');
    const id = DB.uid(), storagePath = video ? id + ({'video/mp4':'.mp4','video/webm':'.webm','video/quicktime':'.mov'}[file.type]) : id + '.jpg';
    if (video) {
      const {error} = await DB.client.storage.from(window.CRM_CONFIG.photoBucket).upload(storagePath, file, {contentType:file.type});
      if (error) throw Error('Uploading video: ' + error.message);
    } else await DB.putBlob(id, await UI.resizeImage(file));
    let meta;
    try { meta = await DB.save('photos', { id, bookingId: b.id, clientId: b.clientId, kind, caption, storagePath, mediaType: video ? 'video' : 'image', fileName: file.name || '', takenAt: today() }); }
    catch (e) { await DB.client.storage.from(window.CRM_CONFIG.photoBucket).remove([storagePath]); throw e; }
    return meta;
  }
  async function deletePhoto(id) { await DB.removeBlob(id); await DB.remove('photos', id); }

  async function logMessage(b, templateKey, subject, channel) {
    if (templateKey === 'service_followup') await DB.save('bookings', {...fresh(b), followUpSentAt: new Date().toISOString()});
    const t = TEMPLATES[templateKey];
    await log(b, 'message', `Sent "${t ? t.label : subject}" by ${channel || 'message'}`);
    // sending a template satisfies any matching pending reminder
    const r = DB.find('reminders', r => r.bookingId === b.id && r.status === 'pending' && r.templateKey === templateKey);
    if (r) await completeReminder(r.id);
  }

  /* ---------- message templates ---------- */
  function vars(b) {
    const c = clientOf(b); const p = profile(); const t = totals(b);
    const invoice = DB.find('invoices', i => i.bookingId === b.id && i.type === (idx(b.stage) < idx('booked') ? 'deposit' : 'final'));
    const stripeLink = invoice?.stripeUrl && /^https:\/\/invoice\.stripe\.com\//.test(invoice.stripeUrl) ? invoice.stripeUrl : '';
    const pay = stripeLink || [p.bankAccountName && `Account name: ${p.bankAccountName}`, p.bsb && `BSB: ${p.bsb}`, p.accountNumber && `Account: ${p.accountNumber}`, p.payId && `PayID: ${p.payId}`].filter(Boolean).join('\n') || '[add your payment details in Profile]';
    const lines = (b.lines || []).map(l => `• ${l.name}${+l.qty > 1 ? ' × ' + l.qty : ''} — ${money(l.qty * l.price)}`).join('\n') || '• [add services to the quote]';
    return {
      first: c.firstName || 'there', artist: (p.artistName || '').split(' ')[0] || 'Chanel', business: p.businessName,
      eventType: (b.eventType || 'event').toLowerCase(), date: b.eventDate ? fmtDate(b.eventDate) : '[date TBC]',
      readyBy: b.readyBy ? fmtTime(b.readyBy) : '[time TBC]', location: b.location || '[location TBC]',
      call: b.callAt ? fmtDateTime(b.callAt) : '[call time]', lines, total: money(t.total), deposit: money(t.deposit),
      balance: money(t.balance), paidInFull: t.balance <= 0, stripeLink, pay, policy: p.cancellationPolicy, reviewLink: p.reviewLink || '[add your review link in Profile]',
      bookingLink: p.bookingLink, instagram: p.instagram, phone: p.phone
    };
  }
  const sign = v => `\n\nWarmly,\n${v.artist}\n${v.business}${v.instagram ? '\n' + v.instagram : ''}`;
  const TEMPLATES = {
    enquiry_reply: { label: 'Reply to enquiry', stage: 'enquiry', build: v => ({ subject: `Your makeup enquiry — ${v.date}`, body:
      `Hi ${v.first},\n\nThank you so much for reaching out about your ${v.eventType} on ${v.date}! I'd love to be part of your day.\n\nBefore I put together a quote I like to have a quick 15-minute phone call so I can understand the look you're after, timings and how many people need makeup. When suits you for a chat?` + sign(v) }) },
    call_confirm: { label: 'Confirm phone call', stage: 'call', build: v => ({ subject: 'Our call', body:
      `Hi ${v.first},\n\nJust confirming our call on ${v.call}. Feel free to have any inspiration photos handy — talk soon!` + sign(v) }) },
    quote: { label: 'Quote & deposit request', stage: 'updates', build: v => ({ subject: `Your quote — ${v.business}`, body:
      `Hi ${v.first},\n\nIt was lovely chatting with you! Here's your quote for ${v.date} (ready by ${v.readyBy}) at ${v.location}:\n\n${v.lines}\n\nTotal: ${v.total}\n\nTo secure your date, a deposit of ${v.deposit} is required:\n${v.pay}\n\n${v.policy}\n\nOnce the deposit lands your date is locked in and I'll send through everything you need closer to the day.` + sign(v) }) },
    deposit_reminder: { label: 'Deposit reminder', stage: 'deposit', build: v => ({ subject: 'Securing your date', body:
      `Hi ${v.first},\n\nJust a gentle reminder that your date (${v.date}) isn't secured until the ${v.deposit} deposit comes through. I'd hate for you to miss out!\n\n${v.pay}` + sign(v) }) },
    deposit_received: { label: 'Deposit received — you’re booked', stage: 'booked', build: v => ({ subject: 'You’re booked in!', body:
      `Hi ${v.first},\n\nYour deposit has been received and you're officially booked for ${v.date}! I'll be in touch in the lead-up with timings and skin prep tips.\n\nRemaining balance: ${v.balance}` + sign(v) }) },
    remind_14: { label: '2-week check-in', stage: 'booked', build: v => ({ subject: 'Two weeks to go!', body:
      `Hi ${v.first},\n\nOnly two weeks until ${v.date}! A few quick things:\n• Is the number of people needing makeup still the same?\n• Still ready by ${v.readyBy} at ${v.location}?\n• Any new inspiration photos? Send them through.\n\nSkin tip: now's the time to keep skin hydrated and avoid trying any new products or treatments.` + sign(v) }) },
    remind_7: { label: '1-week timings', stage: 'booked', build: v => ({ subject: 'One week to go — timings', body:
      `Hi ${v.first},\n\nOne week to go! Confirming:\n• Date: ${v.date}\n• Ready by: ${v.readyBy}\n• Location: ${v.location}\n\nPlease let me know about parking/access and a spot near a window for natural light.` + sign(v) }) },
    remind_2: { label: 'Skin prep (2 days)', stage: 'booked', build: v => ({ subject: 'Skin prep for your big day', body:
      `Hi ${v.first}! Two days to go. Skin prep tips: drink lots of water, moisturise morning and night, gentle exfoliation tonight only, and no new products. Arrive with a clean, moisturised face (no makeup). See you ${v.date}! — ${v.artist}` }) },
    remind_1: { label: 'See you tomorrow', stage: 'booked', build: v => ({ subject: 'See you tomorrow!', body:
      `Hi ${v.first}! Can't wait for tomorrow. I'll arrive in time for you to be ready by ${v.readyBy} at ${v.location}. Clean, moisturised skin please and wear a button-up top. — ${v.artist}` }) },
    remind_generic: { label: 'Event reminder', stage: 'booked', build: v => ({ subject: `Reminder: ${v.date}`, body:
      `Hi ${v.first},\n\nJust a reminder about your makeup booking on ${v.date}, ready by ${v.readyBy} at ${v.location}.` + sign(v) }) },
    service_followup: { label: 'Thank you + payment / receipt', stage: 'review', build: v => ({ subject: `Thank you for choosing ${v.business}`, body:
      `Hi ${v.first},\n\nThank you for having me on ${v.date}! I hope you enjoyed your makeup experience.\n\n${v.paidInFull ? 'Your balance is paid in full. ' + (v.stripeLink ? 'View your paid invoice / receipt in Stripe:\n' + v.stripeLink : 'Thank you for your payment. Please reply if you need a receipt.') : 'Your remaining balance is ' + v.balance + ':\n' + v.pay}\n\nI would love to hear your feedback. You can reply to this email or leave a review:\n${v.reviewLink}` + sign(v) }) },
    final_invoice: { label: 'Thank you + final invoice', stage: 'invoice', build: v => ({ subject: 'Thank you! Your final invoice', body:
      `Hi ${v.first},\n\nThank you so much for having me on ${v.date} — you looked incredible!\n\nYour remaining balance is ${v.balance}:\n${v.pay}\n\nI'll share a few photos from the day soon.` + sign(v) }) },
    final_reminder: { label: 'Payment reminder', stage: 'invoice', build: v => ({ subject: 'Friendly payment reminder', body:
      `Hi ${v.first},\n\nJust a friendly reminder that ${v.balance} is still outstanding from ${v.date}.\n\n${v.pay}\n\nIf you've already paid, thank you and please ignore this!` + sign(v) }) },
    review_request: { label: 'Review request', stage: 'review', build: v => ({ subject: 'Would you leave a quick review?', body:
      `Hi ${v.first},\n\nI hope you had the most amazing day! If you have a spare minute, a review would mean the world to me and helps other clients find me:\n${v.reviewLink}\n\nAnd if you share any photos, tag ${v.instagram}!` + sign(v) }) },
    review_followup: { label: 'Review follow-up', stage: 'review', build: v => ({ subject: 'Quick favour?', body:
      `Hi ${v.first}! Just a gentle nudge in case it slipped by — a quick review would be so appreciated: ${v.reviewLink} Thank you! — ${v.artist}` }) }
  };
  const renderTemplate = (key, b) => TEMPLATES[key].build(vars(fresh(b) || b));

  window.Workflow = {
    developerModeEnabled, setDeveloperMode, STAGES, idx, stage, EVENT_TYPES, PAY_METHODS, TEMPLATES, DEFAULT_PROFILE,
    profile, saveProfile, services, ensureDefaults, clientOf, clientName, totals, checkNext, advance, moveBack,
    createEnquiry, scheduleCall, reviewEnquiry, approveConsultation, logCall, saveBooking, recordPayment, deletePayment, markLost, reopen,
    archiveBooking, restoreBooking, deleteBooking, deleteClient, addReview, addPhoto, deletePhoto, addReminder, completeReminder, dueReminders,
    generateEventReminders, ensureInvoice, logMessage, renderTemplate, log, dateClashes, daysFromNow
  };
})();
