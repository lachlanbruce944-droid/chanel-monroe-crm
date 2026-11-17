# Settings → Connectors

Google Calendar connects through the studio’s Cal.com account. Cal.com keeps the Google OAuth credentials. Stripe collects CRM invoices directly through the deployed `crm-stripe` service, using a server-only `STRIPE_SECRET_KEY`. Cal.com phone consultations collect no payments. No secret key belongs in the CRM page or browser storage.

## Activate

1. Sign into Cal.com as `chanelmonroe`. Connect Google Calendar under Settings → Calendars. Do not install Stripe in Cal.com for this workflow.
2. Create a Cal API key with access to the current user, calendars/events, apps and Stripe connection status. Save it as `CAL_API_KEY` in Supabase Edge Function secrets for project `qxiugfatpybldluipcyy`. Never put it in the website, CRM configuration, GitHub, chat or browser storage.
3. Apply `supabase/migrations/20261117_connector_calendar_lock.sql` and deploy `supabase/functions/crm-connectors/index.ts`. The endpoint validates the caller’s Supabase user and staff role itself; no anonymous status or calendar access.
4. In CRM Settings, choose Check connections. Only successful provider responses show Connected. Google is authorised through Cal.com; The Stripe card opens direct invoice setup and says Verified per invoice: the scheduling service’s legacy Cal.com Stripe result is not proof of CRM invoice readiness.
5. Choose a writable Google calendar that Cal.com checks for conflicts. On the Enquiry phone-call event, select that same calendar for conflict checks (including any event-specific override). Confirm this in CRM Settings and enable checks before Booked. Calendar sharing/selection still requires the account owner’s authorization.
6. Set exact Brisbane start and finish times on each booked job and sync existing jobs. Unsynced/missing time blocks are counted in Settings. The CRM does not estimate job duration or start times.

## Conflict behaviour

A makeup job is published as a busy Google Calendar event with a generic title and an opaque CRM booking reference. No client name, email, notes or guest invitations are sent. Buffers before/after are included. Selected Google calendars are checked before writing; detected overlaps stop the write. The CRM serialises writes using a short database lease. Repeat sync updates the existing owned event and recovers an event by its reference after an interrupted save. Foreign events are never overwritten.

With protection enabled, entering Booked requires a successful block sync. Editing a calendar time block runs another conflict check. Marking a job Lost or deleting it removes its own calendar block first; no cancellation email is sent. Moving back a workflow stage leaves the block in place until staff explicitly remove it. Changes to ordinary event-detail fields do not infer a new calendar range: staff must update the explicit time block too. When protection is enabled, an event-date move is refused until the calendar block has been moved to that date.

Cal.com uses the shared calendar to stop offering overlapping phone slots. Google/Cal synchronization is eventually consistent; simultaneous external bookings can still race during provider propagation. This does not reschedule or cancel existing conflicts automatically. External calendar outages fail the sync rather than claiming availability. Calendar block writes require `CAL_API_KEY` and account authorization; publishing code alone does not connect the providers.

## Rollback

Disable calendar checks in Settings to restore the existing stage flow. Existing Google events remain until explicitly removed. Removing the script/route is unnecessary. Keep Cal.com’s external booking link as the website fallback.

## Verification

Run `node --test tests/*.test.cjs`. Tests cover authenticated access, owner-only endpoint configuration, no returned credentials, overlap rejection, idempotent updates, event ownership and Brisbane time conversion. No live appointment, payment or Google event is created by these tests.

## Direct Stripe invoices

Save the studio’s Stripe secret API key as `STRIPE_SECRET_KEY` in Supabase Edge Function secrets. Open a CRM deposit or final invoice, choose Create Stripe payment link, and share the resulting hosted invoice URL. After payment, choose Refresh payment status to verify it through Stripe and record it in the CRM. Creating a link does not email a client or charge a card. Automatic payment webhook processing has not been verified.

## Verified 18 November 2026 (Brisbane)

- The live project lists `application`, `consultation-approve`, `consultation-sync`, `crm-connectors`, `crm-stripe`, `enquiry-email` and `send-enquiry-confirmation`. Deployment presence alone does not establish working account activation.
- Live connector status reports Cal.com unconfigured. Cal.com’s Calendars page shows no calendar apps.
- Supabase’s custom secret list contains `RESEND_API_KEY`, with no `CAL_API_KEY` or `STRIPE_SECRET_KEY`. A non-mutating `crm-stripe` status request returns the explicit missing `STRIPE_SECRET_KEY` setup error.
- CRM: 20 automated checks pass. Website: 15 automated checks pass. No real appointment, invoice, charge or client message was created in this review.
- Account activation, calendar selection/conflict checks and a controlled end-to-end test remain outstanding. The deployed approval and invoice service sources are absent from the repositories and still need recovery into version control; do not overwrite them with the dashboard editor’s template.
