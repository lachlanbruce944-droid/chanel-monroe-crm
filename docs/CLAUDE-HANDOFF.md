# Claude handoff — 17 November 2026

## Connections and Enquiries changes

- User-facing Employees renamed Connections; Team renamed Associates. Internal employees/team routes and database kinds preserved for compatibility.
- Connections photo cards: editable name/business, role, email, mobile, Instagram, website, photo, service areas, notes, availability, time zone and scheduling provider/public booking URL. Add, approve, archive, restore, delete and website visibility controls retained.
- Relationship status (Not contacted / Contacted / Connected) is manually confirmed. It does not indicate an OAuth/calendar integration; scheduling explicitly shows Not linked.
- 125 public website affiliates are packaged in js/connections-data.js with stable IDs, avatar URLs, bios, 9 published emails and 7 published phones. Staff use Import website affiliates to save them into crm_people; existing Instagram matches are skipped and retries preserve prior imports. No messages sent. Contacts were extracted from public bios, so staff should verify them.
- Existing crm_people columns hold contact/availability; additional scheduling/relationship fields persist in extra JSONB through DB.save. No extra schema migration needed for these profile fields.
- Enquiries defaults to a mobile-friendly list with event date, stage, next task, amount and balance. Active/New/Awaiting deposit/Booked/Completed/Lost filters and board toggle. Search matches client, email, phone, service and location.
- Connections is accessible from the mobile bottom bar. Clients remains in desktop navigation and client links on bookings.
- index.html cache version updated and public directory data script loaded before app.js.

## Website changes

Mobile affiliate popup has compact profile and bounded equal-height photo rows, safe-area spacing, visible close control and scroll fallback for long text. Website About/application buttons now say Become an associate, with Associates heading. Source and built files published together. Function and database kinds still use team.

## Verification and deployment

Run node --test tests/connections.test.cjs and node --check js/app.js. No production records were created during code verification. Import requires a signed-in CRM staff account and writes only when Import profiles is confirmed. Live end-to-end staff verification remains necessary.

Application backend/configuration and focused migration are in supabase/. See supabase/README.md for deployment; function update is not yet deployed. Website retains an older function source copy; reconcile before redeployment.

## Pending work

Google Calendar, SMS, Stripe, MYOB connectors; cancellation flow; ten isolated demo bookings; Google review request emails; actual associate calendar integrations and structured availability/conflict checks. js/integrations.js and crm-connectors are unfinished local drafts and must not be deployed. Add an email outbox/retries and rate limits to public forms; consider owner-only deletion/publishing and audit history.
