# Chanel Monroe CRM — running checklist

_Last updated: 15 Nov 2026. Tick items off here as they're done; add new ones at the bottom of the right section._

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

## 🔜 Next (to do now)
- [ ] **Chanel creates her account first** on the live site (first account becomes owner)
- [ ] Fill in Profile: ABN, bank/PayID, review link, deposit %, policy, photo
- [ ] Check services & prices match the website's pricing
- [ ] Supabase → Authentication → URL configuration: confirm the GitHub Pages URL is in Site URL / Redirect URLs (needed for confirm & reset emails)
- [ ] Optional: turn off public sign-ups in Supabase once the team is set up (Auth → Providers → Email → "Allow new users to sign up")
- [ ] Decide on the 6 test enquiries in the website's `enquiries` table (Lachlan's tests, 13–14 Nov). They were **not** imported into the CRM. Delete them or keep them.
- [ ] Send one real test enquiry through the live website and confirm it appears in Enquiries

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
