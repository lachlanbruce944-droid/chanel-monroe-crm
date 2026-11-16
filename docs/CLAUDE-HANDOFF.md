# Handoff — 17 November 2026

## Prepared changes

- CRM Employees page now links directly to both public application forms and explains approval/publication.
- Supabase folder contains the application edge function, focused repeatable people migration, configuration, and setup notes.
- Application function now requires a successful database save before success; sanitised answers are stored. Email failure no longer reports a saved application as lost. Response includes `emailSent`.
- App script/style cache versions bumped. JavaScript syntax check passed.

## Deployment status

Supabase setup guide, application function, configuration and focused migration were published to GitHub main through Chrome. CRM UI links/cache changes are committed locally only (acfbbf6 on feat/integration-settings); not pushed. These changes are not verified live. Deploy migration/function and verify notification delivery before marking complete. Existing website form-to-CRM connection was already present; this work improves reliability and documents it.

## Pending user requests

Settings/connectors (Google Calendar, SMS, Stripe, MYOB), cancellation flow, clearer Enquiries, ten isolated demo bookings, Google review request emails, website affiliate popup fit, and uniform mobile gallery rows remain pending. `js/integrations.js`, `crm-connectors`, and their migration are unfinished drafts, not production ready; do not deploy them. No provider credentials were configured and no customer messages sent.

## Recommended next improvements

1. Persist email delivery jobs in a private outbox with retry and delivery status.
2. Add server-side rate limiting/Turnstile to public application forms.
3. Require owner role for application deletion and publishing team profiles.
4. Record application status changes in an audit log; prefer archive over permanent delete.
5. Use the Google Business Profile review URL in email templates after completed bookings, with sent-at tracking to prevent duplicate requests.
