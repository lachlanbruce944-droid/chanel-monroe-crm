# CRM flow and Stripe readiness — 21 November 2026 (Brisbane)

Scope: current GitHub workflow/UI, deployed `crm-stripe` version 2, live payment reconciliation SQL, and the automated CRM checks. No Stripe invoice, client message, payment, refund or live booking transition was executed. The visual check used an isolated preview with fictional data.

## Intended client flow

| Step | Chanel's action | Client/payment state |
| --- | --- | --- |
| Enquiry | Review details and approve the requested phone consult | Consultation pending until approved |
| Consultation | Complete the call; update address, service, people, timings and notes | Ready for quote |
| Quote review | Check the itemised quote, client email, event details, deposit and terms | No Stripe or client action until confirmation |
| Deposit | Confirm the deposit request, then send the approved payment link | Pending deposit; verified Stripe payment marks it paid |
| Booked | Confirm the booking after payment and calendar checks | Booking confirmed; reminders scheduled |
| Appointment | Record service details and separately agreed additional charges | Deposit already received remains a fixed credit |
| Final review | Check original services, adjustments, additional charges, travel, discounts, deposit credit and exact balance | Confirm before creating/sending final invoice |
| Final payment | Receive Stripe confirmation and reconcile the balance | Pending or confirmed paid |
| Follow-up | Send receipt/thank-you, request feedback and complete the job | Complete only when financial balance is settled |

The last payment should be labelled **Final balance**, not final deposit.

## What already works

- Owner-approved consultation workflow and calendar checks; approval stays separate from makeup booking confirmation.
- Service quote totals include services, travel, discounts and additional costs.
- Final invoice deducts the deposit already received.
- Additional cost descriptions are required; changes to that cost are blocked once a final Stripe invoice exists.
- Stripe link creation requires a signed-in staff account, reads invoice data on the server, uses idempotency keys and signature-verifies incoming webhook events.
- Webhook reconciliation checks invoice ID, booking, AUD currency and expected payment amount; repeated payment callbacks avoid duplicate payment records.
- Paid deposit and final invoice status can be tracked independently; booking confirmation remains an explicit action.

## Changes implemented in this pass

| Change | Reason and existing style reference |
| --- | --- |
| Services: one category heading, one service row | Removes repeated one-item subheadings and category/subcategory columns. Uses existing `.card`, `.lines`, `.badge` patterns. |
| Rate in AUD, minutes, Active/Inactive | Distinguishes money, timing and availability without the ambiguous “On” heading. Existing `UI.money` provides two decimal places. |
| Category/subcategory shown only during Edit | Organisation remains editable while default browsing stays concise. Extends existing `initialiseEditCards` and `lockEditCard`. |
| Shared icon and Edit styling | Uses existing outline SVG icons, pill `.btn` buttons, rose palette and rounded cards. Adds missing Services, Edit and clock symbols in the same stroke style. |
| Larger controls, darker secondary text, focus outlines | Improves readability, touch targets and keyboard navigation across sections. Keeps Inter for controls and Cormorant/Georgia for page headings. |
| Tabular money and aligned totals | Makes invoice and quote amounts easier to compare. Leaves printed invoice styling isolated from screen-only refinements. |
| Invoices becomes a status tracker | Each booking pairs Deposit and Final invoice as Pending or Confirmed paid. Detailed editing stays inside the booking. No financial action on this tracker. |
| Review dialog before first Stripe link creation | Shows client, email, appointment, charges, deposit credit, extra costs and payable amount. Cancelling performs no Stripe request. A stale local invoice total is blocked. |
| Explicit action labels | “Review quote & deposit” and “Review for Stripe” distinguish review from actual delivery. Client email remains a separate, deliberate composer step. |

## Live connection status

The deployed `crm-stripe` endpoint returned HTTP 503 with “Stripe invoice collection is not connected. Add STRIPE_SECRET_KEY in secure server settings.” No key was entered or exposed by this audit. Connect Stripe and configure its webhook before sandbox end-to-end verification.

## Remaining Stripe integration work

