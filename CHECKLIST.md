# Chanel Monroe CRM — running checklist

_Last updated: 16 Nov 2026. Tick items off here as they're done; add new ones at the bottom of the right section._

## ✅ Done
- [x] Booking workflow: Enquiry → Call → Quote → Deposit → Booked → Day → Final invoice → Review → Complete
- [x] Quotes, deposit & final invoices (auto-numbered CM-0001…), payments, printable/PDF invoices
- [x] Reminders (reply, call, deposit chase, 14/7/2/1-day, final chase, review) with ready-made messages
- [x] Calendar, client records (skin, allergies, shades), photos, reviews, activity log
- [x] Supabase database: `crm_*` tables, staff-only security, private photo bucket
- [x] Website → CRM: every website chat enquiry auto-creates a client + booking (database trigger, tested)
- [x] Website enquiry panel on each booking (look, extras, reference photos, beauty team, estimate, travel)
- [x] Supabase sign-in: email + password, reset email, first account = owner, owner adds assistants
- [x] Sample/test clients removed. The CRM starts empty.
- [x] GitHub repo created and published on GitHub Pages
- [x] Employees section (16 Nov): Applications / Team / Affiliates / Past tabs. The website's "Join the team" (About) and "Become an affiliate" (Affiliates) chat forms land here as applications (table `crm_people`, edge function `application`, which also emails Chanel and the applicant). Add to team, decline, mark as past, and "Show on website" puts a team member on the website's About → The team.
- [x] Marketing and Inventory tabs added as "coming soon" placeholders
- [x] `crm_people` table + `site_team()` applied (16 Nov), plus the website's selfie storage
- [x] Services match the website's price list: the 26 looks from the website's pricing (same names, prices, from-prices) plus 3 CRM add-ons; deposit 30% matches. Seeded on Chanel's first sign-in.
- [x] Supabase Auth URLs (16 Nov): Site URL was http://localhost:3000; now the live CRM (https://lachlanbruce944-droid.github.io/chanel-monroe-crm/), plus redirect URL `…/chanel-monroe-crm/**`. Confirm and reset emails now link to the CRM.
- [x] Live tests (16 Nov): a website enquiry became a CRM client + booking (Enquiry stage) and both emails were delivered; a Join the team application landed in Employees → Applications and both emails were delivered. Test records then deleted.
- [x] Old test enquiries deleted (16 Nov, Lachlan's call): the 6 from 13–14 Nov and Chanel's of 15 Nov with its CRM client and booking. Website enquiries and the CRM both start empty.

## 🔜 Next (to do now)
- [ ] **Chanel creates her account first** on the live site (first account becomes owner)
- [ ] Fill in Profile (Chanel): ABN, bank/PayID, phone, review link, photo. Email, website, service area and 30% deposit are pre-filled.
- [ ] Optional: turn off public sign-ups in Supabase once the team is set up (Auth → Providers → Email → "Allow new users to sign up")

## 💡 Roadmap (from CRM research, highest value first)
1. **Instant notify + auto-reply.** Push/email Chanel the moment a website enquiry lands, and track first-response time. About half of wedding suppliers reply within the first hour, so speed decides bookings.
2. **Pay the deposit online.** Add a Stripe payment link in the quote email. The booking moves to *Booked* automatically when paid. Deposits are the main no-show protection in beauty booking tools.
3. **One-click "proposal" page.** Quote + T&Cs/contract e-sign + deposit in one client-facing link (the HoneyBook/Dubsado model).
4. **Reminders that send themselves.** Supabase scheduled function sends due reminders by email (Resend) / SMS (Twilio).
5. **Bridal party builder.** Per-person pricing (bride, bridesmaids, mums), a trial booking linked to the wedding, and a timeline working back from the ready-by time.
6. **Google Calendar sync.** Confirmed bookings and calls go into Chanel's calendar. The website already creates enquiry events, so these just need updating when confirmed.
7. **Client portal.** The client sees their booking, invoices, prep tips and day photos, and can pay the balance.
8. **Reports.** Enquiries per month, enquiry→booking conversion %, average booking value, lead source, revenue by service.
9. **Kit & product notes per client.** Shades and products used, linked to the website's product database for after-care emails.
10. **iOS app.** Wrap with Capacitor (fastest), or rebuild in SwiftUI on the same Supabase tables (`workflow.js` is the rules spec).

## 📝 Notes / decisions
- Repo is public (free GitHub Pages needs public). No client data is in the repo; all data stays in Supabase behind sign-in.
- The CRM shares the Supabase project `makeup-website` with the website. CRM tables are all prefixed `crm_`.

## 17 Nov 2026 update
- Connections / Associates terminology; editable photo profiles, public affiliate import and manual availability/status fields implemented.
- Enquiries list/filter/board redesign implemented.
- Database records are created by the signed-in staff import action, not by publishing source. See docs/CLAUDE-HANDOFF.md for pending integrations and verification.

## Settings / Connectors (17 Nov)
- [x] Separate Settings destination, provider windows, real connection-status checks.
- [x] Staff-authenticated connector service and service-only calendar write lease.
- [x] Explicit Brisbane job blocks, buffers, overlap checks, idempotent own-event sync and protected Booked transition.
- [ ] Owner signs into Cal.com, connects Google Calendar/Stripe, and securely configures CAL_API_KEY.
- [ ] Choose the shared writable Google calendar and verify the Enquiry event checks it; sync existing booked jobs and enable protection.
- [ ] Live event/payment integration test after account activation. No appointment, payment or Google event was created during deployment.
