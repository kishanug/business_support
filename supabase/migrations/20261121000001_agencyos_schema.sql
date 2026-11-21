-- =============================================================================
-- AgencyOS V1 — PostgreSQL / Supabase Relational Schema (Migration 001)
-- Non-destructive, additive migration; do NOT reset existing production tables.
-- Inspect existing V1/V2 tables and back up data before applying to any live DB.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS agencyos_private;

-- Enums
DO $$ BEGIN
  CREATE TYPE public.agency_role AS ENUM ('SUPER_ADMIN', 'EXTERNAL_COORDINATOR', 'SUBSTITUTE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.assignment_mode AS ENUM ('MULTI_INTEREST', 'FIRST_CONFIRM', 'DIRECT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.finance_status AS ENUM ('OUTSTANDING', 'PARTIALLY_PAID', 'FULLY_PAID', 'ADJUSTED', 'ON_HOLD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1. Organizations
CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  currency TEXT NOT NULL DEFAULT 'INR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Profiles (1:1 with Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL,
  phone TEXT,
  whatsapp_phone TEXT,
  photo_storage_path TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Server-Controlled Role Memberships (NEVER trust JWT user_metadata!)
CREATE TABLE IF NOT EXISTS public.role_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  role public.agency_role NOT NULL,
  can_manage_network BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

-- 4. Coordinators
CREATE TABLE IF NOT EXISTS public.coordinators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE RESTRICT,
  calling_phone TEXT NOT NULL,
  whatsapp_phone TEXT NOT NULL,
  region TEXT,
  default_member_fee NUMERIC(12,2) NOT NULL DEFAULT 500.00,
  default_substitute_payout NUMERIC(12,2) NOT NULL DEFAULT 350.00,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Locations (Venue Master)
CREATE TABLE IF NOT EXISTS public.locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  coordinator_id UUID REFERENCES public.coordinators(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  area TEXT NOT NULL,
  full_address TEXT,
  maps_url TEXT,
  nearest_station TEXT,
  transport_guidance TEXT,
  entry_notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Chapters (Regular weekday is informational ONLY; never auto-coupled to meeting_date default)
CREATE TABLE IF NOT EXISTS public.chapters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  coordinator_id UUID REFERENCES public.coordinators(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  regular_weekday TEXT NOT NULL CHECK (regular_weekday IN ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
  reporting_time TEXT NOT NULL DEFAULT '07:15 AM',
  start_time TEXT NOT NULL DEFAULT '07:30 AM',
  end_time TEXT NOT NULL DEFAULT '09:30 AM',
  default_location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  default_member_fee NUMERIC(12,2) NOT NULL DEFAULT 500.00,
  default_substitute_payout NUMERIC(12,2) NOT NULL DEFAULT 350.00,
  usual_instructions TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. Members (CRM records only in V1; no member login)
CREATE TABLE IF NOT EXISTS public.members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  coordinator_id UUID NOT NULL REFERENCES public.coordinators(id) ON DELETE RESTRICT,
  chapter_id UUID NOT NULL REFERENCES public.chapters(id) ON DELETE RESTRICT,
  preferred_location_id UUID REFERENCES public.locations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  whatsapp_phone TEXT NOT NULL,
  email TEXT,
  business_name TEXT,
  business_category TEXT,
  intro_30_sec TEXT,
  referral_ask TEXT,
  standard_fee NUMERIC(12,2) NOT NULL DEFAULT 500.00,
  notes TEXT,
  photo_storage_path TEXT,
  communication_consent BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. Substitutes (Shared eligible pool within organization)
CREATE TABLE IF NOT EXISTS public.substitutes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE RESTRICT,
  home_area TEXT NOT NULL,
  preferred_chapter_ids UUID[] NOT NULL DEFAULT '{}',
  default_payout NUMERIC(12,2) NOT NULL DEFAULT 350.00,
  availability TEXT NOT NULL DEFAULT 'AVAILABLE',
  can_manage_network BOOLEAN NOT NULL DEFAULT FALSE,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Private substitute payment & emergency contact table (strictly restricted schema/RLS)
CREATE TABLE IF NOT EXISTS agencyos_private.substitute_sensitive_details (
  substitute_id UUID PRIMARY KEY REFERENCES public.substitutes(id) ON DELETE RESTRICT,
  upi_reference TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  emergency_consent BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. Partner Guest Contacts (NO auth.users account; strictly owned by partner_substitute_id)
CREATE TABLE IF NOT EXISTS public.partner_guest_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  partner_substitute_id UUID NOT NULL REFERENCES public.substitutes(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  home_area TEXT NOT NULL,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  consent_confirmed BOOLEAN NOT NULL DEFAULT FALSE CHECK (consent_confirmed = TRUE),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10. Requests (With immutable request-scoped snapshots & distinct source attribution)
CREATE TABLE IF NOT EXISTS public.requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  request_number BIGSERIAL,
  going_for_member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  received_from TEXT NOT NULL,
  coordinator_id UUID NOT NULL REFERENCES public.coordinators(id) ON DELETE RESTRICT,
  chapter_id UUID NOT NULL REFERENCES public.chapters(id) ON DELETE RESTRICT,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  -- Defaults to tomorrow in Asia/Kolkata at application/RPC level
  meeting_date DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date + 1),
  chapter_regular_weekday TEXT NOT NULL,
  chapter_name_snapshot TEXT NOT NULL,
  venue_name_snapshot TEXT NOT NULL,
  area_snapshot TEXT NOT NULL,
  address_snapshot TEXT,
  maps_url_snapshot TEXT,
  directions_snapshot TEXT,
  reporting_time TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  intro_30_sec_snapshot TEXT,
  assignment_mode public.assignment_mode NOT NULL DEFAULT 'MULTI_INTEREST',
  require_manager_approval BOOLEAN NOT NULL DEFAULT FALSE,
  allow_bids BOOLEAN NOT NULL DEFAULT TRUE,
  positions_required INT NOT NULL DEFAULT 1 CHECK (positions_required >= 1),
  member_fee NUMERIC(12,2) NOT NULL CHECK (member_fee >= 0),
  offered_payout NUMERIC(12,2) NOT NULL CHECK (offered_payout >= 0),
  urgency TEXT NOT NULL DEFAULT 'NORMAL',
  special_instructions TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 11. Request Responses (Unique current response per request + substitute)
CREATE TABLE IF NOT EXISTS public.request_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL REFERENCES public.requests(id) ON DELETE RESTRICT,
  substitute_id UUID NOT NULL REFERENCES public.substitutes(id) ON DELETE RESTRICT,
  response_type TEXT NOT NULL CHECK (response_type IN ('INTERESTED','NOT_AVAILABLE','BID','FIRST_CONFIRM','DELEGATE_PROPOSAL')),
  proposed_payout NUMERIC(12,2),
  delegated_guest_id UUID REFERENCES public.partner_guest_contacts(id) ON DELETE RESTRICT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (request_id, substitute_id)
);

-- 12. Assignments (Distinct contractual payee vs physical attendee; unique slot per request)
CREATE TABLE IF NOT EXISTS public.assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL REFERENCES public.requests(id) ON DELETE RESTRICT,
  coordinator_id UUID NOT NULL REFERENCES public.coordinators(id) ON DELETE RESTRICT,
  going_for_member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  slot_index INT NOT NULL CHECK (slot_index >= 1),
  contract_substitute_id UUID NOT NULL REFERENCES public.substitutes(id) ON DELETE RESTRICT,
  payee_substitute_id UUID NOT NULL REFERENCES public.substitutes(id) ON DELETE RESTRICT,
  actual_attendee_guest_id UUID REFERENCES public.partner_guest_contacts(id) ON DELETE RESTRICT,
  actual_attendee_name TEXT NOT NULL,
  is_delegated BOOLEAN NOT NULL DEFAULT FALSE,
  delegation_status TEXT NOT NULL DEFAULT 'NONE',
  member_fee NUMERIC(12,2) NOT NULL CHECK (member_fee >= 0),
  agreed_payout NUMERIC(12,2) NOT NULL CHECK (agreed_payout >= 0),
  status TEXT NOT NULL DEFAULT 'CONFIRMED',
  finish_idempotency_key TEXT UNIQUE,
  finished_at TIMESTAMPTZ,
  finished_by_user_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  finished_reported_by_partner BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  verified_by_user_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  disputed BOOLEAN NOT NULL DEFAULT FALSE,
  dispute_reason TEXT,
  meeting_notes JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (payee_substitute_id = contract_substitute_id),
  UNIQUE (request_id, slot_index)
);

-- 13. Check-in Events
CREATE TABLE IF NOT EXISTS public.checkin_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  assignment_id UUID NOT NULL REFERENCES public.assignments(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('AWAKE','LEFT_HOME','REACHED','FINISH')),
  reported_by_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reported_by_partner BOOLEAN NOT NULL DEFAULT FALSE,
  actual_attendee_name TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 14. Finance Ledger — One Charge & One Earning per Fulfilled Assignment (NO cascade delete!)
CREATE TABLE IF NOT EXISTS public.client_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  assignment_id UUID NOT NULL UNIQUE REFERENCES public.assignments(id) ON DELETE RESTRICT,
  coordinator_id UUID NOT NULL REFERENCES public.coordinators(id) ON DELETE RESTRICT,
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  received_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (received_amount >= 0),
  status public.finance_status NOT NULL DEFAULT 'OUTSTANDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.substitute_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  assignment_id UUID NOT NULL UNIQUE REFERENCES public.assignments(id) ON DELETE RESTRICT,
  coordinator_id UUID NOT NULL REFERENCES public.coordinators(id) ON DELETE RESTRICT,
  payee_substitute_id UUID NOT NULL REFERENCES public.substitutes(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (paid_amount >= 0),
  status public.finance_status NOT NULL DEFAULT 'OUTSTANDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.client_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  coordinator_id UUID NOT NULL REFERENCES public.coordinators(id) ON DELETE RESTRICT,
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_date DATE NOT NULL,
  method TEXT NOT NULL,
  reference TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  actor_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.receipt_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES public.client_receipts(id) ON DELETE RESTRICT,
  charge_id UUID NOT NULL REFERENCES public.client_charges(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0)
);

CREATE TABLE IF NOT EXISTS public.freelancer_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  coordinator_id UUID NOT NULL REFERENCES public.coordinators(id) ON DELETE RESTRICT,
  payee_substitute_id UUID NOT NULL REFERENCES public.substitutes(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  bonus_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (bonus_amount >= 0),
  bonus_message TEXT,
  payment_date DATE NOT NULL,
  method TEXT NOT NULL,
  reference TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  actor_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payout_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id UUID NOT NULL REFERENCES public.freelancer_payouts(id) ON DELETE RESTRICT,
  earning_id UUID NOT NULL REFERENCES public.substitute_earnings(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0)
);

-- 15. Immutable Audit Events & Notifications
CREATE TABLE IF NOT EXISTS public.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  coordinator_id UUID REFERENCES public.coordinators(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  summary TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  recipient_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  related_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Public Open-Request View (security_invoker = true; omits member identity, phone, and 30-sec intro!)
CREATE OR REPLACE VIEW public.v_public_open_requests
WITH (security_invoker = true) AS
SELECT
  r.id,
  r.organization_id,
  r.request_number,
  r.chapter_id,
  r.chapter_name_snapshot AS chapter_name,
  r.area_snapshot AS area,
  r.venue_name_snapshot AS venue_name,
  r.meeting_date,
  r.chapter_regular_weekday,
  r.reporting_time,
  r.start_time,
  r.end_time,
  r.assignment_mode,
  r.allow_bids,
  r.positions_required,
  r.offered_payout,
  r.urgency,
  r.status,
  r.special_instructions,
  c.calling_phone AS coordinator_calling_phone,
  c.whatsapp_phone AS coordinator_whatsapp_phone
FROM public.requests r
JOIN public.coordinators c ON c.id = r.coordinator_id
WHERE r.status IN ('OPEN', 'AWAITING_SELECTION');
