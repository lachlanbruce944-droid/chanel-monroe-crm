# Chanel Monroe · Client Studio

A private CRM for Chanel Monroe Makeup. It covers enquiries, phone calls, quotes, deposits, reminders, photos from the day, final invoices and reviews.

- **Live site:** GitHub Pages (see the repo's *About* panel for the link)
- **Database:** Supabase project `makeup-website`, the same project as the website
- **Running checklist:** [CHECKLIST.md](CHECKLIST.md)

## How it fits together
```
chanelmonroe website (chat enquiry) ──insert──▶ public.enquiries
                                                  │  database trigger
                                                  ▼
                                   crm_clients + crm_bookings (stage: Enquiry)
                                   + "reply today" reminder + activity log
                                                  │
                         this CRM (signed-in staff only) ◀── reads/writes crm_* tables
```
Every website enquiry turns into a client and a booking automatically. The booking shows everything the client picked: look, extras, reference photos, beauty team, estimate and travel. Nothing extra has to be added to the website.

## Employees, Marketing, Inventory
- **Employees** (`#/employees`): team members and affiliates in `crm_people` (staff only). The website's *Join the team* and *Become an affiliate* forms (`apply.html` on the website, edge function `application`) add people here as **Applications**. Add them to the team or as an affiliate, decline, or mark as past. **Show on website** puts an active team member (first name, role, Instagram, photo) on the website's About → The team, through the public `site_team()` function. Nothing else is ever public.
- **Marketing** and **Inventory**: placeholder tabs for now.
- Table SQL: `supabase/crm_people.sql`.

## Sign-in & access
- Accounts use email + password (Supabase Auth), with password-reset emails.
- **The first account to sign in becomes the owner** (Chanel). Anyone else who signs up sees "waiting for access" until the owner adds their email under *Profile → Team accounts*.
- The database itself blocks every `crm_*` table unless you are signed in as staff (row-level security). The key in `js/config.js` is Supabase's *publishable* key and is safe to be public.

## The booking workflow
Enquiry → Phone call → Updates & quote → Deposit → Booked (reminders) → The day (photos) → Final invoice → Review → Complete

| Stage | Moves when | Automatic |
|---|---|---|
| Enquiry | Website / phone enquiry | Client + booking + reply reminder |
| Phone call | Call scheduled | Call reminder on calendar |
| Updates & quote | Call notes logged | Quote builder (pre-filled with website estimate) |
| Deposit | Quote sent | Deposit invoice + chase reminder |
| Booked | Deposit recorded | Invoice paid; 14/7/2/1-day reminders with ready messages |
| The day | On/after event date | Photo upload (private storage) |
| Final invoice | Day finished | Final invoice less deposit + send/chase reminders |
| Review | Final payment recorded | Review request + follow-up |
| Complete | Review recorded | Closes reminders |

## Files
```
index.html             app shell
js/config.js           Supabase URL + publishable key
js/db.js               DATABASE LAYER — Supabase tables ↔ app records (only file to swap for iOS)
js/workflow.js         BUSINESS RULES — stages, guards, invoices, reminders, templates (no UI)
js/auth.js             Supabase Auth: sign-up, sign-in, reset, team access
js/app.js              screens & routing
js/ui.js               formatting, icons, modals, image resizing
css/app.css            design (mobile-first, print styles for invoices)
supabase/crm_schema.sql  database reference + website→CRM trigger
CHECKLIST.md           running build checklist & roadmap
```

## Editing
Edit the files and commit to `main`. GitHub Pages republishes within a minute or two. **After changing any css/js file, bump the `?v=` number on every file in `index.html`** (e.g. `?v=20261116b` → `?v=20261117a`), or browsers that opened the CRM before keep the old code. To run locally, any static server works (e.g. `npx serve .`). It talks to the live database, so sign in with a real account.
