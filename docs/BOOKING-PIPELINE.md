# Booking pipeline

1. Website chatbot collects client details, references, event details and a preferred phone consultation date/time in Brisbane time.
2. Existing database triggers create/link a client and enquiry booking, copy the requested time to `call_at` and mark the CRM calendar call pending approval. Pending calls are visible immediately and refresh within a minute on an open CRM.
3. Chanel approves the consultation in the CRM; no enquiry review notes are required. The owner-only service queues and sends the consultation confirmation email. Rescheduling resets approval. Short-notice exceptions still require a reason.
4. After the approved call has started, complete the consultation and save notes. This opens the initial quote stage.
5. Prepare the quote, create a Stripe deposit invoice link, send the quote and collect the deposit. Deposit payment is required before booking confirmation.
6. Confirmed bookings create reminder tasks for the configured dates. Open each task to compose/send the reminder and mark it sent; these are not unattended email/SMS sends.
7. On the day, upload before/after photos or MP4/WebM/MOV videos up to 6 MB each, save additional notes and agreed additional costs, and record verbal/written feedback. Media stays in private storage. Sharing consent defaults off.
8. Create the final invoice, including extra costs and deducting the deposit. Create/open the Stripe invoice link and refresh payment status to reconcile payment. Changing costs after a final Stripe invoice is issued requires reconciliation first.
9. Send the thank-you follow-up with a Stripe invoice link (paid invoice/receipt when paid, payment link when outstanding), and optionally ask for a review. Mark the message sent. Completion requires the follow-up to be logged; missing reviews can be explicitly skipped.

## Deployment

`supabase/booking_pipeline.sql` was applied through the database migration tool as `crm_pipeline_after_consultation_notes`. It replaces only the consultation scheduling/approval function to remove the pre-call notes requirement, and enables private video MIME types in the existing media bucket. Existing records and stage keys are preserved.

The CRM Stripe function source is now tracked. The deployed function previously included an unrelated starter handler before the invoice handler; this has been removed. The function authenticates staff via the Auth service and staff table, or validates Stripe webhook signatures. Stripe secret and webhook configuration remain required. No live charges or client emails were sent during verification.
