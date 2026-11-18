/* ==========================================================================
   Chanel Monroe CRM — data layer (Supabase)
   --------------------------------------------------------------------------
   Every store maps to a crm_* table in Supabase (see supabase/schema.sql).
   Records are cached in memory for instant screens; every save/remove is
   written straight through to the database. Field names are camelCase in the
   app and snake_case in Postgres; any field without its own column is kept
   in the row's `extra` jsonb so nothing is ever lost.
   The rest of the app only calls:
     DB.list / DB.get / DB.find / DB.save / DB.remove / DB.putBlob / DB.getBlob
   ========================================================================== */
(function () {
  const cfg = window.CRM_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const BASE = ['id', 'createdAt', 'updatedAt'];
  const SCHEMA = {
    settings:  { table: 'crm_settings',  cols: ['value'], noExtra: true },
    services:  { table: 'crm_services',  cols: ['name', 'category', 'price', 'durationMins', 'active', 'sort'] },
    clients:   { table: 'crm_clients',   cols: ['firstName', 'lastName', 'email', 'phone', 'instagram', 'birthday', 'skinType', 'allergies', 'shades', 'notes', 'marketingOk', 'source'] },
    bookings:  { table: 'crm_bookings',  cols: ['clientId', 'stage', 'status', 'lostReason', 'source', 'websiteEnquiryId', 'eventType', 'eventDate', 'readyBy', 'startTime', 'location', 'partySize', 'lines', 'travelFee', 'discount', 'depositAmount', 'answers', 'callAt', 'callNotes', 'callLoggedAt', 'stageChangedAt'],
                 time: ['readyBy', 'startTime'], ts: ['callAt', 'callLoggedAt', 'stageChangedAt'] },
    payments:  { table: 'crm_payments',  cols: ['bookingId', 'clientId', 'type', 'amount', 'method', 'paidAt', 'reference'] },
    invoices:  { table: 'crm_invoices',  cols: ['bookingId', 'clientId', 'type', 'number', 'items', 'total', 'gst', 'status', 'issuedAt', 'dueAt', 'paidAt'] },
    reminders: { table: 'crm_reminders', cols: ['bookingId', 'clientId', 'kind', 'title', 'dueAt', 'templateKey', 'channel', 'status', 'closedAt'], ts: ['dueAt', 'closedAt'] },
    photos:    { table: 'crm_photos',    cols: ['bookingId', 'clientId', 'kind', 'caption', 'fileName', 'takenAt', 'storagePath'] },
    reviews:   { table: 'crm_reviews',   cols: ['bookingId', 'clientId', 'rating', 'text', 'source', 'consentToShare', 'receivedAt'] },
    activity:  { table: 'crm_activity',  cols: ['bookingId', 'clientId', 'userId', 'type', 'text', 'at'], ts: ['at'] },
    /* Employees: team members and affiliates, incl. website applications (status 'applied'). Optional: the CRM
       still loads if supabase/crm_people.sql has not been run yet (DB.missing.people is then true). */
    people:    { table: 'crm_people',    cols: ['kind', 'status', 'firstName', 'lastName', 'businessName', 'role', 'email', 'phone', 'instagram', 'website', 'areas',
                 'experience', 'availability', 'notes', 'photoUrl', 'showOnSite', 'source', 'application'], optional: true }
  };
  const STORES = Object.keys(SCHEMA);
  const cache = {}; STORES.forEach(s => (cache[s] = new Map()));

  const snake = k => k.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
  const camel = k => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  const nowIso = () => new Date().toISOString();

  function toRow(store, obj) {
    const s = SCHEMA[store]; const cols = new Set([...BASE, ...s.cols]);
    const row = {}; const extra = {};
    for (const [k, v] of Object.entries(obj)) {
      if (cols.has(k)) row[snake(k)] = (v === '' || v === undefined) ? null : v;
      else if (!s.noExtra && v !== undefined) extra[k] = v;
    }
    if (!s.noExtra) row.extra = extra;
    return row;
  }
  function fromRow(store, row) {
    const s = SCHEMA[store]; const obj = {};
    for (const [k, v] of Object.entries(row)) {
      if (k === 'extra') continue;
      const ck = camel(k);
      let val = v;
      if (val !== null && s.time && s.time.includes(ck)) val = String(val).slice(0, 5);
      if (val !== null && (ck === 'createdAt' || ck === 'updatedAt' || (s.ts && s.ts.includes(ck)))) val = new Date(val).toISOString();
      obj[ck] = val;
    }
    return { ...(row.extra || {}), ...obj };
  }
  const fail = (error, what) => { if (error) throw new Error(`${what}: ${error.message}`); };

  async function fetchAll(store) {
    const out = []; const size = 1000;
    for (let from = 0; ; from += size) {
      const { data, error } = await sb.from(SCHEMA[store].table).select('*').range(from, from + size - 1);
      fail(error, `Loading ${store}`);
      out.push(...data);
      if (data.length < size) break;
    }
    return out.map(r => fromRow(store, r));
  }

  let signature = '';
  const sig = () => STORES.map(s => s + cache[s].size + ':' + [...cache[s].values()].reduce((m, r) => (r.updatedAt > m ? r.updatedAt : m), '')).join('|');

  const DB = {
    uid, nowIso, STORES, client: sb,

    missing: {},
    async init() {
      const results = await Promise.all(STORES.map(st => fetchAll(st).catch(err => {
        if (!SCHEMA[st].optional) throw err;
        DB.missing[st] = true; console.warn(err.message); return [];
      })));
      STORES.forEach((s, i) => { cache[s] = new Map(results[i].map(r => [r.id, r])); });
      signature = sig();
    },
    /** Re-read everything; returns true if anything changed (e.g. a new website enquiry). */
    async refresh() { const before = signature; await DB.init(); return before !== signature; },

    list(store, filter) { const arr = [...cache[store].values()]; return filter ? arr.filter(filter) : arr; },
    get(store, id) { return (id && cache[store].get(id)) || null; },
    find(store, fn) { for (const v of cache[store].values()) if (fn(v)) return v; return null; },

    async save(store, obj) {
      const rec = { ...obj };
      if (!rec.id) rec.id = uid();
      if (!rec.createdAt) rec.createdAt = nowIso();
      rec.updatedAt = nowIso();
      const { error } = await sb.from(SCHEMA[store].table).upsert(toRow(store, rec));
      fail(error, `Saving ${store}`);
      cache[store].set(rec.id, rec);
      signature = sig();
      return rec;
    },
    async remove(store, id) {
      const { error } = await sb.from(SCHEMA[store].table).delete().eq('id', id);
      fail(error, `Deleting from ${store}`);
      cache[store].delete(id);
      signature = sig();
    },

    /* photos live in the private crm-photos bucket as <photo id>.jpg */
    async putBlob(id, dataUrl) {
      const blob = await (await fetch(dataUrl)).blob();
      const { error } = await sb.storage.from(cfg.photoBucket).upload(`${id}.jpg`, blob, { upsert: true, contentType: blob.type || 'image/jpeg' });
      fail(error, 'Uploading photo');
    },
    async getBlob(id) {
      const { data, error } = await sb.storage.from(cfg.photoBucket).createSignedUrl(cache.photos.get(id)?.storagePath || `${id}.jpg`, 60 * 60);
      return error ? null : data.signedUrl;
    },
    async removeBlob(id) { await sb.storage.from(cfg.photoBucket).remove([cache.photos.get(id)?.storagePath || `${id}.jpg`]); },

    setting(key, fallback) { const r = cache.settings.get(key); return r ? r.value : fallback; },
    async setSetting(key, value) { return DB.save('settings', { id: key, value }); },

    async exportAll() {
      const out = { app: 'chanel-monroe-crm', version: 2, exportedAt: nowIso(), note: 'Photos stay in Supabase storage; this file holds all records.', data: {} };
      for (const s of STORES) out.data[s] = DB.list(s);
      return out;
    },
    /** Restore a backup (also accepts backups from the old offline trial version, including its photos). */
    async importAll(json) {
      if (!json || json.app !== 'chanel-monroe-crm') throw new Error('That file is not a Chanel Monroe CRM backup.');
      for (const s of STORES) {
        const rows = (json.data[s] || []).map(r => toRow(s, r));
        for (let i = 0; i < rows.length; i += 200) {
          const { error } = await sb.from(SCHEMA[s].table).upsert(rows.slice(i, i + 200));
          fail(error, `Importing ${s}`);
        }
      }
      for (const b of (json.data.photoBlobs || [])) if (b.dataUrl) await DB.putBlob(b.id, b.dataUrl);
      await DB.init();
    }
  };

  window.DB = DB;
})();
