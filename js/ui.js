/* Chanel Monroe CRM — UI helpers (formatting, icons, toasts, modals) */
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
  const money = n => AUD.format(+n || 0);
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => ymd(new Date());
  const parseYmd = s => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const toDate = s => !s ? null : (s.length === 10 ? parseYmd(s) : new Date(s));
  const fmtDate = s => { const d = toDate(s); return d ? d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };
  const fmtShort = s => { const d = toDate(s); return d ? d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : 'No date'; };
  const fmtTime = t => {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ap = h >= 12 ? 'pm' : 'am'; const hh = ((h + 11) % 12) + 1;
    return `${hh}${m ? ':' + pad(m) : ''}${ap}`;
  };
  const fmtDateTime = iso => iso ? new Date(iso).toLocaleString('en-AU', { timeZone:'Australia/Brisbane', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';
  const daysUntil = s => s ? Math.round((parseYmd(s) - parseYmd(today())) / 86400000) : null;
  const toLocalInput = iso => { if (!iso) return ''; const d = new Date(iso); return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const relDays = s => {
    const n = daysUntil(s);
    if (n === null) return '';
    if (n === 0) return 'Today'; if (n === 1) return 'Tomorrow'; if (n === -1) return 'Yesterday';
    return n > 0 ? `in ${n} days` : `${-n} days ago`;
  };

  const ICONS = {
    edit: '<path d="M16 3l5 5-12 12-6 1 1-6z"/><path d="M14 5l5 5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    layers: '<path d="M12 3L2 8l10 5 10-5-10-5zM2 12l10 5 10-5M2 16l10 5 10-5"/>',

    settings: '<circle cx="12" cy="12" r="3"/><path d="M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z"/>',
    team: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M16 8a5 5 0 0 1 0 8"/><path d="M19 5a9 9 0 0 1 0 14"/>',
    box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><polyline points="3 8 12 13 21 8"/><line x1="12" y1="13" x2="12" y2="21"/>',
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    board: '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="3" height="9"/><rect x="14" y="7" width="3" height="5"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
    bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    chevL: '<polyline points="15 18 9 12 15 6"/>',
    chevR: '<polyline points="9 18 15 12 9 6"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    dollar: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    insta: '<rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>',
    printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>'
  };
  const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  const stars = n => [1, 2, 3, 4, 5].map(i => `<span class="star ${i <= n ? 'on' : ''}">★</span>`).join('');

  function toast(msg, type = 'ok') {
    let box = document.getElementById('toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = `toast ${type}`; t.textContent = msg;
    box.appendChild(t);
    while (box.children.length > 2) box.firstChild.remove();
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3700);
  }

  function formToObj(form) {
    const o = {};
    for (const el of form.elements) {
      if (!el.name || el.disabled) continue;
      if (el.type === 'checkbox') {
        if (el.name.endsWith('[]')) { const k = el.name.slice(0, -2); o[k] = o[k] || []; if (el.checked) o[k].push(el.value); }
        else o[el.name] = el.checked;
      } else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; else if (!(el.name in o)) o[el.name] = ''; }
      else if (el.type === 'file') o[el.name] = el.files;
      else o[el.name] = typeof el.value === 'string' ? el.value.trim() : el.value;
    }
    return o;
  }

  function modal({ title, body, submitLabel = 'Save', cancelLabel = 'Cancel', onSubmit, onOpen, wide = false, hideSubmit = false, danger = false }) {
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-wrap';
      wrap.innerHTML = `<form class="modal ${wide ? 'wide' : ''}">
        <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></header>
        <div class="modal-body">${body}</div>
        <footer><button type="button" class="btn ghost" data-close>${esc(cancelLabel)}</button>
        ${hideSubmit ? '' : `<button class="btn ${danger ? 'danger' : 'primary'}" type="submit">${esc(submitLabel)}</button>`}</footer>
      </form>`;
      document.body.appendChild(wrap);
      document.body.classList.add('modal-open');
      const form = wrap.querySelector('form');
      const onKey = e => { if (e.key === 'Escape' && Array.from(document.querySelectorAll('.modal-wrap')).at(-1) === wrap) { e.stopImmediatePropagation(); close(null); }; };
      function close(v) { wrap.remove(); if (!document.querySelector('.modal-wrap')) document.body.classList.remove('modal-open'); document.removeEventListener('keydown', onKey); resolve(v); }
      document.addEventListener('keydown', onKey);
      wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(null); });
      wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(null); });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const btn = form.querySelector('[type=submit]');
        if (btn) btn.disabled = true;
        try {
          const r = onSubmit ? await onSubmit(formToObj(form), form) : true;
          if (r === false) { if (btn) btn.disabled = false; return; }
          close(r === undefined ? true : r);
        } catch (err) { console.error(err); toast(err.message || String(err), 'error'); if (btn) btn.disabled = false; }
      });
      if (onOpen) onOpen(form, close);
      const first = form.querySelector('.modal-body input:not([type=hidden]), .modal-body select, .modal-body textarea');
      // Do not summon the mobile keyboard when a modal opens. Editing requires a deliberate tap.
      const closeButton = form.querySelector('.modal-close, [data-close], button[type="button"]');
      if (closeButton) setTimeout(() => closeButton.focus({preventScroll:true}), 30);
    });
  }

  const confirmBox = (text, okLabel = 'Yes, continue', danger = false) =>
    modal({ title: 'Please confirm', body: `<p>${esc(text)}</p>`, submitLabel: okLabel, danger, onSubmit: () => true });

  /** Resize an image file in the browser so photos stay small in the database. */
  function resizeImage(file, max = 1600, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Could not read that image'));
        img.onload = () => {
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    }
  }

  function download(filename, text, type = 'application/json') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  window.UI = { esc, money, ymd, today, parseYmd, addDays, fmtDate, fmtShort, fmtTime, fmtDateTime, daysUntil, relDays,
    toLocalInput, icon, stars, toast, formToObj, modal, confirmBox, resizeImage, copyText, download, pad };
})();
