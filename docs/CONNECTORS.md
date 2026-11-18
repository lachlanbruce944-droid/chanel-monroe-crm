# Calendar and payment connectors

The CRM schedules phone consultations. Chanel approves the requested time; the client receives a confirmation email and does not confirm again. Cal.com and Google Calendar are retired from the active flow.

Settings offers Apple Calendar and Stripe. Apple Calendar uses server-only iCloud CalDAV credentials: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_CALDAV_URL. Stripe invoice payments remain separate; retain STRIPE_SECRET_KEY on the server.

See [CRM consultations](CRM-CONSULTATIONS.md) for deployment order, calendar conflicts, email retry, account setup and verification limits. Source preparation does not connect iCloud or deploy backend functions.
