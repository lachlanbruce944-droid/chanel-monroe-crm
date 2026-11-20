# Microsoft 365 client replies — GoDaddy
Prepared 21 November 2026. The connector is disabled by default. No mailbox password is collected.

## What is ready
Settings → Microsoft 365 email offers setup, test, enable/pause, sync and a review inbox.
Each booking has a Client messages section. New email adds a timeline entry and review reminder.
Read-only Microsoft Graph Inbox delta sync imports only messages addressed to makeup@chanelmonroe.net from existing CRM client email addresses. A single open enquiry can match by sender; a CRM reference or previously linked conversation is preferred. Ambiguous matches wait in Settings for owner review. Unknown senders and messages sent elsewhere are skipped. Alias recipients and mail moved by Inbox rules before sync need a future folder/alias extension.
Content is escaped plain text. Microsoft uniqueBody is preferred to avoid quoting the whole thread. No AI extraction is used. Original approved dates, services, prices, consultation notes and invoices are never overwritten.
Attachment names/types/sizes are recorded. View in Outlook opens the original authenticated message, where files remain. Attachment binaries are not copied into the CRM.

## Server deployment
Apply supabase/migrations/20261120175249_microsoft_365_email.sql and deploy crm-email with verify_jwt=false: this function verifies a real Supabase user plus owner membership itself, or the server-only scheduling key. Never deploy this code with those checks removed.
The UI reads messages through staff-only RLS; connector credentials and cursors have no browser table access.
The initial deployment and migration may already be applied; check project migrations/function status before reapplying.

## Microsoft / GoDaddy account setup
1. Sign in to the actual Microsoft tenant administrator for the GoDaddy Microsoft 365 mailbox. If Entra app registration or Exchange admin is restricted, ask GoDaddy support to enable the necessary administrative access. Do not replace MX records, migrate tenants or change existing mail delivery.
2. Register a single-tenant Entra application. Copy the Directory (tenant) ID and Application (client) ID.
3. Scope read permission to the business mailbox with Exchange Online Application RBAC, using Application Mail.Read. Follow the official instructions and test this service principal against both the allowed mailbox and an unrelated mailbox. Do not also grant an unscoped Entra Mail.Read application permission: these permission models are additive.
4. Create a client secret with an expiry/rotation plan. Save its VALUE, not the secret ID, as M365_CLIENT_SECRET in Supabase Edge Function secrets. Never save it in browser settings, GitHub or a client profile.
5. Open CRM Settings → Microsoft 365 email → Set up email. Enter tenant/application IDs and an import start date. Saving keeps imports paused and resets the cursor. Existing imported message IDs prevent duplicates.
6. Test connection. Verify the mailbox-scoped access separately in Exchange. Enable import, then Sync now.
7. To import while CRM is closed, generate a random M365_SYNC_KEY server secret, store the same value in Supabase Vault as crm_m365_sync_key, enable pg_cron/pg_net/Vault, and run supabase/microsoft_365_email_schedule.sql. The schedule is intentionally not installed during preparation.
8. Check last sync and errors. Every five minutes the scheduler imports up to three pages; additional pages resume next run. Overlapping runs have a 90-second lease. If a page fails the cursor is not advanced, and committed messages deduplicate on retry.
9. Use Pause import to stop future import runs. A run already in progress may finish. Disable/remove the cron job and revoke the Microsoft service principal or client secret to disconnect fully.

## Matching and review
A subject reference [CRM:booking-uuid] or [CRM:website-enquiry-uuid] can disambiguate clients with several bookings. No outbound mail templates are changed by this preparation.
Without a reference, use an already linked conversation, then exactly one open enquiry for the sender. An email address is a routing hint, not identity verification; Chanel reviews requests before acting.
Settings → Review client messages lets the owner link an ambiguous message to an enquiry and mark it reviewed. This closes the associated review reminder. It does not apply requested booking changes.
Messages that don't match a known client are not imported and remain in Outlook. Marking a message reviewed does not send an email.

## Verification and limits
Code syntax and deterministic helper checks are possible without a mailbox. Actual sign-in, Graph permissions, attachment access, scheduled execution and end-to-end email arrival must be tested after setup.
Use a controlled test client: one open enquiry, two open enquiries (manual link), a duplicate message, HTML-like text, an attachment, and a requested date/price change. Confirm new messages and reminders appear while booking fields stay unchanged.
A delta cursor expired by Microsoft requires resaving the import date and re-enabling. Saved messages remain. This connector only imports; Outlook continues to receive/send mail normally. Backend changes do not claim that Microsoft is connected.

## Official references
- https://learn.microsoft.com/en-us/graph/auth-v2-service
- https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac
- https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0
- https://learn.microsoft.com/en-us/graph/api/message-get?view=graph-rest-1.0
- https://learn.microsoft.com/en-us/graph/api/message-list-attachments?view=graph-rest-1.0
