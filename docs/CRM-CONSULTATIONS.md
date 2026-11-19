# Publication check — 19 November 2026

GitHub and Supabase connections verified. Consultation migration applied; consultation-manage v2 and Apple crm-connectors v2 are active. Retired consultation-sync v3 is active. Database verification confirms anonymous approval is denied and approval moves enquiries to Phone call.

The enquiry-email function update was blocked by automatic approval review because its existing email payload includes private client selfies and enquiry details sent to Resend and the business inbox. It requires explicit user approval before deployment; its old production version remains. Initial acknowledgement may therefore still contain the previous booking copy and omit the requested consultation time.

All 29 CRM and 10 website checks passed in the implementation session. Apple iCloud credentials and real signed-in scheduling/email tests remain outstanding. No real appointment or client email was created in this rollout.

# CRM-owned phone consultations — 18 November 2026

Deployment status as of 18 November 2026:
- Consultation SQL migration applied successfully to production through the Supabase SQL Editor in a transaction.
- Initial consultation-manage function deployed and configured for its own bearer-token/owner validation. The later Apple integration changes to that function are pending redeployment.
- Apple crm-connectors service, updated enquiry-email, retired consultation-sync, and both frontend updates remain unpublished. The old crm-connectors deployment is still present; the new consultation service must not be used until the matching Apple connector service is deployed.
- Browser access was blocked by app configuration during deployment. No GitHub publishing completed. The local changes have been rebased onto CRM origin/main 21291eb.
- Apple Calendar replaces Google Calendar in Settings. Stripe invoice integration remains separate.

The client requests a preferred 15-minute call in Brisbane time. Their enquiry acknowledgement includes the requested time, explicitly pending Chanel’s approval. No client acceptance step exists. Chanel reviews the enquiry, schedules or adjusts the call in Calendar → Schedule phone call, then approves it. Approval queues a confirmed consultation email. A saved appointment and email delivery have separate states; use Retry consultation email after delivery errors. A confirmed call does not confirm the makeup booking.

Both pending and approved calls reserve CRM calendar time. Conflicts are checked against other phone calls and booked makeup time blocks. A booked makeup day without an exact block protects the whole date. Calls must finish before makeup starts, normally at least 72 hours before. Chanel must record an exception reason for shorter notice. The call must be completed and notes saved before the makeup booking is confirmed. Only the CRM owner may schedule/approve; the service checks identity and role, and the database RPC checks the owner again.

## Deployment order

Both repositories use Supabase project qxiugfatpybldluipcyy.

1. Apply `supabase/migrations/20261118_crm_consultations.sql` from the CRM repository in Supabase. This adds the enquiry field, request-import trigger, email outbox and scheduling/booking guards. Existing schema tables must already exist. Do not publish the new form before adding its database column.
2. Deploy CRM functions `consultation-manage` and `crm-connectors` with JWT gateway verification disabled as declared in `supabase/config.toml`. The new endpoint checks the signed-in bearer token and owner role itself. crm-connectors now provides owner-only Apple iCloud CalDAV status, availability, event sync and removal. Old Cal.com actions are rejected.
3. Deploy website functions `enquiry-email` and `consultation-sync` (the latter now returns 410). Keep their existing public invocation configuration.
4. Retain existing server-side `RESEND_API_KEY`, `FROM_EMAIL`, `BUSINESS_EMAIL`, Supabase URL and service role configuration. Never put these secrets in browser code.
5. Publish CRM files and website `site/` through their existing GitHub Pages workflows. Build the website with `python src/tools/publish.py` before committing.
6. Verify with a controlled enquiry addressed to your own mailbox: pending acknowledgement, CRM calendar entry, Chanel review/approval, confirmed email, email retry, short-notice exception, competing phone/makeup blocks and completion → quote → makeup confirmation. Do not use a real client's details for this check.
7. Disable the old public Cal.com event and revoke the unused CAL_API_KEY in the provider/server settings. Existing Cal.com appointments are not cancelled automatically; review and migrate each existing call in the CRM. Previously exported Google Calendar blocks are not deleted by this change. Google Calendar is replaced by Apple Calendar. Configure APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_CALDAV_URL (the private calendar collection URL ending in /) as server secrets. Apple secrets have not been supplied or configured. Never use a public shared-calendar ICS URL or the primary Apple password.

Email outbox rows are service-only and keyed by booking/version/kind. Resend uses a stable idempotency key for each row. Successful sends are marked, failed sends remain retryable. Rescheduling resets approval and generates a new version. Only the current version is sent on retry; old queued versions are superseded. Existing CRM call reminders remain visible; no new unattended reminder scheduler is installed.

## Verification

27 CRM and 10 website automated tests pass, including owner-only endpoint access, pending/confirmed email content, failed delivery/retry, duplicate-send suppression, Brisbane timezone, calendar conflicts, legacy Cal confirmation rejection, affiliate DM tiles and existing search/navigation/profile behavior. Website build and JavaScript syntax checks pass. Tests use mocked services. The migration completed successfully in production. Apple tests use mocked CalDAV responses; real iCloud sync, production consultation email delivery and updated signed-in UI have not been tested. Apple authorization still requires the owner’s app-specific password.

## Known operational limits

The new consultation guards require CRM approval/completion when confirming or changing a booked makeup date/time. Review historical bookings before rollout. Approval requires an event date; missing dates must be completed first. Chanel is represented by the CRM `owner` role. Email delivery retries are operator-triggered from the enquiry, not an automatic background job.


## Apple Calendar connector

The CRM remains authoritative for consultation approval, quote and makeup confirmation. Settings offers Apple connection setup/check and manual sync of existing appointments. Availability reads the configured iCloud calendar through CalDAV REPORT with recurrence expansion, and rejects conflicts, unreadable events and unexpanded recurring events. Stable event UIDs and conditional PUT prevent duplicate event creation; only CRM-owned events may be updated or removed. Exported Apple events contain a generic booking title and times, not client names, phone numbers or notes.

Approved calls sync to Apple. Rescheduling resets CRM approval and removes the old phone event. Confirmed makeup time blocks sync after confirmation. Changes made directly in Apple Calendar do not rewrite CRM approval or quote data. There is no unattended background sync; use the CRM actions and Sync existing appointments. Other Apple calendars are not checked unless they are the configured calendar. If Apple is unconfigured, CRM scheduling still works and Settings clearly reports not connected. Do not call this a connected integration until the real iCloud connection has been checked.

Apple setup reference: https://support.apple.com/en-au/102654

## Enquiry holds and Apple Calendar

Apply the appointment-holds migration before deploying the updated CRM calendar. Install the updated `crm-connectors` and `consultation-manage` Edge Functions, then apply the Apple worker migration to enable the minute-by-minute queue. Connect the private iCloud calendar from CRM Settings. The worker retries failures and has no public access to its credentials or queue.

Each enquiry with an exact start or ready-by time creates a pending three-hour service hold followed by one hour of buffer in Brisbane time. A ready-by time is treated as the service finish. A date-only enquiry needs a time before it creates a makeup block. The client can request a separate 15-minute consultation even if the time is busy. Review overlaps before approval and propose another time if needed. Cancelling an enquiry clears its holds.

The private Apple Calendar receives tentative and confirmed holds. Existing events in the connected Apple calendar are checked before confirmation. CRM approval, booking status and quotes are managed in the CRM. All services currently use the same default. To introduce per-service recommendations, add a duration resolver and a booking-level duration snapshot to preserve existing holds when recommendations change, then use that duration in the CRM, database range and Apple export.
