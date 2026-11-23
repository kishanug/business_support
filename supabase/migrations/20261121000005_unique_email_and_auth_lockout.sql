-- =============================================================================
-- AgencyOS V1 — Unique Login Email Enforcement, Auth Lockout Tracking &
--               Single-Owner Super Admin Guard (Migration 005 — Additive Only)
-- =============================================================================

-- 1. Enforce case-insensitive unique emails on profiles (if email column added)
--    Note: Supabase auth.users already enforces unique email; this hardens public mirror tables.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_lower_email
  ON public.profiles (LOWER(BTRIM(email)))
  WHERE email IS NOT NULL AND BTRIM(email) <> '';

-- 2. Enforce strictly ONE active SUPER_ADMIN membership per organization
--    (owner-locked to kishanus03@gmail.com at provisioning time)
CREATE UNIQUE INDEX IF NOT EXISTS uq_single_active_super_admin_per_org
  ON public.role_memberships (organization_id)
  WHERE role = 'SUPER_ADMIN' AND active = TRUE;

-- 3. Server-side password attempt & 15-minute lockout ledger (private schema — zero public API exposure)
CREATE TABLE IF NOT EXISTS agencyos_private.auth_login_attempts (
  normalized_email TEXT PRIMARY KEY,
  failed_count INT NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  first_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Hashed one-time Super Admin password reset tokens (15-min TTL, max 5 verify attempts)
CREATE TABLE IF NOT EXISTS agencyos_private.password_reset_tokens (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE RESTRICT,
  token_sha256 TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  failed_verify_attempts INT NOT NULL DEFAULT 0 CHECK (failed_verify_attempts >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
