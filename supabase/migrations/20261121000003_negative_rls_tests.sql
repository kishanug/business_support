-- =============================================================================
-- AgencyOS V1 — Negative Authorization & RLS Verification Script (Section 13.3)
-- Run against a staging Supabase PostgreSQL instance after applying migrations 001 & 002.
-- =============================================================================

BEGIN;

-- Test 1: Coordinator A attempting to SELECT Coordinator B's private member row must return 0 rows.
-- SET LOCAL ROLE authenticated;
-- SELECT set_config('request.jwt.claim.sub', '<COORDINATOR_A_UID>', true);
-- ASSERT (SELECT count(*) FROM public.members WHERE id = '<COORDINATOR_B_MEMBER_ID>') = 0;

-- Test 2: Substitute A attempting to SELECT Substitute B's earnings or guest contacts must return 0 rows.
-- SELECT set_config('request.jwt.claim.sub', '<SUBSTITUTE_A_UID>', true);
-- ASSERT (SELECT count(*) FROM public.substitute_earnings WHERE payee_substitute_id = '<SUBSTITUTE_B_ID>') = 0;
-- ASSERT (SELECT count(*) FROM public.partner_guest_contacts WHERE partner_substitute_id = '<SUBSTITUTE_B_ID>') = 0;

-- Test 3: Unconfirmed Substitute attempting to SELECT private member 30-sec intro directly from public.requests must return 0 rows.
-- SELECT set_config('request.jwt.claim.sub', '<UNCONFIRMED_SUB_UID>', true);
-- ASSERT (SELECT count(*) FROM public.requests WHERE id = '<OPEN_REQUEST_ID>') = 0;

-- Test 4: Anonymous (Guest with no auth account) attempting to read public.members or public.requests must be denied.
-- SET LOCAL ROLE anon;
-- ASSERT (SELECT count(*) FROM public.members) = 0;

-- Test 5: Deactivated user (profiles.active = FALSE) with existing JWT must return 0 rows from protected tables.
-- UPDATE public.profiles SET active = FALSE WHERE id = '<COORDINATOR_A_UID>';
-- SET LOCAL ROLE authenticated;
-- SELECT set_config('request.jwt.claim.sub', '<COORDINATOR_A_UID>', true);
-- ASSERT (SELECT count(*) FROM public.members) = 0;

ROLLBACK;
