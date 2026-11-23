# Chanel Monroe Makeup website and CRM audit

**24 November 2026 (Brisbane) · Review only · Release decision: hold live booking and payment sign-off.**

## Five release priorities

1. **Public launch blocker · DEP-01** — The custom domain serves “Coming Soon” (HTTP 200) and its enquiry route returns HTTP 404. GitHub Pages homepage and enquiry respond successfully.
2. **Booking blocker · CAL-01** — Public availability and staff confirmation need one authoritative reservation check, with a clear expiry for pending holds.
3. **Booking blocker · INT-01** — Carry a durable intake status from the enquiry receipt through client matching, consultation approval and delivery.
4. **Data protection blocker · SEC-01** — Verify staff access and the private photo lifecycle. Minimise the data retained by the enquiry browser.
5. **Payment blocker · PAY-01** — Preserve the approved quote, separate review from creating or sending a payment link, reconcile the exact invoice, and explicitly confirm the booking.

## Evidence and scope

| Surface | What was verified |
| --- | --- |
| [Custom domain](https://chanelmonroe.net/) and [enquiry route](https://chanelmonroe.net/enquire.html) | Production HTTP GET and HTML title only. |
| [Website deployment](https://lachlanbruce944-droid.github.io/chanel-monroe-makeup/) | Production home and enquiry HTTP 200. Home HTML matched [website source f499cfa](https://github.com/lachlanbruce944-droid/chanel-monroe-makeup/tree/f499cfaec5423f8989f196403cfff702f7f4f299). Latest successful Pages deployment inspected separately had matching enquiry assets. |
| [CRM deployment](https://lachlanbruce944-droid.github.io/chanel-monroe-crm/) | Production HTML, app and workflow files matched [CRM source ee71727](https://github.com/lachlanbruce944-droid/chanel-monroe-crm/tree/ee71727366a3a1bed3fc013664c377ed7bb8a766) by SHA-256. |
| Supabase | Production metadata only, PostgreSQL 17.11 in Sydney. Relevant tables, triggers, policies, storage and migration history inspected without reading client records. Edge Function/provider settings and every deployed code version were outside verified scope. |
| Browser and integrations | The originating browser was unavailable. Isolated Chromium launch also failed. No approved hosted staging or usable provider sandbox was established. Responsive, signed-in and provider workflows are still open. |
| Tests | Website 34/34 and CRM 51/51 passed locally with `node --test tests/*.test.cjs`. These are repository tests using local assertions and mocks. |

## Workflow and decisions

| Handoff | Current evidence | Proposed behaviour |
| --- | --- | --- |
| Enquiry → availability → appointment | The picker rechecks CRM availability. Submitting requests a consultation and makeup time. CRM handles confirmation separately, with different validation on different write paths. | Reserve the complete service and buffer atomically. Show whether a time is requested, held until a deadline or confirmed. |
| Enquiry → client → consultation | Database trigger creates or links the client and booking. Chanel approves the requested consultation. Approval can save before email or calendar work succeeds. | Track intake conversion and candidate client match. Show **Consultation approved** with independent email and calendar states. |
| Quote → deposit → booking | Source supports quote and Stripe review. Opening review can advance the stage, and recording a manual deposit can advance booking status. | Save a versioned approval before creating a link. Either paid path moves to **Ready to confirm**. Chanel confirms after checking the calendar. |
| Upload → private storage → staff | Public flow accepts optional photos and a live private bucket exists. The complete staff access and cleanup path remains unverified. | Explain consent, bind uploads to the enquiry, grant short-lived staff reads, and expire abandoned files. |
| Completion → extras → final balance | CRM supports additional costs, final invoice, payment and follow-up. Versioning and provider exceptions need testing. | Itemise approved extras, apply the fixed paid deposit, approve and deliver the final invoice, then reconcile payment or exceptions against it. |

## Prioritised backlog

| ID / priority / reviewer | Evidence and impact | Change and dependencies | Acceptance criterion |
| --- | --- | --- | --- |
| **DEP-01 · P0 · Website** | Production custom-domain GETs above. Clients arriving at the brand URL cannot reach the intended enquiry. | Route the custom domain to the approved build. Requires domain/Pages configuration review. | HTTPS home, galleries and enquiry resolve on the custom domain and canonical URLs agree. |
| **CAL-01 · P1 · Scheduling + database** | [Public calendar SQL](https://github.com/lachlanbruce944-droid/chanel-monroe-crm/blob/ee71727/supabase/migrations/20261120154000_chatbot_reliability.sql#L27) and [CRM checks](https://github.com/lachlanbruce944-droid/chanel-monroe-crm/blob/ee71727/js/connectors.js#L28). Live metadata corroborated that the write paths apply different rules. Abandoned requests can occupy time and competing actions can disagree. | Use a shared reservation transaction and typed timestamp ranges with Australia/Brisbane business rules, an expiry for holds, buffers, and an explicit external-calendar policy. Depends on schema migration and staff/public integration. | Two concurrent claims for the same exclusive slot leave one active reservation. Buffer-only conflicts are handled and expired holds release capacity. |
| **INT-01 · P1 · Enquiry + operations + database** | [Intake materialisation](https://github.com/lachlanbruce944-droid/chanel-monroe-crm/blob/ee71727/supabase/migrations/20261120154000_chatbot_reliability.sql#L118). The consultation-bearing route has a downstream guard, while other intake paths need a durable status. Client matching and failed conversion need staff follow-up. | Add explicit received, linked, needs review and retry states. Use a unique enquiry reference and review ambiguous client matches before changing profiles. | Replaying a committed request creates one enquiry and one CRM booking. An interrupted conversion is visible and recoverable. |
| **SEC-01 · P1 · Security + database + enquiry** | Source review and live metadata identified staff provisioning and private upload checks to close. The enquiry persists submitted contact and sensitivity answers in [browser storage](https://github.com/lachlanbruce944-droid/chanel-monroe-makeup/blob/f499cfa/site/enquire.html#L1485). | Verify least-privilege staff provisioning, private upload access and expiry, minimise the retained receipt, and separate immutable audit history from editable activity. Depends on owner access and migration verification. | Approved staff can open a synthetic attachment through temporary access. The browser retains only the minimum receipt data. Retention and audit checks pass in staging. |
| **PAY-01 · P1 · Billing + operations + database** | [Quote review](https://github.com/lachlanbruce944-droid/chanel-monroe-crm/blob/ee71727/js/app.js#L985), [invoice construction](https://github.com/lachlanbruce944-droid/chanel-monroe-crm/blob/ee71727/js/workflow.js#L319), [manual deposit](https://github.com/lachlanbruce944-droid/chanel-monroe-crm/blob/ee71727/js/workflow.js#L474), and [Stripe function](https://github.com/lachlanbruce944-droid/chanel-monroe-crm/blob/ee71727/supabase/functions/crm-stripe/index.ts#L21). Signatures and invoice retrieval are implemented in source. Approval, delivery and revised/refunded balances need clear state. | Persist reviewed AUD cents, customer, terms, itemised services/extras and fixed deposit credit. Gate create and send against that version. Tie payment/refund to the exact invoice. Requires Stripe test mode and migration reconciliation. | Closing review leaves Draft. Changes invalidate approval. A paid deposit sets Ready to confirm. A $1,000 quote, $300 paid deposit and $80 approved extras leave $780 due. Duplicate or reordered events apply each payment once and keep final balance correct. |
| **COM-01 · P1 · Communications + operations** | [Consultation approval function](https://github.com/lachlanbruce944-droid/chanel-monroe-crm/blob/ee71727/supabase/functions/consultation-manage/index.ts#L27), [public acknowledgement](https://github.com/lachlanbruce944-droid/chanel-monroe-makeup/blob/f499cfa/site/enquire.html#L1429). Approval and acknowledgement have downstream delivery steps that may fail separately. | Record an outbox entry with the saved transition, track provider ID and delivery status, retry the failed action safely. Requires a test mailbox. | A synthetic provider failure leaves the saved state truthful and delivers one message after retry. |
| **ENQ-01 · P1 · Enquiry + scheduling** | [Party count handling](https://github.com/lachlanbruce944-droid/chanel-monroe-makeup/blob/f499cfa/site/enquire.html#L1187) and [estimate calculation](https://github.com/lachlanbruce944-droid/chanel-monroe-makeup/blob/f499cfa/site/enquire.html#L973). Range-based counts can understate duration and the estimate can omit early-start cost. | Ask for an exact headcount or use a conservative hold with staff review. Itemise minimum and surcharge. Offer a short-notice callback if Chanel approves that policy. | A bridal case, editorial group and 10–15-person enquiry reserve the agreed duration and clearly explain costs and the consultation status. |
| **CAL-02 · P1 · Scheduling + operations** | [Archive and restore](https://github.com/lachlanbruce944-droid/chanel-monroe-crm/blob/ee71727/js/workflow.js#L506) and [calendar connector](https://github.com/lachlanbruce944-droid/chanel-monroe-crm/blob/ee71727/supabase/functions/crm-connectors/index.ts#L67). CRM state can change ahead of external cleanup. | Separate Cancel, Close as lost, Archive and Restore. Recheck availability on restore, stop obsolete reminders and track sync/refund exceptions. Depends on CAL-01 and provider retries. | Archive A, reserve its former time for B, then reopen A. B keeps the slot, and A returns to scheduling review. |
| **A11Y-01 · P1 · Accessibility** | [Gallery interactions](https://github.com/lachlanbruce944-droid/chanel-monroe-makeup/blob/f499cfa/site/js/app.js#L141), [CRM modal and toasts](https://github.com/lachlanbruce944-droid/chanel-monroe-crm/blob/ee71727/js/ui.js#L65), [enquiry collapse CSS](https://github.com/lachlanbruce944-droid/chanel-monroe-makeup/blob/f499cfa/site/enquire.html#L99). Keyboard and status-announcement gaps can block tasks. | Keyboard-operable previews, labelled dialogs with focus restoration, inert collapsed chat, live statuses and persistent errors. Check [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/). | Keyboard-only and screen-reader users can enquire and operate CRM dialogs. Reflow, contrast, touch targets and reduced motion pass manual checks. |
| **WEB-01 · P2 · Website** | [Service and pricing markup](https://github.com/lachlanbruce944-droid/chanel-monroe-makeup/blob/f499cfa/src/index.html#L1497) and [category mappings](https://github.com/lachlanbruce944-droid/chanel-monroe-makeup/blob/f499cfa/src/data/site-content.js#L142). Some entry points lose service context. Local metadata is present. Search coverage remains unverified. | Consistent **Request availability** with selected look carried forward. Add cross-style tier comparison and canonical URL, sitemap and absolute social preview after domain cutover. | All six category links retain their context and pricing explains trials, prep, touch-ups and group support. |
| **REL-01 · P1 · QA** | Local tests passed twice. The [site workflow](https://github.com/lachlanbruce944-droid/chanel-monroe-makeup/blob/f499cfa/.github/workflows/deploy-pages.yml#L4) publishes without a test gate; the CRM checkout contains no tracked workflow. Approved staging, browser and provider checks remain open. | Establish isolated staging, synthetic fixtures, a test mailbox and Stripe test mode. Gate publishing on tests and a synthetic smoke check. Generate revision markers and asset fingerprints, verify upgrade from a cached session, and rehearse the previous frontend with the current schema. | Staging matrix passes, deployed build matches its reviewed version, and a rollback rehearsal restores the known-good release. |

| **COM-02 · P2 · Communications** | [Microsoft 365 import](https://github.com/lachlanbruce944-droid/chanel-monroe-crm/blob/ee71727/supabase/functions/crm-email/index.ts#L42) and [CRM composer](https://github.com/lachlanbruce944-droid/chanel-monroe-crm/blob/ee71727/js/app.js#L838). Reply matching and manual send logging need clearer evidence. | Put an opaque reference in first outbound subjects. Hold ambiguous messages for Chanel, support audited relinking, track import lag and label manual assertions **Logged by staff**. Keep attachment content in the CRM. | A client with two open enquiries can reply to the right conversation. An ambiguous message stays in review and opening a composer leaves delivery unconfirmed. |

## Proposed database shape

- **Enquiry and intake attempt** — Keep a unique enquiry/request token, canonical submission identity, accepted/draft state and processing outcome. Link each accepted enquiry to one CRM booking. Keep unverified identity matches in a review queue.
- **Booking and reservation** — Use separate records for appointments and exclusive resource holds. Store timestamp ranges, resource, state and expiry, with an overlap constraint for active reservations. Snapshot duration and buffer when a booking plan is selected.
- **Financial records** — Keep approved quote revisions and invoice line items with AUD cents and due dates. Link receipts, credits and refunds to a specific invoice. Keep provider event and invoice references unique as appropriate.
- **Delivery, media and history** — Queue notifications and calendar jobs in a transactional outbox. Store attachment ownership and expiry separately. Keep append-only audit events with a retention policy distinct from the activity feed.
- **Migration order** — Reconcile the repository migrations with the deployed catalog, run a clean staging replay, add typed fields and outbox, backfill and resolve conflicts, switch both write paths, then enforce audit and invoicing rules. The live catalog contains billing controls whose migration provenance still needs reconciliation.

## Suggested UI

- **Public** — Show selected service, party size and estimated amount above **Request availability**. Follow with **Phone consultation requested**, **Makeup booking pending**, and **Start another enquiry**. Ask for photos after the client understands how they will be used.
- **CRM** — Show one next action per booking, such as **Review enquiry**, **Approve consultation**, **Review quote** or **Confirm makeup booking**. Use **Occasion and timing**, **Location and access**, and **People and services** as editable sections.
- **Payments and delivery** — Show **Draft → Approved → Link ready → Sent → Paid** with exceptions alongside. Keep calendar and email states visible separately so Chanel can retry just the failed step.

## Staging matrix

| Check | Environment and result | Expected outcome |
| --- | --- | --- |
| Custom-domain home and enquiry | Production HTTP · Failed | Intended home and enquiry return 200 and link together. |
| Pages home, enquiry and CRM assets | Production HTTP · Passed for checked routes and content | Pages loads the reviewed frontend. |
| Website and CRM suites | Local mocks/source · Passed (34 + 51) | All repository tests pass. |
| Bridal enquiry through final payment | Staging · Blocked | One profile link and booking, consultation approval, exact approved deposit and final balance. |
| Short notice and early start | Staging · Blocked | Clear lead-time exception, correct permitted slot and surcharge. |
| Competing requests and buffer conflict | Staging · Blocked | One authoritative hold, alternative displayed, no overlap. |
| Cancel, reschedule and restore | Staging · Blocked | Superseded reservations, reminders and provider records are reconciled. |
| Lost response and retried enquiry | Staging · Blocked | Same receipt and one booking on replay, independently tracked email. |
| Failed email and ambiguous reply | Test mailbox · Blocked | Failure shown, one delivery on retry, ambiguous reply held for review. |
| Repeated/reordered Stripe events and refund | Stripe test mode · Blocked | One payment per exact invoice, current status retained, refund visible. |
| Private attachment access and cleanup | Staging · Blocked | Staff can open a synthetic attachment and abandoned files expire. |
| Keyboard, screen reader, reflow and contrast | Browser · Untested visually; source findings above | 320 CSS px or 400% zoom, representative mobile orientations and desktop complete key tasks. |

## Cross-checks and decisions

Scheduling and database independently confirmed the reservation gap. Enquiry and communications traced receipt scheduling. Operations and billing reproduced the quote-review behaviour in source. Security, database and communications compared the browser-to-storage-to-staff privacy path.

The intake finding is scoped to alternative/no-consult intake paths because the consultation-bearing route has an additional transaction guard. The database reviewer rated the calendar gap at the highest severity. This report uses P0 for the public outage and P1 for release-gating defects whose production impact was verified from code or metadata. Both ratings block sign-off.

Chanel needs to choose the short-notice policy, the duration of pending holds, whether external calendar busy periods count as unavailable, and the refund/cancellation rules. A staging run and owner approval should settle those decisions before release.

## Release sequence

1. **Before public bookings** — Fix custom-domain routing, then verify reservations, recovery, staff/photo access, consultation delivery and critical accessibility tasks in staging.
2. **Before live payments** — Approve server-side quote versions, make booking confirmation explicit, and pass duplicate, out-of-order, refund and delivery tests with Stripe test mode.
3. **After launch** — Refine content and tier comparison, monitor intake conversion, conflicts, undelivered messages and reconciliation delays, and tune the staff queue.

Standards used for recommendations: [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/), [OWASP ASVS 5](https://asvs.owasp.org/), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Supabase storage access](https://supabase.com/docs/guides/storage/security/access-control), and [Stripe webhooks](https://docs.stripe.com/webhooks).