The UI is clearer, but the payment integration is **not yet a complete review → approve → itemised Stripe → verified delivery workflow**.

| Priority | Gap | Required change |
| --- | --- | --- |
| High | Stripe receives one combined invoice item | Send a reconciled itemised breakdown with stable service/extras IDs, quantities, rates and the correct deposit treatment. The item totals must equal the approved payable cents. |
| High | No server-enforced reviewed financial version | Persist the approved invoice snapshot, reviewer, time and version/hash. Reject create/finalise/send if amounts or client details changed after approval. The new UI dialog is a front-end safeguard, not this server gate. |
| High | Invoice gets marked “sent” when merely prepared | Separate draft, approved, Stripe-open, delivered, payment-pending, paid, voided and failed states internally. The simple Invoices page can still show Pending/Confirmed paid with useful detail. |
| High | Client messages are manual and not delivery-verified | Existing composer opens email/SMS and offers “Mark as sent”. It does not prove delivery. Add a confirmed send action, email provider ID/status, retry and log of the actual approved content. |
| High | Later extras can change the calculated deposit | Freeze the accepted quote/deposit amount. Add new agreed extras to the final balance without recalculating an already paid deposit. |
| High | Some issued-invoice financial fields can still change | Lock or version every monetary field, including travel and discounts, after issue. Use a controlled revision/credit/reissue process rather than letting CRM and Stripe totals diverge. |
| Medium | Fixed Stripe seven-day terms | Read deposit and final due dates from the approved CRM invoice; do not apply seven days to both. |
| Medium | Payment attribution is aggregated by booking/type | Link every payment/credit to the exact invoice, especially before supporting multiple/revised invoices or partial payments. |
| Medium | Refund/dispute/cancellation handling incomplete | Reconcile refunds, disputes, voids and cancellations. Do not leave a refunded booking looking fully paid or a cancelled booking's invoice collectible without review. |
| Medium | Invoice numbers are a client-side counter | Allocate numbers atomically on the server so simultaneous staff actions cannot duplicate them. |
| Medium | Marketing and Inventory are placeholders | These sections are labelled as coming later, not complete operational modules. |

Stripe has a real draft/open distinction: finalising an invoice is a consequential transition, and the invoice cannot simply return to draft. Keep creation of an editable Stripe draft separate from the explicit finalise/send approval. References: https://support.stripe.com/questions/invoice-states and https://docs.stripe.com/api/invoices/finalize .

## Example to preserve in integration tests

Original quote AUD 1,000.00, deposit AUD 300.00 received, agreed on-day extras AUD 80.00: revised job total AUD 1,080.00, final balance AUD 780.00. The deposit remains AUD 300.00. No second deposit and no duplicate charge.

## Verification

44 CRM tests pass, including five new checks for concise services, paired payment statuses, cancelled review making no Stripe request, confirmed review reaching the existing action, and stale invoice totals blocking creation. A pre-existing email wording test was updated to accept “awaiting” as well as “pending”; its pending-approval requirement remains intact. Browser checks confirmed formatted amounts, deliberate Edit controls, hidden grouping fields and the paired invoice tracker using fictional data.

A signed-in live Stripe status check, Stripe sandbox invoice/payment/webhook replay, and actual client email delivery remain necessary before calling the integration fully ready.

## Update — 26 November 2026

- `crm-stripe` v4: Stripe invoices are itemised from the CRM invoice lines (services, extras, travel, discount, "Less deposit received") when the lines add up exactly to the amount due; otherwise one line for the amount due.
- CRM invoice status now mirrors reality: `draft` when raised in the CRM, `open` ("Payment link ready") once the Stripe link exists, `paid` only after `crm_apply_stripe_payment` verifies the amount, `void` when voided or marked uncollectible in Stripe. Previously invoices were marked `sent` as soon as they were prepared.
- Still required before any trial: the owner saves `STRIPE_SECRET_KEY` (sandbox `sk_test_…`) and `STRIPE_WEBHOOK_SECRET` (`whsec_…` from the "chanel-monroe-crm" sandbox webhook) in Supabase → Edge Functions → Secrets. Until then the function answers 503 "not connected".
