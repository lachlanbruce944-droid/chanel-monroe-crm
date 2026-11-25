// Install this standalone Apps Script while signed in as makeup@chanelmonroe.net.
// Add the Google Calendar API under Services, then run installCrmCalendarSync.
const CRM_CALENDAR = 'makeup@chanelmonroe.net';
const CRM_API = 'https://qxiugfatpybldluipcyy.supabase.co/rest/v1/rpc/crm_google_calendar_sync';
const CRM_PUBLIC_KEY = 'sb_publishable_sGLIpIxvos66FLVI9vPSbg_qXsTT6rt';
const CRM_SYNC_TAG = 'chanel-monroe-crm-v1';

function installCrmCalendarSync() {
  syncCrmCalendar();
  if (!ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === 'syncCrmCalendar')) {
    ScriptApp.newTrigger('syncCrmCalendar').timeBased().everyMinutes(5).create();
  }
}

function syncCrmCalendar() {
  if (Session.getEffectiveUser().getEmail().toLowerCase() !== CRM_CALENDAR) {
    throw new Error('Run this script as ' + CRM_CALENDAR);
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const token = PropertiesService.getScriptProperties().getProperty('CRM_PAIRING_KEY');
    if (!token) throw new Error('Add CRM_PAIRING_KEY in Apps Script Project Settings.');
    const {events} = crmCalendarRequest({p_token: token});
    const now = new Date();
    const end = new Date(now.getTime() + 431 * 86400000);
    const upcoming = readCrmCalendar({
      timeMin: now.toISOString(), timeMax: end.toISOString(), singleEvents: true
    });
    const owned = readCrmCalendar({privateExtendedProperty: 'crm_source=' + CRM_SYNC_TAG})
      .filter(event => Date.parse(calendarBoundary(event.end)) > now.getTime());
    reconcileCrmEvents(events, owned);
    const busy = upcoming.filter(event => event.status !== 'cancelled'
      && event.transparency !== 'transparent' && !isCrmEvent(event)).map(event => ({
      start_at: calendarBoundary(event.start), end_at: calendarBoundary(event.end),
      all_day: Boolean(event.start.date)
    }));
    crmCalendarRequest({p_token: token, p_busy: busy});
  } finally {
    lock.releaseLock();
  }
}

function crmCalendarRequest(body) {
  const response = UrlFetchApp.fetch(CRM_API, {
    method: 'post', contentType: 'application/json', headers: {apikey: CRM_PUBLIC_KEY},
    payload: JSON.stringify(body), muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('CRM calendar request failed (' + response.getResponseCode() + '). Check the pairing key.');
  }
  return JSON.parse(response.getContentText());
}

function readCrmCalendar(options) {
  const events = [];
  let pageToken;
  do {
    const page = Calendar.Events.list(CRM_CALENDAR, {...options, pageToken, maxResults: 2500});
    events.push(...(page.items || []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return events;
}

function isCrmEvent(event) {
  return event.extendedProperties?.private?.crm_source === CRM_SYNC_TAG;
}

function calendarBoundary(boundary) {
  return boundary.dateTime || boundary.date + 'T00:00:00+10:00';
}

function reconcileCrmEvents(desired, owned) {
  const byKey = new Map();
  const stale = new Set(owned.map(event => event.id));
  for (const event of owned) byKey.set(event.extendedProperties.private.crm_key, event);
  for (const event of desired) {
    const current = byKey.get(event.key);
    const start = event.all_day ? {date: event.all_day} : {dateTime: event.start_at};
    const end = event.all_day ? {date: calendarBoundaryDate(event.end_at)} : {dateTime: event.end_at};
    const reminder = event.key.endsWith(':phone') && event.title.endsWith('approved');
    const body = {
      summary: event.title, start, end, visibility: 'private', transparency: 'opaque',
      reminders: {useDefault: false, overrides: reminder ? [{method: 'popup', minutes: 60}] : []},
      extendedProperties: {private: {crm_source: CRM_SYNC_TAG, crm_key: event.key}}
    };
    if (!current) {
      Calendar.Events.insert(body, CRM_CALENDAR, {sendUpdates: 'none'});
      continue;
    }
    stale.delete(current.id);
    const reminders = current.reminders?.overrides || [];
    const sameReminder = current.reminders?.useDefault === false
      && (reminder ? reminders.length === 1 && reminders[0].minutes === 60
        && reminders[0].method === 'popup' : reminders.length === 0);
    if (current.summary !== body.summary || !sameBoundary(current.start, start)
      || !sameBoundary(current.end, end) || current.visibility !== 'private'
      || current.transparency === 'transparent' || !sameReminder) {
      Calendar.Events.patch(body, CRM_CALENDAR, current.id, {sendUpdates: 'none'});
    }
  }
  for (const id of stale) Calendar.Events.remove(CRM_CALENDAR, id, {sendUpdates: 'none'});
}

function sameBoundary(a, b) {
  if (a.date || b.date) return a.date === b.date;
  return Date.parse(a.dateTime) === Date.parse(b.dateTime);
}

function calendarBoundaryDate(dateTime) {
  return Utilities.formatDate(new Date(dateTime), 'Australia/Brisbane', 'yyyy-MM-dd');
}
