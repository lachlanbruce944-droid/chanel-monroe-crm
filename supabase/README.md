# Supabase database and functions

Project: `qxiugfatpybldluipcyy` (makeup-website), shared by the website and CRM.
Never deploy this CRM to the EDGE roadmap project.

## Join team and affiliate applications

Website `apply.html?type=team` or `?type=affiliate` → public `application` edge function → `public.crm_people` → CRM Employees → Applications.

1. On an existing CRM database, apply `migrations/20261117_join_team.sql`. It relies on the existing `public.is_crm_staff()` function. It is repeatable and preserves existing applications.
2. Link the Supabase CLI to the project above.
3. Configure server secrets `RESEND_API_KEY`, `FROM_EMAIL` (verified sender), and `BUSINESS_EMAIL`. Supabase supplies its URL and service-role key to functions; never put the service-role key in browser code or git.
4. Deploy `supabase functions deploy application --no-verify-jwt`. Config also records this public endpoint. Do not deploy unfinished `crm-connectors` yet.
5. Verify with a clearly labelled test application in each form, check Employees → Applications, and verify the business and applicant emails. These tests send real emails; use addresses you control.

The function validates and bounds fields, ignores honeypot bots, and uses a UUID for insert deduplication. It stores the application before sending notifications. Database failure returns a retryable error; email failure keeps the saved application and returns `emailSent:false`. Automatic email retries/outbox and rate limiting remain follow-up work. No anonymous direct access to applicant records is granted.

`crm_schema.sql` is a reference for an existing installation, not a complete blank-project bootstrap. `crm_people.sql` is the previous combined people/selfie migration. Apply only the focused join-team migration for this feature. Connector migration/function files are unfinished work and are not part of this rollout.

## Source ownership

The application function is now maintained in this CRM repository. The website has an older copy; reconcile it when deploying to avoid overwriting the newer function. The website endpoint URL already targets the shared project.
