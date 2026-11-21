-- =============================================================================
-- AgencyOS V1 — Provenance, Approved Coordinator Commissions, Guest Directory
--               Hardening & Updated Atomic RPCs (Migration 004 — Additive Only)
-- Non-destructive migration extending Migration 001–003. Preserves all records.
-- =============================================================================

-- 1. Substitutes: optional "Introduced By" coordinator attribution
ALTER TABLE public.substitutes
  ADD COLUMN IF NOT EXISTS introduced_by_coordinator_id UUID REFERENCES public.coordinators(id) ON DELETE RESTRICT;

-- 2. Partner Guest Contacts: richer contact details + duplicate phone guard per partner
ALTER TABLE public.partner_guest_contacts
  ADD COLUMN IF NOT EXISTS whatsapp_phone TEXT,
  ADD COLUMN IF NOT EXISTS preferred_areas TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_guest_normalized_phone
  ON public.partner_guest_contacts (
    partner_substitute_id,
    RIGHT(regexp_replace(phone, '\D', '', 'g'), 10)
  )
  WHERE LENGTH(regexp_replace(phone, '\D', '', 'g')) >= 7;

-- 3. Requests: distinct source provenance & opt-in Super Admin commission approval
ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS received_from_type TEXT NOT NULL DEFAULT 'DIRECT_MEMBER'
    CHECK (received_from_type IN ('DIRECT_MEMBER', 'EXTERNAL_COORDINATOR', 'INTERNAL_REFERRAL', 'WHATSAPP_GROUP', 'OTHER')),
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS sourced_via_coordinator_id UUID REFERENCES public.coordinators(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS coordinator_commission_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS coordinator_commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00
    CHECK (coordinator_commission_amount >= 0);

-- 4. Assignments: historical Assigned Via preservation, attendee type, replacement chain & approved commission
ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS assigned_via_coordinator_id UUID REFERENCES public.coordinators(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS confirmed_by_user_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_attendee_type TEXT NOT NULL DEFAULT 'REGISTERED_SUBSTITUTE'
    CHECK (actual_attendee_type IN ('REGISTERED_SUBSTITUTE', 'GUEST')),
  ADD COLUMN IF NOT EXISTS replaced_assignment_id UUID REFERENCES public.assignments(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS replacement_reason TEXT,
  ADD COLUMN IF NOT EXISTS coordinator_commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00
    CHECK (coordinator_commission_amount >= 0);

-- Backfill existing rows safely (preserves historical attribution)
UPDATE public.assignments
SET assigned_via_coordinator_id = coordinator_id
WHERE assigned_via_coordinator_id IS NULL;

UPDATE public.assignments
SET actual_attendee_type = CASE WHEN is_delegated THEN 'GUEST' ELSE 'REGISTERED_SUBSTITUTE' END
WHERE actual_attendee_type IS NULL;

-- Drop rigid UNIQUE (request_id, slot_index) if it blocks REPLACED history rows,
-- replacing it with a partial unique index for LIVE assignments only.
ALTER TABLE public.assignments
  DROP CONSTRAINT IF EXISTS assignments_request_id_slot_index_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_assignments_live_slot
  ON public.assignments (request_id, slot_index)
  WHERE status NOT IN ('CANCELLED', 'REPLACED', 'NO_SHOW');

-- 5. Ledger provenance columns for fast Coordinator / Assigned Via filtering
ALTER TABLE public.client_charges
  ADD COLUMN IF NOT EXISTS assigned_via_coordinator_id UUID REFERENCES public.coordinators(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS chapter_id UUID REFERENCES public.chapters(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS meeting_date DATE,
  ADD COLUMN IF NOT EXISTS is_delegated BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.substitute_earnings
  ADD COLUMN IF NOT EXISTS assigned_via_coordinator_id UUID REFERENCES public.coordinators(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS chapter_id UUID REFERENCES public.chapters(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS meeting_date DATE,
  ADD COLUMN IF NOT EXISTS is_delegated BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS actual_attendee_name TEXT;

-- 6. Optional Approved Coordinator Commission Ledger (ONLY booked when explicitly approved > 0)
CREATE TABLE IF NOT EXISTS public.coordinator_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  assignment_id UUID NOT NULL UNIQUE REFERENCES public.assignments(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL REFERENCES public.requests(id) ON DELETE RESTRICT,
  coordinator_id UUID NOT NULL REFERENCES public.coordinators(id) ON DELETE RESTRICT,
  chapter_id UUID NOT NULL REFERENCES public.chapters(id) ON DELETE RESTRICT,
  meeting_date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (paid_amount >= 0 AND paid_amount <= amount),
  status public.finance_status NOT NULL DEFAULT 'OUTSTANDING',
  payment_date DATE,
  payment_method TEXT,
  payment_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.coordinator_commissions ENABLE ROW LEVEL SECURITY;

-- RLS on coordinator_commissions:
--   Super Admin: full organization access
--   External Coordinator: read-only access to their own commission rows (cannot self-approve or mark paid)
--   Substitute / Guest: zero access
DROP POLICY IF EXISTS coordinator_commissions_select_scoped ON public.coordinator_commissions;
CREATE POLICY coordinator_commissions_select_scoped ON public.coordinator_commissions
  FOR SELECT TO authenticated
  USING (
    agencyos_private.is_super_admin(organization_id)
    OR coordinator_id = agencyos_private.current_coordinator_id(organization_id)
  );

DROP POLICY IF EXISTS coordinator_commissions_write_super_admin ON public.coordinator_commissions;
CREATE POLICY coordinator_commissions_write_super_admin ON public.coordinator_commissions
  FOR ALL TO authenticated
  USING (agencyos_private.is_super_admin(organization_id))
  WITH CHECK (agencyos_private.is_super_admin(organization_id));

-- Helpful reporting indexes
CREATE INDEX IF NOT EXISTS idx_assignments_assigned_via ON public.assignments (organization_id, assigned_via_coordinator_id, meeting_date);
CREATE INDEX IF NOT EXISTS idx_substitute_earnings_via ON public.substitute_earnings (organization_id, payee_substitute_id, assigned_via_coordinator_id);
CREATE INDEX IF NOT EXISTS idx_coordinator_commissions_coord ON public.coordinator_commissions (organization_id, coordinator_id, status);

-- 7. Updated Atomic First-Confirm RPC (records historical assigned_via_coordinator_id & approved commission)
CREATE OR REPLACE FUNCTION public.first_eligible_confirm(p_request_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req public.requests%ROWTYPE;
  v_sub public.substitutes%ROWTYPE;
  v_prof public.profiles%ROWTYPE;
  v_filled INT;
  v_asgn_id UUID;
  v_via_coord UUID;
  v_comm NUMERIC(12,2);
  v_conflict BOOLEAN;
BEGIN
  SELECT * INTO v_req FROM public.requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF v_req.assignment_mode <> 'FIRST_CONFIRM' OR v_req.require_manager_approval THEN
    RAISE EXCEPTION 'Request requires coordinator approval';
  END IF;
  IF v_req.status NOT IN ('OPEN', 'AWAITING_SELECTION') THEN
    RAISE EXCEPTION 'Request is already filled or closed';
  END IF;

  SELECT * INTO v_sub FROM public.substitutes
  WHERE user_id = auth.uid() AND organization_id = v_req.organization_id AND active = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unauthorized or inactive substitute'; END IF;

  SELECT * INTO v_prof FROM public.profiles WHERE id = auth.uid() AND active = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account deactivated'; END IF;

  -- Cross-coordinator slot conflict protection without exposing other coordinator details
  SELECT EXISTS (
    SELECT 1
    FROM public.assignments a
    JOIN public.requests r2 ON r2.id = a.request_id
    WHERE a.organization_id = v_req.organization_id
      AND a.contract_substitute_id = v_sub.id
      AND a.is_delegated = FALSE
      AND a.status NOT IN ('CANCELLED', 'REPLACED', 'NO_SHOW')
      AND r2.meeting_date = v_req.meeting_date
      AND r2.reporting_time = v_req.reporting_time
  ) INTO v_conflict;
  IF v_conflict THEN
    RAISE EXCEPTION 'Time slot conflict with another confirmed assignment at this date and reporting time';
  END IF;

  SELECT COUNT(*) INTO v_filled FROM public.assignments
  WHERE request_id = v_req.id AND status NOT IN ('CANCELLED', 'REPLACED', 'NO_SHOW');
  IF v_filled >= v_req.positions_required THEN
    RAISE EXCEPTION 'All positions already filled';
  END IF;

  v_via_coord := COALESCE(v_req.sourced_via_coordinator_id, v_req.coordinator_id);
  v_comm := CASE WHEN v_req.coordinator_commission_enabled THEN v_req.coordinator_commission_amount ELSE 0.00 END;

  INSERT INTO public.assignments (
    organization_id, request_id, coordinator_id, assigned_via_coordinator_id,
    confirmed_by_user_id, approved_at, going_for_member_id, slot_index,
    contract_substitute_id, payee_substitute_id, actual_attendee_type, actual_attendee_name,
    is_delegated, delegation_status, member_fee, agreed_payout, coordinator_commission_amount, status
  ) VALUES (
    v_req.organization_id, v_req.id, v_req.coordinator_id, v_via_coord,
    auth.uid(), now(), v_req.going_for_member_id, v_filled + 1,
    v_sub.id, v_sub.id, 'REGISTERED_SUBSTITUTE', v_prof.display_name,
    FALSE, 'NONE', v_req.member_fee, v_req.offered_payout, v_comm, 'CONFIRMED'
  ) RETURNING id INTO v_asgn_id;

  IF v_filled + 1 >= v_req.positions_required THEN
    UPDATE public.requests SET status = 'CONFIRMED', updated_at = now() WHERE id = v_req.id;
  END IF;

  RETURN v_asgn_id;
END;
$$;

-- 8. Updated Atomic Idempotent Finish RPC:
--    Books exactly 1 client_charge, 1 substitute_earning, and (ONLY when explicitly approved > 0)
--    1 coordinator_commission row. Tagging Assigned Via alone creates ₹0 commission.
CREATE OR REPLACE FUNCTION public.finish_assignment_atomic(
  p_assignment_id UUID,
  p_idempotency_key TEXT,
  p_notes JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_asgn public.assignments%ROWTYPE;
  v_req public.requests%ROWTYPE;
  v_sub_id UUID;
  v_charge_id UUID;
  v_earning_id UUID;
  v_commission_id UUID;
  v_via_coord UUID;
BEGIN
  SELECT * INTO v_asgn FROM public.assignments WHERE id = p_assignment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assignment not found'; END IF;

  SELECT * INTO v_req FROM public.requests WHERE id = v_asgn.request_id;

  v_sub_id := agencyos_private.current_substitute_id(v_asgn.organization_id);
  IF v_sub_id IS NULL OR v_sub_id <> v_asgn.contract_substitute_id THEN
    IF NOT agencyos_private.is_super_admin(v_asgn.organization_id) THEN
      RAISE EXCEPTION 'Only contracted substitute or partner may finish this assignment';
    END IF;
  END IF;

  -- Idempotent replay check: zero duplicate charges, earnings, or commissions
  SELECT id INTO v_charge_id FROM public.client_charges WHERE assignment_id = v_asgn.id;
  SELECT id INTO v_earning_id FROM public.substitute_earnings WHERE assignment_id = v_asgn.id;
  SELECT id INTO v_commission_id FROM public.coordinator_commissions WHERE assignment_id = v_asgn.id;
  IF v_charge_id IS NOT NULL AND v_earning_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'assignment_id', v_asgn.id,
      'client_charge_id', v_charge_id,
      'substitute_earning_id', v_earning_id,
      'coordinator_commission_id', v_commission_id,
      'idempotent_replay', TRUE
    );
  END IF;

  v_via_coord := COALESCE(v_asgn.assigned_via_coordinator_id, v_asgn.coordinator_id);

  UPDATE public.assignments
  SET status = 'COMPLETED_SELF_REPORTED',
      finished_at = now(),
      finish_idempotency_key = p_idempotency_key,
      finished_by_user_id = auth.uid(),
      finished_reported_by_partner = v_asgn.is_delegated,
      meeting_notes = p_notes,
      updated_at = now()
  WHERE id = v_asgn.id;

  INSERT INTO public.client_charges (
    organization_id, assignment_id, coordinator_id, assigned_via_coordinator_id,
    chapter_id, meeting_date, is_delegated, member_id, amount
  ) VALUES (
    v_asgn.organization_id, v_asgn.id, v_asgn.coordinator_id, v_via_coord,
    v_req.chapter_id, v_req.meeting_date, v_asgn.is_delegated, v_asgn.going_for_member_id, v_asgn.member_fee
  ) RETURNING id INTO v_charge_id;

  INSERT INTO public.substitute_earnings (
    organization_id, assignment_id, coordinator_id, assigned_via_coordinator_id,
    chapter_id, meeting_date, is_delegated, actual_attendee_name, payee_substitute_id, amount
  ) VALUES (
    v_asgn.organization_id, v_asgn.id, v_asgn.coordinator_id, v_via_coord,
    v_req.chapter_id, v_req.meeting_date, v_asgn.is_delegated, v_asgn.actual_attendee_name,
    v_asgn.payee_substitute_id, v_asgn.agreed_payout
  ) RETURNING id INTO v_earning_id;

  -- Book coordinator commission ONLY when explicitly approved (> 0)
  IF COALESCE(v_asgn.coordinator_commission_amount, 0) > 0 THEN
    INSERT INTO public.coordinator_commissions (
      organization_id, assignment_id, request_id, coordinator_id, chapter_id, meeting_date, amount
    ) VALUES (
      v_asgn.organization_id, v_asgn.id, v_asgn.request_id, v_via_coord,
      v_req.chapter_id, v_req.meeting_date, v_asgn.coordinator_commission_amount
    )
    ON CONFLICT (assignment_id) DO NOTHING
    RETURNING id INTO v_commission_id;
  END IF;

  RETURN jsonb_build_object(
    'assignment_id', v_asgn.id,
    'client_charge_id', v_charge_id,
    'substitute_earning_id', v_earning_id,
    'coordinator_commission_id', v_commission_id,
    'idempotent_replay', FALSE
  );
END;
$$;
