# AgencyOS — Architecture, Reference Mapping, Feature Matrix & Admin Guide

## 1. Environment & Backend Status (Honest Disclosure)

- **Current Runtime**: Full-stack React + TypeScript + Express/Node transactional server running locally on port `3000`.
- **Supabase Live Connection**: **NOT CONNECTED** in this sandbox environment. No external Supabase project was secretly created or altered. Complete, ready-to-apply PostgreSQL migrations, strict Row Level Security (RLS) policies, atomic PL/pgSQL RPCs, and negative RLS test scripts are delivered in `/supabase/migrations/`.
- **Data Isolation**: The local backend enforces two strictly separated partitions:
  1. `demo`: Pre-seeded with fictional sample data accessible via the single-row `SA | EC | SUB` Quick Demo Access selector.
  2. `workspace`: Empty clean-slate local workspace initialized via first-run Admin bootstrap and invite-only onboarding, with zero overlap with `demo`.

---

## 2. Reference-to-Screen Mapping (Screenshots 1–6)

| # | Reference Screenshot | Preserved UI Patterns | Deliberately Rejected & Replaced With |
|---|---|---|---|
| 1 | `Login page(1).png` | Centered sign-in shell, identically aligned email/password fields, show/hide toggle, Forgot Password link. | **Rejected:** Red BNI branding, plaintext demo passwords printed on screen, role tabs granting privileges. **Replaced with:** Original golden Veloctive cycling logo (`/assets/aistudio/image__1__81460661.png`), `AgencyOS` navy/gold wordmark with slanted `by Kishan` (no underline), white/navy/purple/gold palette, fixed-height `SA \| EC \| SUB` horizontal expander + single `Quick Demo Login`. |
| 2 | `open request(1).png` | Compact white request card, prominent payout figure, responsive list layout, quick call/WhatsApp icons. | **Rejected:** Exposing member name (`Rahul Sharma`), member contact, Maps link, or intro prior to confirmation. **Replaced with:** Privacy-safe public open card showing chapter/area/date/time/payout only; `Need Help?` with Coordinator-only Call + WhatsApp anchored at bottom-right; mode-aware actions (`I Confirm`, `Interested`, `Make an Offer`, `Send Someone Else`, `Not Available`). |
| 3 | `Reports(1).png` | `Today \| This Week \| This Month \| Custom` scope bar, chapter selector, metric tiles, substitute breakdown, delegation history, CSV export. | **Rejected:** Listing `Unassigned` inside substitute payables, wall of rainbow KPI cards, conflating cash flow with profit. **Replaced with:** Disciplined navy/purple/gold hierarchy separating `Receivable Pending`, `Cash Received`, `Sub Payable Pending`, `Cash Paid`, and `Gross Margin (Earned)`, excluding unassigned bookings from payables. |
| 4 | `Substitute(1).png` | Searchable substitute rows, quick Call/WhatsApp/Edit/Power controls, structured Add/Edit modal. | **Rejected:** Comma-separated free-text chapters and manager-entered plaintext password inputs. **Replaced with:** Linked multi-select chapter IDs, private UPI & consent-gated emergency contact fields, `Manage My Network` Partner toggle, and invite-token onboarding (zero plaintext password storage). |
| 5 | `Member(1).png` | Searchable member rows, chapter/category metadata, quick Call/WhatsApp/Edit/Power actions, clean modal. | **Rejected:** Duplicated free-text `Office Location` and `Meeting Time` fields per member. **Replaced with:** Linked `Chapter -> Default Location & Schedule` hierarchy, optional preferred venue override, separate calling & WhatsApp numbers, 30-second intro, and referral ask. |
| 6 | `Payment summary(1).png` | `Receipts \| Payments \| Ledger` tabs, summary tiles, expandable member/substitute groups, Call/WhatsApp/Remind controls. | **Rejected:** One-click `Got it` accounting shortcut and treating WhatsApp reminders as payment proof. **Replaced with:** Deliberate `Record Receipt` & `Record Payout` modals requiring amount, date, method, UTR/reference, multi-meeting partial/batch allocation, optional `Appreciation Bonus` (agency cost only), and immutable ledger with audited adjustments. |

