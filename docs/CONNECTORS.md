# Calendar and payment connectors

CRM is authoritative for its appointment and consultation times. Google Calendar is connected to makeup@chanelmonroe.net through the installed Apps Script in js/google-calendar-sync.gs.

Saving adjustments in CRM persists them to Supabase. The script reads current records every five minutes and updates the matching Google event using its stable booking key, without sending invitations or emails. Cancelled/archived jobs remove exported upcoming events. Phone consults last 30 minutes; approved consults have a one-hour popup reminder. Google events created outside CRM import as busy intervals without their private descriptions.

Settings → Google Calendar shows the last successful sync and flags delays after 15 minutes. An already paired connection does not need another pairing key. If delayed, inspect Apps Script executions under makeup@chanelmonroe.net and rerun installCrmCalendarSync to restore its five-minute trigger. Rotate the pairing key only when needed, since doing so invalidates the old one.

Apple Calendar remains optional, with APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_CALDAV_URL stored on the server. Stripe payments remain separate. Calendar changes do not charge clients.
