-- =============================================================================
-- AgencyOS V1 — Strict Row Level Security (RLS) & Transactional RPCs (Migration 002)
-- Zero USING(true) policies on private tables.
-- All authorization relies on server-controlled public.role_memberships, NEVER JWT user_metadata.
-- =============================================================================

-- Helper functions (SECURITY DEFINER with locked search_path)
CREATE OR REPLACE FUNCTION agencyos_private.current_membership(p_org_id UUID)
RETURNS TABLE(role public.agency_role, can_manage_network BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT rm.role, rm.can_manage_network
  FROM public.role_memberships rm
  JOIN public.profiles p ON p.id = rm.user_id
  WHERE rm.organization_id = p_org_id
    AND rm.user_id = auth.uid()
    AND rm.active = TRUE
    AND p.active = TRUE
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION agencyos_private.is_super_admin(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM agencyos_private.current_membership(p_org_id)
    WHERE role = 'SUPER_ADMIN'
  );
$$;

CREATE OR REPLACE FUNCTION agencyos_private.current_coordinator_id(p_org_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.id
  FROM public.coordinators c
  JOIN public.role_memberships rm ON rm.user_id = c.user_id AND rm.organization_id = c.organization_id
  JOIN public.profiles p ON p.id = c.user_id
  WHERE c.organization_id = p_org_id
    AND c.user_id = auth.uid()
    AND c.active = TRUE
    AND rm.active = TRUE
    AND p.active = TRUE
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION agencyos_private.current_substitute_id(p_org_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.id
  FROM public.substitutes s
  JOIN public.role_memberships rm ON rm.user_id = s.user_id AND rm.organization_id = s.organization_id
  JOIN public.profiles p ON p.id = s.user_id
  WHERE s.organization_id = p_org_id
    AND s.user_id = auth.uid()
    AND s.active = TRUE
    AND rm.active = TRUE
    AND p.active = TRUE
  LIMIT 1;
$$;

-- Enable RLS on ALL exposed tables
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coordinators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.substitutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_guest_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkin_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.substitute_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.freelancer_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- MEMBERS: Strict cross-coordinator isolation; substitutes CANNOT read members table directly
CREATE POLICY members_select_scoped ON public.members
  FOR SELECT TO authenticated
  USING (
    agencyos_private.is_super_admin(organization_id)
    OR coordinator_id = agencyos_private.current_coordinator_id(organization_id)
  );

CREATE POLICY members_insert_scoped ON public.members
  FOR INSERT TO authenticated
  WITH CHECK (
    agencyos_private.is_super_admin(organization_id)
    OR coordinator_id = agencyos_private.current_coordinator_id(organization_id)
  );

CREATE POLICY members_update_scoped ON public.members
  FOR UPDATE TO authenticated
  USING (
    agencyos_private.is_super_admin(organization_id)
    OR coordinator_id = agencyos_private.current_coordinator_id(organization_id)
  )
  WITH CHECK (
    agencyos_private.is_super_admin(organization_id)
    OR coordinator_id = agencyos_private.current_coordinator_id(organization_id)
  );

-- PARTNER GUEST CONTACTS: Strictly owned by partner_substitute_id (or Super Admin)
CREATE POLICY guests_select_scoped ON public.partner_guest_contacts
  FOR SELECT TO authenticated
  USING (
    agencyos_private.is_super_admin(organization_id)
    OR partner_substitute_id = agencyos_private.current_substitute_id(organization_id)
  );

CREATE POLICY guests_write_partner ON public.partner_guest_contacts
  FOR INSERT TO authenticated
  WITH CHECK (
    partner_substitute_id = agencyos_private.current_substitute_id(organization_id)
    AND EXISTS (
      SELECT 1 FROM agencyos_private.current_membership(organization_id)
      WHERE can_manage_network = TRUE
    )
  );

-- REQUESTS: Full request row (with private intro_30_sec) visible ONLY to Admin, owning Coordinator, or CONFIRMED Substitute!
CREATE POLICY requests_select_scoped ON public.requests
  FOR SELECT TO authenticated
  USING (
    agencyos_private.is_super_admin(organization_id)
    OR coordinator_id = agencyos_private.current_coordinator_id(organization_id)
    OR EXISTS (
      SELECT 1 FROM public.assignments a
      WHERE a.request_id = requests.id
        AND a.contract_substitute_id = agencyos_private.current_substitute_id(requests.organization_id)
        AND a.status NOT IN ('CANCELLED', 'REPLACED')
    )
  );

-- ASSIGNMENTS: Admin, owning Coordinator, or contracted Substitute
CREATE POLICY assignments_select_scoped ON public.assignments
  FOR SELECT TO authenticated
  USING (
    agencyos_private.is_super_admin(organization_id)
    OR coordinator_id = agencyos_private.current_coordinator_id(organization_id)
    OR contract_substitute_id = agencyos_private.current_substitute_id(organization_id)
  );

-- CLIENT CHARGES & RECEIPTS: Admin or owning Coordinator ONLY (substitutes NEVER see member billing)
CREATE POLICY client_charges_select_scoped ON public.client_charges
  FOR SELECT TO authenticated
  USING (
    agencyos_private.is_super_admin(organization_id)
    OR coordinator_id = agencyos_private.current_coordinator_id(organization_id)
  );

CREATE POLICY client_receipts_select_scoped ON public.client_receipts
  FOR SELECT TO authenticated
  USING (
    agencyos_private.is_super_admin(organization_id)
    OR coordinator_id = agencyos_private.current_coordinator_id(organization_id)
  );

-- SUBSTITUTE EARNINGS & PAYOUTS: Admin, owning Coordinator, or own Payee Substitute ONLY
CREATE POLICY substitute_earnings_select_scoped ON public.substitute_earnings
  FOR SELECT TO authenticated
  USING (
    agencyos_private.is_super_admin(organization_id)
    OR coordinator_id = agencyos_private.current_coordinator_id(organization_id)
    OR payee_substitute_id = agencyos_private.current_substitute_id(organization_id)
  );

CREATE POLICY freelancer_payouts_select_scoped ON public.freelancer_payouts
  FOR SELECT TO authenticated
  USING (
    agencyos_private.is_super_admin(organization_id)
    OR coordinator_id = agencyos_private.current_coordinator_id(organization_id)
    OR payee_substitute_id = agencyos_private.current_substitute_id(organization_id)
  );

-- NOTIFICATIONS: Recipient user only
CREATE POLICY notifications_select_self ON public.notifications
  FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid());

-- =============================================================================
-- TRANSACTIONAL RPC: ATOMIC FIRST-ELIGIBLE CONFIRM (Row-level FOR UPDATE lock)
-- =============================================================================
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
BEGIN
  -- Lock request row to prevent simultaneous race conditions (AT-05)
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

  SELECT COUNT(*) INTO v_filled FROM public.assignments
  WHERE request_id = v_req.id AND status NOT IN ('CANCELLED', 'REPLACED', 'NO_SHOW');
  IF v_filled >= v_req.positions_required THEN
    RAISE EXCEPTION 'All positions already filled';
  END IF;

  INSERT INTO public.assignments (
    organization_id, request_id, coordinator_id, going_for_member_id, slot_index,
    contract_substitute_id, payee_substitute_id, actual_attendee_name,
    is_delegated, delegation_status, member_fee, agreed_payout, status
  ) VALUES (
    v_req.organization_id, v_req.id, v_req.coordinator_id, v_req.going_for_member_id, v_filled + 1,
    v_sub.id, v_sub.id, v_prof.display_name,
    FALSE, 'NONE', v_req.member_fee, v_req.offered_payout, 'CONFIRMED'
  ) RETURNING id INTO v_asgn_id;

  IF v_filled + 1 >= v_req.positions_required THEN
    UPDATE public.requests SET status = 'CONFIRMED', updated_at = now() WHERE id = v_req.id;
  END IF;

  RETURN v_asgn_id;
END;
$$;

-- =============================================================================
-- TRANSACTIONAL RPC: ATOMIC IDEMPOTENT FINISH + 1:1 RECEIVABLE & PAYABLE POSTING
-- =============================================================================
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
  v_sub_id UUID;
  v_charge_id UUID;
  v_earning_id UUID;
BEGIN
  SELECT * INTO v_asgn FROM public.assignments WHERE id = p_assignment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assignment not found'; END IF;

  v_sub_id := agencyos_private.current_substitute_id(v_asgn.organization_id);
  IF v_sub_id IS NULL OR v_sub_id <> v_asgn.contract_substitute_id THEN
    IF NOT agencyos_private.is_super_admin(v_asgn.organization_id) THEN
      RAISE EXCEPTION 'Only contracted substitute or partner may finish this assignment';
    END IF;
  END IF;

  -- Idempotent replay check (AT-11): zero duplicate charges or earnings
  SELECT id INTO v_charge_id FROM public.client_charges WHERE assignment_id = v_asgn.id;
  SELECT id INTO v_earning_id FROM public.substitute_earnings WHERE assignment_id = v_asgn.id;
  IF v_charge_id IS NOT NULL AND v_earning_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'assignment_id', v_asgn.id,
      'client_charge_id', v_charge_id,
      'substitute_earning_id', v_earning_id,
      'idempotent_replay', TRUE
    );
  END IF;

  UPDATE public.assignments
  SET status = 'COMPLETED_SELF_REPORTED',
      finished_at = now(),
      finish_idempotency_key = p_idempotency_key,
      finished_by_user_id = auth.uid(),
      finished_reported_by_partner = v_asgn.is_delegated,
      meeting_notes = p_notes,
      updated_at = now()
  WHERE id = v_asgn.id;

  INSERT INTO public.client_charges (organization_id, assignment_id, coordinator_id, member_id, amount)
  VALUES (v_asgn.organization_id, v_asgn.id, v_asgn.coordinator_id, v_asgn.going_for_member_id, v_asgn.member_fee)
  RETURNING id INTO v_charge_id;

  INSERT INTO public.substitute_earnings (organization_id, assignment_id, coordinator_id, payee_substitute_id, amount)
  VALUES (v_asgn.organization_id, v_asgn.id, v_asgn.coordinator_id, v_asgn.payee_substitute_id, v_asgn.agreed_payout)
  RETURNING id INTO v_earning_id;

  RETURN jsonb_build_object(
    'assignment_id', v_asgn.id,
    'client_charge_id', v_charge_id,
    'substitute_earning_id', v_earning_id,
    'idempotent_replay', FALSE
  );
END;
$$;