---

## 3. Feature Completion Matrix

| Feature Area | Status | Notes |
|---|---|---|
| Login UI (Golden Veloctive logo, `by Kishan`, `SA \| EC \| SUB` expander) | **Implemented** | Verified zero height jump/wrap across desktop & mobile |
| Invite-only Auth, Password Reset, Session Revocation, Deactivation Gate | **Implemented (Local Sandbox)** | `scrypt` hashing + HMAC Bearer in memory; Supabase Auth SQL delivered |
| Linked Masters (`Locations -> Chapters -> Members -> Substitutes`) | **Implemented** | Full CRUD + active/inactive toggling preserving history |
| New Request Tomorrow Default (`Asia/Kolkata`) & Snapshot Isolation | **Implemented** | Independently verified via `node:test` (`AT-01` – `AT-03`) |
| Three Modes (`Multi-Interest`, `First-Confirm` atomic lock, `Direct`) | **Implemented** | Race lock + mandatory approval for bids & guest delegates (`AT-04` – `AT-06`) |
| Partner `My Network` & `Send Someone Else` Guest Delegation | **Implemented** | Guests have no login; distinct payee vs actual attendee (`AT-08`, `AT-09`) |
| Morning Self Check-ins & Atomic Idempotent `Finish` + Ledger Posting | **Implemented** | Exactly-once receivable & payable, early-finish safeguard (`AT-10` – `AT-12`) |
| Finance (`Receipts`, `Payments`, Multi-Meeting Allocation, Bonus, Ledger) | **Implemented** | Weekly/monthly/partial settlement + Appreciation Bonus (`AT-13` – `AT-15`) |
| Two-Column `Tomorrow's Overview` & `Previous Overview` Chapter Cards | **Implemented** | Inline counts + `Member -> Actual Attendee` expansion (`AT-19`) |
| Reports, Delegation History & CSV Export | **Implemented** | Accrual vs cash separation + Unassigned excluded from payables |
| WhatsApp & Call Draft Links (`tel:` / `wa.me`) | **Implemented** | Explicitly tracks `Prepared -> Opened -> Manually Sent` |
| External Live Supabase Project Connection & Private Storage Buckets | **Blocked (No Credentials in Sandbox)** | Production migrations `001`–`003` ready in `/supabase/migrations/` |
| Automated WhatsApp Business API / Push Notifications / Member Portal | **Deferred (V1.1 / V2)** | Intentionally scoped out of V1 per PRD Section 16 |

---

## 4. Relational Schema Overview

```
organizations ──< role_memberships >── profiles (auth.users)
      │
      ├──< coordinators ──< members >── chapters >── locations
      │                         │
      ├──< substitutes ─────────┼──< requests ──< request_responses
      │         │               │        │
      │         ├──< partner_guest_contacts (no auth account)
      │         │                        │
      │         └───────< assignments >──┴──< checkin_events
      │                     │     │
      │          (1:1) ─────┘     └───── (1:1)
      │            │                       │
      │      client_charges        substitute_earnings
      │            │                       │
      │    receipt_allocations     payout_allocations
      │            │                       │
      │      client_receipts       freelancer_payouts (+ appreciation bonus)
```

---

## 5. Admin Setup & Deployment Guide

1. **Local Verification**:
   - Run automated unit & security tests: `npm test`
   - Run TypeScript check & production bundle: `npm run lint && npm run build`
   - Start full-stack server on port 3000: `npm run dev`
2. **Deploying to Your Own Supabase Project**:
   - First verify your target Supabase project is **ACTIVE** and back up any existing V1/V2 tables.
   - Apply `/supabase/migrations/20261121000001_agencyos_schema.sql` and `20261121000002_agencyos_rls_and_rpcs.sql` via `supabase db push`.
   - Run `/supabase/migrations/20261121000003_negative_rls_tests.sql` against staging to verify cross-coordinator isolation.
   - Configure server-side environment variables only (`SUPABASE_SERVICE_ROLE_KEY` must NEVER be exposed with `VITE_` prefix).
