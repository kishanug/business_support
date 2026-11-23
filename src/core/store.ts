import crypto from 'node:crypto';
import type {
  Assignment,
  AssignmentMode,
  AuditEvent,
  Chapter,
  CheckinType,
  ClientCharge,
  ClientReceipt,
  Coordinator,
  CoordinatorCommission,
  FreelancerPayout,
  Location,
  MeetingReportNotes,
  MeetingRequest,
  Member,
  MemberNoteType,
  MessageDeliveryState,
  MessageLog,
  Namespace,
  PartnerGuestContact,
  PaymentMethod,
  PayoutAllocation,
  PublicOpenRequestCard,
  ReceiptAllocation,
  ReceivedFromType,
  RequestResponse,
  ResponseType,
  Role,
  SessionUser,
  Substitute,
  SubstituteEarning,
  UserAccount,
} from './types.ts';
import {
  computeFinanceSummary,
  computeMilestoneProgress,
  formatShortDate,
  getMemberNoteTypeLabel,
  getTomorrowInKolkata,
  MILESTONE_TARGETS,
  resolveRequestAutoFill,
} from './rules.ts';
import {
  createDemoDataset,
  createEmptyDataset,
  type DomainDataset,
  hashPassword,
  verifyPassword,
} from './seed.ts';

export const DEFAULT_SUPER_ADMIN_EMAIL = 'kishanus03@gmail.com';
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
export const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const MAX_RESET_VERIFY_ATTEMPTS = 5;
export const MAX_RESET_REQUESTS_PER_WINDOW = 5;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string {
  return (raw || '').trim().toLowerCase();
}

function hashResetCode(code: string): string {
  return crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

function timingSafeHexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

interface LoginAttemptRecord {
  count: number;
  lockedUntil: number;
  firstAttemptAt: number;
}

interface ResetRequestRateRecord {
  count: number;
  windowStart: number;
}

export class DomainError extends Error {
  status: number;
  code: string;
  retryAfterSeconds?: number;
  constructor(status: number, code: string, message: string, retryAfterSeconds?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface AgencyStoreOptions {
  superAdminEmail?: string;
  superAdminPassword?: string;
}

export class AgencyStore {
  private datasets: Record<Namespace, DomainDataset>;
  private activeLocks = new Set<string>();
  private loginAttempts = new Map<string, LoginAttemptRecord>();
  private resetRequestRates = new Map<string, ResetRequestRateRecord>();
  private referenceDateProvider: () => Date;
  private superAdminEmail: string;

  constructor(
    referenceDateProvider: () => Date = () => new Date(),
    options: AgencyStoreOptions = {}
  ) {
    this.referenceDateProvider = referenceDateProvider;
    const configuredEmail = normalizeEmail(
      options.superAdminEmail ?? process.env.SUPER_ADMIN_EMAIL ?? DEFAULT_SUPER_ADMIN_EMAIL
    );
    this.superAdminEmail = EMAIL_REGEX.test(configuredEmail)
      ? configuredEmail
      : DEFAULT_SUPER_ADMIN_EMAIL;

    this.datasets = {
      demo: createDemoDataset(referenceDateProvider()),
      workspace: createEmptyDataset(),
    };

    const initialAdminPassword =
      options.superAdminPassword !== undefined
        ? options.superAdminPassword
        : process.env.SUPER_ADMIN_PASSWORD;
    const prehashedHash =
      options.superAdminPassword === undefined ? process.env.SUPER_ADMIN_PASSWORD_HASH : undefined;
    const prehashedSalt =
      options.superAdminPassword === undefined ? process.env.SUPER_ADMIN_PASSWORD_SALT : undefined;
    this.ensureLockedWorkspaceSuperAdmin(initialAdminPassword, prehashedHash, prehashedSalt);
  }

  private ensureLockedWorkspaceSuperAdmin(
    initialPassword?: string,
    prehashedHash?: string,
    prehashedSalt?: string
  ): void {
    const data = this.datasets.workspace;
    if (data.users.some((u) => u.role === 'SUPER_ADMIN')) return;

    const now = this.now();
    const hasPlainPw = Boolean(initialPassword && initialPassword.length >= 8);
    const hasPrehashed = Boolean(
      !hasPlainPw && prehashedHash && prehashedSalt && prehashedHash.length >= 64 && prehashedSalt.length >= 16
    );
    const hasConfiguredPw = hasPlainPw || hasPrehashed;

    let hash: string;
    let salt: string;
    if (hasPlainPw) {
      const hashed = hashPassword(initialPassword!);
      hash = hashed.hash;
      salt = hashed.salt;
    } else if (hasPrehashed) {
      hash = prehashedHash!.trim();
      salt = prehashedSalt!.trim();
    } else {
      const hashed = hashPassword(crypto.randomBytes(32).toString('hex'));
      hash = hashed.hash;
      salt = hashed.salt;
    }

    const userId = 'usr-ws-superadmin';
    const coordId = 'coord-ws-superadmin';

    data.users.push({
      id: userId,
      namespace: 'workspace',
      email: this.superAdminEmail,
      passwordHash: hash,
      passwordSalt: salt,
      displayName: 'Kishan',
      role: 'SUPER_ADMIN',
      coordinatorId: coordId,
      canManageNetwork: false,
      active: true,
      passwordConfigured: hasConfiguredPw,
      createdAt: now,
    });

    data.coordinators.push({
      id: coordId,
      namespace: 'workspace',
      userId,
      name: 'Kishan',
      email: this.superAdminEmail,
      callingPhone: '9820000001',
      whatsappPhone: '9820000001',
      region: 'Mumbai HQ',
      isSuperAdmin: true,
      defaultMemberFee: 500,
      defaultSubstitutePayout: 350,
      active: true,
      createdAt: now,
    });
  }

  public getSuperAdminEmail(): string {
    return this.superAdminEmail;
  }

  public isSuperAdminPasswordConfigured(): boolean {
    const admin = this.ds('workspace').users.find(
      (u) => u.role === 'SUPER_ADMIN' && u.email.toLowerCase() === this.superAdminEmail
    );
    return Boolean(admin?.passwordConfigured);
  }

  private assertEmailUnique(namespace: Namespace, rawEmail: string, excludeUserId?: string): string {
    const email = normalizeEmail(rawEmail);
    if (!email || !EMAIL_REGEX.test(email)) {
      throw new DomainError(400, 'INVALID_EMAIL', 'Please enter a valid email address.');
    }
    const data = this.ds(namespace);
    const conflictUser = data.users.find(
      (u) => u.id !== excludeUserId && normalizeEmail(u.email) === email
    );
    const conflictCoord = data.coordinators.find(
      (c) => c.userId !== excludeUserId && normalizeEmail(c.email) === email
    );
    const conflictSub = data.substitutes.find(
      (s) => s.userId !== excludeUserId && normalizeEmail(s.email) === email
    );
    if (conflictUser || conflictCoord || conflictSub) {
      throw new DomainError(
        409,
        'EMAIL_EXISTS',
        `The email address "${email}" is already in use by another account. Each account must use a unique login email.`
      );
    }
    if (email === this.superAdminEmail) {
      const ownUser = excludeUserId
        ? data.users.find((u) => u.id === excludeUserId && u.role === 'SUPER_ADMIN')
        : undefined;
      if (!ownUser) {
        throw new DomainError(
          409,
          'EMAIL_RESERVED',
          'This email address is reserved exclusively for the Super Admin account.'
        );
      }
    }
    return email;
  }

  private clearLoginAttempts(namespace: Namespace, email: string): void {
    this.loginAttempts.delete(`${namespace}:${normalizeEmail(email)}`);
  }

  public resetDemo(): void {
    this.datasets.demo = createDemoDataset(this.referenceDateProvider());
  }

  public resetDemoAuthorized(actor: SessionUser): void {
    this.assertRole(actor, ['SUPER_ADMIN']);
    if (actor.namespace !== 'demo') {
      throw new DomainError(403, 'FORBIDDEN', 'Demo reset is only available in the isolated Demo sandbox.');
    }
    this.resetDemo();
    this.logAudit(actor, 'DEMO_DATA_RESET', 'system', 'demo', 'Super Admin reset Demo sandbox to clean initial dataset');
  }

  public clearTestingTransactions(actor: SessionUser): { clearedRequests: number; clearedAssignments: number } {
    this.assertRole(actor, ['SUPER_ADMIN']);
    const data = this.ds(actor.namespace);
    const clearedRequests = data.requests.length;
    const clearedAssignments = data.assignments.length;
    data.requests = [];
    data.responses = [];
    data.assignments = [];
    data.checkins = [];
    data.clientCharges = [];
    data.substituteEarnings = [];
    data.coordinatorCommissions = [];
    data.clientReceipts = [];
    data.freelancerPayouts = [];
    data.appreciationBonuses = [];
    data.ledgerAdjustments = [];
    data.milestoneRewards = [];
    data.notifications = [];
    data.messageLogs = [];
    data.nextRequestNumber = 1;
    this.logAudit(
      actor,
      'TESTING_TRANSACTIONS_CLEARED',
      'system',
      actor.namespace,
      `Super Admin cleared transactional test data (${clearedRequests} requests, ${clearedAssignments} assignments) while preserving masters & accounts`
    );
    return { clearedRequests, clearedAssignments };
  }

  private ds(ns: Namespace): DomainDataset {
    return this.datasets[ns];
  }

  private now(): string {
    return this.referenceDateProvider().toISOString();
  }

  private id(prefix: string): string {
    return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
  }

  /**
   * Re-verifies actor status on every operation so deactivated users are immediately denied (AT-22).
   */
  public resolveActiveActor(namespace: Namespace, userId: string): SessionUser {
    const user = this.ds(namespace).users.find((u) => u.id === userId);
    if (!user) {
      throw new DomainError(401, 'UNAUTHORIZED', 'Session user no longer exists.');
    }
    if (!user.active) {
      throw new DomainError(403, 'ACCOUNT_DEACTIVATED', 'Account has been deactivated by an administrator.');
    }
    const sub = user.substituteId
      ? this.ds(namespace).substitutes.find((s) => s.id === user.substituteId)
      : undefined;
    return {
      id: user.id,
      namespace: user.namespace,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      coordinatorId: user.coordinatorId,
      substituteId: user.substituteId,
      canManageNetwork: Boolean(sub?.canManageNetwork ?? user.canManageNetwork),
      active: user.active,
    };
  }

  private assertRole(actor: SessionUser, roles: Role[]): void {
    if (!roles.includes(actor.role)) {
      throw new DomainError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
    }
  }

  private canAccessCoordinatorScope(actor: SessionUser, coordinatorId?: string): boolean {
    if (actor.role === 'SUPER_ADMIN') return true;
    if (actor.role === 'EXTERNAL_COORDINATOR') {
      return Boolean(coordinatorId && actor.coordinatorId === coordinatorId);
    }
    return false;
  }

  private logAudit(
    actor: SessionUser,
    action: string,
    entityType: string,
    entityId: string,
    summary: string,
    coordinatorId?: string,
    reason?: string
  ): void {
    const event: AuditEvent = {
      id: this.id('aud'),
      namespace: actor.namespace,
      coordinatorId: coordinatorId ?? actor.coordinatorId,
      actorUserId: actor.id,
      actorName: actor.displayName,
      action,
      entityType,
      entityId,
      summary,
      reason,
      createdAt: this.now(),
    };
    this.ds(actor.namespace).auditEvents.unshift(event);
  }

  private pushNotification(
    ns: Namespace,
    recipientUserId: string,
    title: string,
    body: string,
    category: 'REQUEST' | 'ASSIGNMENT' | 'CHECKIN' | 'FINANCE' | 'DISPUTE' | 'MILESTONE' | 'ISSUE',
    relatedId?: string
  ): void {
    this.ds(ns).notifications.unshift({
      id: this.id('notif'),
      namespace: ns,
      recipientUserId,
      title,
      body,
      category,
      read: false,
      relatedId,
      createdAt: this.now(),
    });
  }

  // ==================== AUTHENTICATION & INVITE FLOWS ====================

  public hasWorkspaceAdmin(): boolean {
    return this.ds('workspace').users.some((u) => u.role === 'SUPER_ADMIN' && u.active);
  }

  /**
   * Public Super Admin signup from the Login page is permanently disabled.
   * Only the sole authorized Super Admin email (kishanus03@gmail.com) may hold Super Admin access
   * and reset their password via SMTP email.
   */
  public bootstrapWorkspaceAdmin(_input: {
    email: string;
    password: string;
    displayName: string;
    callingPhone: string;
    whatsappPhone?: string;
  }): SessionUser {
    throw new DomainError(
      403,
      'PUBLIC_ADMIN_SIGNUP_DISABLED',
      `Public Super Admin signup is disabled. Only ${this.superAdminEmail} is authorized as Super Admin and may set or reset their password via email.`
    );
  }

  /**
   * Namespace-scoped password sign-in with strict 5-attempt / 15-minute lockout protection.
   */
  public loginWithPassword(namespace: Namespace, email: string, password: string): SessionUser {
    const normalized = normalizeEmail(email);
    const nowMs = this.referenceDateProvider().getTime();
    const attemptKey = `${namespace}:${normalized}`;
    const existingRecord = this.loginAttempts.get(attemptKey);

    if (existingRecord && existingRecord.lockedUntil > nowMs) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existingRecord.lockedUntil - nowMs) / 1000));
      const minsLeft = Math.max(1, Math.ceil(retryAfterSeconds / 60));
      throw new DomainError(
        429,
        'ACCOUNT_LOCKED',
        `Too many invalid password attempts. Login is temporarily locked for ${minsLeft} more minute${minsLeft === 1 ? '' : 's'}.`,
        retryAfterSeconds
      );
    }

    // Clear expired lockout window
    if (existingRecord && existingRecord.lockedUntil > 0 && existingRecord.lockedUntil <= nowMs) {
      this.loginAttempts.delete(attemptKey);
    }

    const user = this.ds(namespace).users.find((u) => normalizeEmail(u.email) === normalized);
    const validPassword =
      Boolean(user) &&
      user!.passwordConfigured !== false &&
      verifyPassword(password, user!.passwordHash, user!.passwordSalt);

    if (!user || !validPassword) {
      const current = this.loginAttempts.get(attemptKey);
      const withinWindow = current && nowMs - current.firstAttemptAt < LOGIN_LOCKOUT_MS;
      const nextCount = withinWindow ? current.count + 1 : 1;

      if (nextCount >= MAX_FAILED_LOGIN_ATTEMPTS) {
        this.loginAttempts.set(attemptKey, {
          count: nextCount,
          lockedUntil: nowMs + LOGIN_LOCKOUT_MS,
          firstAttemptAt: withinWindow ? current.firstAttemptAt : nowMs,
        });
        const retryAfterSeconds = Math.ceil(LOGIN_LOCKOUT_MS / 1000);
        throw new DomainError(
          429,
          'ACCOUNT_LOCKED',
          'Too many invalid password attempts (5 of 5). Login is locked for 15 minutes.',
          retryAfterSeconds
        );
      }

      this.loginAttempts.set(attemptKey, {
        count: nextCount,
        lockedUntil: 0,
        firstAttemptAt: withinWindow ? current.firstAttemptAt : nowMs,
      });
      const remaining = MAX_FAILED_LOGIN_ATTEMPTS - nextCount;
      throw new DomainError(
        401,
        'INVALID_CREDENTIALS',
        `Invalid email or password. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before a 15-minute lockout.`
      );
    }

    if (!user.active) {
      throw new DomainError(403, 'ACCOUNT_DEACTIVATED', 'This account has been deactivated.');
    }

    this.loginAttempts.delete(attemptKey);
    return this.resolveActiveActor(namespace, user.id);
  }

  /**
   * Production/workspace invite-only sign-in. Role is strictly derived from backend user membership.
   */
  public loginWorkspace(email: string, password: string): SessionUser {
    return this.loginWithPassword('workspace', email, password);
  }

  /**
   * Isolated Demo Sandbox login. Never accesses workspace/production records.
   */
  public loginDemo(roleKey: 'SA' | 'EC' | 'SUB'): SessionUser {
    const map: Record<'SA' | 'EC' | 'SUB', string> = {
      SA: 'usr-sa-1',
      EC: 'usr-ec-1',
      SUB: 'usr-sub-surya',
    };
    const userId = map[roleKey];
    if (!userId) {
      throw new DomainError(400, 'INVALID_DEMO_ROLE', 'Unsupported demo role.');
    }
    return this.resolveActiveActor('demo', userId);
  }

  /**
   * Self-service password reset is restricted STRICTLY to the sole Super Admin email.
   * Never returns the reset code to untrusted clients; server.ts delivers it via SMTP email only.
   */
  public requestSuperAdminPasswordReset(email: string): {
    shouldSendEmail: boolean;
    toEmail?: string;
    resetCode?: string;
    expiresMinutes: number;
    message: string;
  } {
    const normalized = normalizeEmail(email);
    if (!normalized || !EMAIL_REGEX.test(normalized)) {
      throw new DomainError(400, 'INVALID_EMAIL', 'Enter a valid email address.');
    }

    const nowMs = this.referenceDateProvider().getTime();
    const rate = this.resetRequestRates.get(normalized);
    if (rate && nowMs - rate.windowStart < LOGIN_LOCKOUT_MS) {
      if (rate.count >= MAX_RESET_REQUESTS_PER_WINDOW) {
        const retryAfterSeconds = Math.max(1, Math.ceil((rate.windowStart + LOGIN_LOCKOUT_MS - nowMs) / 1000));
        throw new DomainError(
          429,
          'TOO_MANY_RESET_REQUESTS',
          'Too many password reset requests. Please wait 15 minutes before trying again.',
          retryAfterSeconds
        );
      }
      rate.count += 1;
    } else {
      this.resetRequestRates.set(normalized, { count: 1, windowStart: nowMs });
    }

    // Only the sole Super Admin email may self-reset via email.
    // External Coordinators & Substitutes must ask the Super Admin to reset their password.
    const admin = this.ds('workspace').users.find(
      (u) =>
        u.role === 'SUPER_ADMIN' &&
        u.active &&
        normalizeEmail(u.email) === this.superAdminEmail &&
        normalizeEmail(u.email) === normalized
    );

    if (!admin) {
      return {
        shouldSendEmail: false,
        expiresMinutes: 15,
        message:
          'If this matches the authorized Super Admin email, a password reset code has been sent. External Coordinators and Substitutes must ask the Super Admin to reset their password.',
      };
    }

    const resetCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    admin.resetTokenHash = hashResetCode(resetCode);
    admin.resetTokenExpiresAt = nowMs + RESET_TOKEN_TTL_MS;
    admin.resetFailedAttempts = 0;
    admin.resetToken = undefined;

    return {
      shouldSendEmail: true,
      toEmail: admin.email,
      resetCode,
      expiresMinutes: 15,
      message: `A 15-minute password reset code has been sent to ${admin.email}.`,
    };
  }

  public rollbackPendingPasswordReset(email: string): void {
    const normalized = normalizeEmail(email);
    const user = this.ds('workspace').users.find((u) => normalizeEmail(u.email) === normalized);
    if (user) {
      user.resetTokenHash = undefined;
      user.resetTokenExpiresAt = undefined;
      user.resetFailedAttempts = 0;
      user.resetToken = undefined;
    }
  }

  public completePasswordReset(email: string, codeOrToken: string, newPassword: string): void {
    if (!newPassword || newPassword.length < 8) {
      throw new DomainError(400, 'WEAK_PASSWORD', 'New password must be at least 8 characters.');
    }
    const normalized = normalizeEmail(email);
    const cleanedCode = (codeOrToken || '').trim();
    if (!cleanedCode) {
      throw new DomainError(400, 'INVALID_TOKEN', 'Enter the verification code sent to your email.');
    }

    const nowMs = this.referenceDateProvider().getTime();
    const user = this.ds('workspace').users.find(
      (u) => normalizeEmail(u.email) === normalized && u.active
    );
    if (!user || (!user.resetTokenHash && !user.resetToken)) {
      throw new DomainError(400, 'INVALID_TOKEN', 'Invalid or expired password reset code.');
    }
    if (user.resetTokenExpiresAt && user.resetTokenExpiresAt < nowMs) {
      user.resetTokenHash = undefined;
      user.resetTokenExpiresAt = undefined;
      user.resetToken = undefined;
      throw new DomainError(400, 'TOKEN_EXPIRED', 'This reset code has expired. Please request a new one.');
    }

    const candidateHash = hashResetCode(cleanedCode);
    const matchesHash = user.resetTokenHash
      ? timingSafeHexEqual(user.resetTokenHash, candidateHash)
      : false;
    const matchesLegacy = user.resetToken ? timingSafeHexEqual(user.resetToken, cleanedCode) : false;

    if (!matchesHash && !matchesLegacy) {
      user.resetFailedAttempts = (user.resetFailedAttempts ?? 0) + 1;
      if (user.resetFailedAttempts >= MAX_RESET_VERIFY_ATTEMPTS) {
        user.resetTokenHash = undefined;
        user.resetTokenExpiresAt = undefined;
        user.resetToken = undefined;
        user.resetFailedAttempts = 0;
        throw new DomainError(
          429,
          'RESET_CODE_INVALIDATED',
          'Too many invalid reset code attempts. This code has been invalidated; please request a new one.'
        );
      }
      const left = MAX_RESET_VERIFY_ATTEMPTS - user.resetFailedAttempts;
      throw new DomainError(
        400,
        'INVALID_TOKEN',
        `Invalid password reset code. ${left} attempt${left === 1 ? '' : 's'} remaining.`
      );
    }

    const { hash, salt } = hashPassword(newPassword);
    user.passwordHash = hash;
    user.passwordSalt = salt;
    user.passwordConfigured = true;
    user.resetTokenHash = undefined;
    user.resetTokenExpiresAt = undefined;
    user.resetToken = undefined;
    user.resetFailedAttempts = 0;
    this.clearLoginAttempts('workspace', user.email);

    const actor = this.resolveActiveActor('workspace', user.id);
    this.logAudit(
      actor,
      user.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN_PASSWORD_RESET_VIA_EMAIL' : 'USER_PASSWORD_RESET_WITH_TOKEN',
      'user',
      user.id,
      `Password updated securely for ${user.displayName} (${user.email})`
    );
  }

  public inviteUser(
    actor: SessionUser,
    input: {
      email: string;
      displayName: string;
      role: 'EXTERNAL_COORDINATOR' | 'SUBSTITUTE';
      phone: string;
      whatsappPhone?: string;
      regionOrArea?: string;
      defaultPayout?: number;
      canManageNetwork?: boolean;
      introducedByCoordinatorId?: string;
      initialPassword?: string;
      showOnLogin?: boolean;
    }
  ): { userId: string; inviteToken?: string; passwordConfigured: boolean } {
    this.assertRole(actor, ['SUPER_ADMIN']);
    const data = this.ds(actor.namespace);
    const email = this.assertEmailUnique(actor.namespace, input.email);

    let passwordHash: string;
    let passwordSalt: string;
    let inviteToken: string | undefined;
    let passwordConfigured = false;

    if (input.initialPassword !== undefined && input.initialPassword.trim().length > 0) {
      if (input.initialPassword.length < 8) {
        throw new DomainError(400, 'WEAK_PASSWORD', 'Initial password must be at least 8 characters.');
      }
      const hashed = hashPassword(input.initialPassword);
      passwordHash = hashed.hash;
      passwordSalt = hashed.salt;
      passwordConfigured = true;
    } else {
      inviteToken = crypto.randomBytes(12).toString('hex');
      const tempRandom = crypto.randomBytes(24).toString('hex');
      const hashed = hashPassword(tempRandom);
      passwordHash = hashed.hash;
      passwordSalt = hashed.salt;
    }

    const userId = this.id('usr');
    const now = this.now();

    let coordinatorId: string | undefined;
    let substituteId: string | undefined;

    if (input.role === 'EXTERNAL_COORDINATOR') {
      coordinatorId = this.id('coord');
      data.coordinators.push({
        id: coordinatorId,
        namespace: actor.namespace,
        userId,
        name: input.displayName.trim(),
        email,
        callingPhone: input.phone.trim(),
        whatsappPhone: (input.whatsappPhone || input.phone).trim(),
        region: input.regionOrArea?.trim() || 'Assigned Zone',
        isSuperAdmin: false,
        defaultMemberFee: 500,
        defaultSubstitutePayout: 350,
        active: true,
        createdAt: now,
      });
    } else {
      substituteId = this.id('sub');
      data.substitutes.push({
        id: substituteId,
        namespace: actor.namespace,
        userId,
        name: input.displayName.trim(),
        email,
        phone: input.phone.trim(),
        whatsappPhone: (input.whatsappPhone || input.phone).trim(),
        homeArea: input.regionOrArea?.trim() || 'Mumbai',
        preferredAreas: [input.regionOrArea?.trim() || 'Mumbai'],
        preferredChapterIds: [],
        defaultPayout: input.defaultPayout ?? 350,
        availability: 'AVAILABLE',
        canManageNetwork: Boolean(input.canManageNetwork),
        emergencyConsent: false,
        notes: 'Created via AgencyOS Super Admin',
        introducedByCoordinatorId: input.introducedByCoordinatorId || undefined,
        verified: false,
        active: true,
        createdAt: now,
      });
    }

    data.users.push({
      id: userId,
      namespace: actor.namespace,
      email,
      passwordHash,
      passwordSalt,
      displayName: input.displayName.trim(),
      role: input.role,
      coordinatorId,
      substituteId,
      canManageNetwork: Boolean(input.canManageNetwork),
      active: true,
      invitedBy: actor.id,
      inviteToken,
      passwordConfigured,
      showOnLogin: Boolean(input.showOnLogin),
      createdAt: now,
    });

    this.logAudit(
      actor,
      passwordConfigured ? 'USER_CREATED_WITH_PASSWORD' : 'USER_INVITED',
      'user',
      userId,
      `${passwordConfigured ? 'Created account' : 'Invited'} ${input.displayName} (${input.role}) — ${email}`
    );
    return { userId, inviteToken, passwordConfigured };
  }

  public adminResetUserPassword(
    actor: SessionUser,
    targetUserId: string,
    newPassword?: string
  ): { userId: string; email: string; resetToken?: string; passwordUpdated: boolean } {
    this.assertRole(actor, ['SUPER_ADMIN']);
    const data = this.ds(actor.namespace);
    const user = data.users.find((u) => u.id === targetUserId);
    if (!user) throw new DomainError(404, 'NOT_FOUND', 'Target user account not found.');

    if (newPassword !== undefined && newPassword.trim().length > 0) {
      if (newPassword.length < 8) {
        throw new DomainError(400, 'WEAK_PASSWORD', 'New password must be at least 8 characters.');
      }
      const { hash, salt } = hashPassword(newPassword);
      user.passwordHash = hash;
      user.passwordSalt = salt;
      user.passwordConfigured = true;
      user.resetToken = undefined;
      user.resetTokenHash = undefined;
      user.resetTokenExpiresAt = undefined;
      user.resetFailedAttempts = 0;
      user.inviteToken = undefined;
      this.clearLoginAttempts(actor.namespace, user.email);
      this.logAudit(
        actor,
        'ADMIN_PASSWORD_RESET',
        'user',
        user.id,
        `Super Admin set a new hashed password for ${user.displayName} (${user.role})`
      );
      return { userId: user.id, email: user.email, passwordUpdated: true };
    }

    const resetToken = crypto.randomBytes(6).toString('hex').toUpperCase();
    user.resetTokenHash = hashResetCode(resetToken);
    user.resetTokenExpiresAt = this.referenceDateProvider().getTime() + RESET_TOKEN_TTL_MS;
    user.resetFailedAttempts = 0;
    user.resetToken = undefined;
    this.clearLoginAttempts(actor.namespace, user.email);
    this.logAudit(
      actor,
      'ADMIN_PASSWORD_RESET_TOKEN',
      'user',
      user.id,
      `Super Admin generated a 15-minute password reset code for ${user.displayName} (${user.role})`
    );
    return { userId: user.id, email: user.email, resetToken, passwordUpdated: false };
  }

  public deleteEntity(
    actor: SessionUser,
    entityType: 'member' | 'substitute' | 'request' | 'chapter' | 'location',
    entityId: string
  ): { deleted: boolean; entityType: string; entityId: string } {
    this.assertRole(actor, ['SUPER_ADMIN']);
    const data = this.ds(actor.namespace);

    if (entityType === 'request') {
      const idx = data.requests.findIndex((r) => r.id === entityId);
      if (idx === -1) throw new DomainError(404, 'NOT_FOUND', 'Request not found.');
      const req = data.requests[idx];
      const relAsgnIds = new Set(data.assignments.filter((a) => a.requestId === entityId).map((a) => a.id));
      data.requests.splice(idx, 1);
      data.responses = data.responses.filter((r) => r.requestId !== entityId);
      data.assignments = data.assignments.filter((a) => a.requestId !== entityId);
      data.checkins = data.checkins.filter((c) => !relAsgnIds.has(c.assignmentId));
      data.clientCharges = data.clientCharges.filter((c) => c.requestId !== entityId);
      data.substituteEarnings = data.substituteEarnings.filter((e) => e.requestId !== entityId);
      data.coordinatorCommissions = data.coordinatorCommissions.filter((c) => c.requestId !== entityId);
      this.logAudit(
        actor,
        'REQUEST_DELETED',
        'request',
        entityId,
        `Super Admin deleted request #${req.requestNumber} (${req.memberNameSnapshot} · ${req.chapterNameSnapshot})`
      );
      return { deleted: true, entityType, entityId };
    }

    if (entityType === 'member') {
      const idx = data.members.findIndex((m) => m.id === entityId);
      if (idx === -1) throw new DomainError(404, 'NOT_FOUND', 'Member not found.');
      const mem = data.members[idx];
      const hasLinkedRequests = data.requests.some((r) => r.goingForMemberId === entityId);
      if (hasLinkedRequests) {
        throw new DomainError(
          409,
          'MEMBER_HAS_REQUESTS',
          `Cannot delete ${mem.name} while linked requests exist. Delete those requests or clear test transactions first.`
        );
      }
      data.members.splice(idx, 1);
      this.logAudit(actor, 'MEMBER_DELETED', 'member', entityId, `Super Admin deleted member ${mem.name}`);
      return { deleted: true, entityType, entityId };
    }

    if (entityType === 'substitute') {
      const idx = data.substitutes.findIndex((s) => s.id === entityId);
      if (idx === -1) throw new DomainError(404, 'NOT_FOUND', 'Substitute not found.');
      const sub = data.substitutes[idx];
      const hasActiveAssignments = data.assignments.some((a) => a.contractSubstituteId === entityId);
      if (hasActiveAssignments) {
        throw new DomainError(
          409,
          'SUBSTITUTE_HAS_ASSIGNMENTS',
          `Cannot delete ${sub.name} while assignment history exists. Deactivate their account or clear test transactions first.`
        );
      }
      data.substitutes.splice(idx, 1);
      data.users = data.users.filter((u) => u.id !== sub.userId);
      data.partnerGuestContacts = data.partnerGuestContacts.filter((g) => g.partnerSubstituteId !== entityId);
      this.logAudit(actor, 'SUBSTITUTE_DELETED', 'substitute', entityId, `Super Admin deleted substitute ${sub.name}`);
      return { deleted: true, entityType, entityId };
    }

    if (entityType === 'chapter') {
      const idx = data.chapters.findIndex((c) => c.id === entityId);
      if (idx === -1) throw new DomainError(404, 'NOT_FOUND', 'Chapter not found.');
      const chap = data.chapters[idx];
      if (data.members.some((m) => m.chapterId === entityId) || data.requests.some((r) => r.chapterId === entityId)) {
        throw new DomainError(409, 'CHAPTER_IN_USE', `Cannot delete ${chap.name} while members or requests reference it.`);
      }
      data.chapters.splice(idx, 1);
      this.logAudit(actor, 'CHAPTER_DELETED', 'chapter', entityId, `Super Admin deleted chapter ${chap.name}`);
      return { deleted: true, entityType, entityId };
    }

    if (entityType === 'location') {
      const idx = data.locations.findIndex((l) => l.id === entityId);
      if (idx === -1) throw new DomainError(404, 'NOT_FOUND', 'Location not found.');
      const loc = data.locations[idx];
      if (data.chapters.some((c) => c.defaultLocationId === entityId)) {
        throw new DomainError(409, 'LOCATION_IN_USE', `Cannot delete ${loc.name} while chapters use it as default venue.`);
      }
      data.locations.splice(idx, 1);
      this.logAudit(actor, 'LOCATION_DELETED', 'location', entityId, `Super Admin deleted venue ${loc.name}`);
      return { deleted: true, entityType, entityId };
    }

    throw new DomainError(400, 'UNSUPPORTED_ENTITY', 'Unsupported entity type.');
  }

  public acceptInvite(email: string, inviteToken: string, password: string): SessionUser {
    if (!password || password.length < 8) {
      throw new DomainError(400, 'WEAK_PASSWORD', 'Password must be at least 8 characters.');
    }
    const normalized = normalizeEmail(email);
    const cleanedToken = (inviteToken || '').trim();
    const user = this.ds('workspace').users.find(
      (u) => normalizeEmail(u.email) === normalized && u.inviteToken && u.inviteToken === cleanedToken
    );
    if (!user) {
      throw new DomainError(400, 'INVALID_INVITE', 'Invalid invitation email or token.');
    }
    const { hash, salt } = hashPassword(password);
    user.passwordHash = hash;
    user.passwordSalt = salt;
    user.passwordConfigured = true;
    user.inviteToken = undefined;
    user.active = true;
    this.clearLoginAttempts('workspace', user.email);
    return this.resolveActiveActor('workspace', user.id);
  }

  public setUserActiveStatus(actor: SessionUser, targetUserId: string, active: boolean): void {
    this.assertRole(actor, ['SUPER_ADMIN']);
    const data = this.ds(actor.namespace);
    const user = data.users.find((u) => u.id === targetUserId);
    if (!user) throw new DomainError(404, 'NOT_FOUND', 'User not found.');
    if (user.id === actor.id && !active) {
      throw new DomainError(400, 'CANNOT_SELF_DEACTIVATE', 'You cannot deactivate your own active session.');
    }
    user.active = active;
    if (user.coordinatorId) {
      const c = data.coordinators.find((x) => x.id === user.coordinatorId);
      if (c) c.active = active;
    }
    if (user.substituteId) {
      const s = data.substitutes.find((x) => x.id === user.substituteId);
      if (s) s.active = active;
    }
    this.logAudit(actor, active ? 'USER_REACTIVATED' : 'USER_DEACTIVATED', 'user', targetUserId, `${active ? 'Activated' : 'Deactivated'} user ${user.displayName}`);
  }

  public setUserShowOnLogin(actor: SessionUser, targetUserId: string, showOnLogin: boolean): void {
    this.assertRole(actor, ['SUPER_ADMIN']);
    const data = this.ds(actor.namespace);
    const user = data.users.find((u) => u.id === targetUserId);
    if (!user) throw new DomainError(404, 'NOT_FOUND', 'User not found.');
    user.showOnLogin = Boolean(showOnLogin);
    this.logAudit(
      actor,
      showOnLogin ? 'LOGIN_QUICKFILL_ENABLED' : 'LOGIN_QUICKFILL_DISABLED',
      'user',
      targetUserId,
      `${showOnLogin ? 'Enabled' : 'Hidden'} login quick-fill entry for ${user.displayName} (${user.email})`
    );
  }

  public getLoginQuickFillAccounts(): Array<{ email: string; displayName: string; role: Role }> {
    const data = this.ds('workspace');
    return data.users
      .filter((u) => u.active && Boolean(u.showOnLogin))
      .map((u) => ({
        email: u.email,
        displayName: u.displayName,
        role: u.role,
      }));
  }

  public getMyProfile(actor: SessionUser) {
    const data = this.ds(actor.namespace);
    const user = data.users.find((u) => u.id === actor.id);
    const coord = actor.coordinatorId ? data.coordinators.find((c) => c.id === actor.coordinatorId) : undefined;
    const sub = actor.substituteId ? data.substitutes.find((s) => s.id === actor.substituteId) : undefined;
    return {
      displayName: user?.displayName ?? actor.displayName,
      email: user?.email ?? actor.email,
      role: actor.role,
      canManageNetwork: actor.canManageNetwork,
      callingPhone: coord?.callingPhone ?? sub?.phone ?? '',
      whatsappPhone: coord?.whatsappPhone ?? sub?.whatsappPhone ?? '',
      region: coord?.region ?? '',
      defaultMemberFee: coord?.defaultMemberFee,
      defaultSubstitutePayout: coord?.defaultSubstitutePayout,
      homeArea: sub?.homeArea ?? '',
      availability: sub?.availability,
      emergencyConsent: sub?.emergencyConsent,
      emergencyContactName: sub?.emergencyContactName ?? '',
      emergencyContactPhone: sub?.emergencyContactPhone ?? '',
      upiReference: sub?.upiReference ?? '',
    };
  }

  public updateMyProfile(
    actor: SessionUser,
    input: {
      displayName?: string;
      callingPhone?: string;
      whatsappPhone?: string;
      region?: string;
      defaultMemberFee?: number;
      defaultSubstitutePayout?: number;
      homeArea?: string;
      availability?: 'AVAILABLE' | 'LIMITED' | 'UNAVAILABLE';
      emergencyConsent?: boolean;
      emergencyContactName?: string;
      emergencyContactPhone?: string;
      upiReference?: string;
    }
  ) {
    const data = this.ds(actor.namespace);
    const user = data.users.find((u) => u.id === actor.id);
    if (!user) throw new DomainError(404, 'NOT_FOUND', 'User account not found.');

    if (input.displayName !== undefined) {
      const trimmed = String(input.displayName).trim();
      if (trimmed.length < 2) {
        throw new DomainError(400, 'VALIDATION_ERROR', 'Display name must be at least 2 characters.');
      }
      user.displayName = trimmed;
    }

    if (actor.coordinatorId) {
      const coord = data.coordinators.find((c) => c.id === actor.coordinatorId);
      if (coord) {
        if (input.displayName !== undefined) coord.name = user.displayName;
        if (input.callingPhone !== undefined) coord.callingPhone = String(input.callingPhone).trim();
        if (input.whatsappPhone !== undefined) coord.whatsappPhone = String(input.whatsappPhone).trim();
        if (input.region !== undefined) coord.region = String(input.region).trim();
        if (input.defaultMemberFee !== undefined) {
          const fee = Number(input.defaultMemberFee);
          if (!Number.isFinite(fee) || fee < 0) {
            throw new DomainError(400, 'VALIDATION_ERROR', 'Default member fee must be zero or a positive amount.');
          }
          coord.defaultMemberFee = Math.round(fee);
        }
        if (input.defaultSubstitutePayout !== undefined) {
          const payout = Number(input.defaultSubstitutePayout);
          if (!Number.isFinite(payout) || payout < 0) {
            throw new DomainError(400, 'VALIDATION_ERROR', 'Default substitute payout must be zero or a positive amount.');
          }
          coord.defaultSubstitutePayout = Math.round(payout);
        }
      }
    }

    if (actor.substituteId) {
      const sub = data.substitutes.find((s) => s.id === actor.substituteId);
      if (sub) {
        if (input.displayName !== undefined) sub.name = user.displayName;
        if (input.callingPhone !== undefined) sub.phone = String(input.callingPhone).trim();
        if (input.whatsappPhone !== undefined) sub.whatsappPhone = String(input.whatsappPhone).trim();
        if (input.homeArea !== undefined) sub.homeArea = String(input.homeArea).trim();
        if (input.availability !== undefined) {
          if (!['AVAILABLE', 'LIMITED', 'UNAVAILABLE'].includes(input.availability)) {
            throw new DomainError(400, 'VALIDATION_ERROR', 'Invalid availability status.');
          }
          sub.availability = input.availability;
        }
        if (input.emergencyConsent !== undefined) {
          sub.emergencyConsent = Boolean(input.emergencyConsent);
        }
        if (input.emergencyContactName !== undefined) {
          sub.emergencyContactName = String(input.emergencyContactName).trim() || undefined;
        }
        if (input.emergencyContactPhone !== undefined) {
          sub.emergencyContactPhone = String(input.emergencyContactPhone).trim() || undefined;
        }
        if (input.upiReference !== undefined) {
          sub.upiReference = String(input.upiReference).trim() || undefined;
        }
      }
    }

    const updatedActor = this.resolveActiveActor(actor.namespace, user.id);
    this.logAudit(updatedActor, 'PROFILE_UPDATED', 'user', user.id, `Updated account profile & preferences for ${user.displayName}`);
    return {
      user: updatedActor,
      profile: this.getMyProfile(updatedActor),
    };
  }

  public changeOwnPassword(actor: SessionUser, currentPassword: string, newPassword: string): void {
    const data = this.ds(actor.namespace);
    const user = data.users.find((u) => u.id === actor.id);
    if (!user) throw new DomainError(404, 'NOT_FOUND', 'User account not found.');
    if (!currentPassword) {
      throw new DomainError(400, 'CURRENT_PASSWORD_REQUIRED', 'Enter your current password to continue.');
    }
    if (!newPassword || newPassword.length < 8) {
      throw new DomainError(400, 'WEAK_PASSWORD', 'New password must be at least 8 characters.');
    }
    if (!user.passwordHash || !user.passwordSalt || !verifyPassword(currentPassword, user.passwordHash, user.passwordSalt)) {
      throw new DomainError(401, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect.');
    }
    if (currentPassword === newPassword) {
      throw new DomainError(400, 'SAME_PASSWORD', 'New password must be different from your current password.');
    }
    const { hash, salt } = hashPassword(newPassword);
    user.passwordHash = hash;
    user.passwordSalt = salt;
    user.passwordConfigured = true;
    user.resetToken = undefined;
    user.resetTokenHash = undefined;
    user.resetTokenExpiresAt = undefined;
    user.resetFailedAttempts = 0;
    this.clearLoginAttempts(actor.namespace, user.email);
    this.logAudit(actor, 'PASSWORD_CHANGED', 'user', user.id, `Updated account password for ${user.displayName}`);
  }

  // ==================== SCOPED READ SNAPSHOT ====================

  public getBootstrapPayload(actor: SessionUser) {
    const data = this.ds(actor.namespace);
    const isAdmin = actor.role === 'SUPER_ADMIN';
    const isCoord = actor.role === 'EXTERNAL_COORDINATOR';
    const isSub = actor.role === 'SUBSTITUTE';

    if (isSub) {
      const meSub = data.substitutes.find((s) => s.id === actor.substituteId);
      const myResponses = data.responses.filter((r) => r.substituteId === actor.substituteId);
      const myAssignments = data.assignments.filter((a) => a.contractSubstituteId === actor.substituteId);
      const myAssignmentRequestIds = new Set(myAssignments.map((a) => a.requestId));

      // Sanitized public open request cards (NO member name, phone, intro, exact address until confirmed!)
      const openRequests: PublicOpenRequestCard[] = data.requests
        .filter((req) => req.status === 'OPEN' || req.status === 'AWAITING_SELECTION')
        .map((req) => {
          const coord = data.coordinators.find((c) => c.id === (req.sourcedViaCoordinatorId || req.coordinatorId));
          const filledPositions = data.assignments.filter(
            (a) => a.requestId === req.id && !['CANCELLED', 'REPLACED', 'NO_SHOW'].includes(a.status)
          ).length;
          const myResp = myResponses.find((r) => r.requestId === req.id);
          const myAsgn = myAssignments.find((a) => a.requestId === req.id && a.status !== 'REPLACED');
          const sameDateOtherSelf = myAssignments.find(
            (a) =>
              a.requestId !== req.id &&
              a.meetingDate === req.meetingDate &&
              !a.isDelegated &&
              !['CANCELLED', 'REPLACED', 'NO_SHOW'].includes(a.status)
          );
          const conflictReq = sameDateOtherSelf
            ? data.requests.find((r) => r.id === sameDateOtherSelf.requestId)
            : undefined;
          return {
            id: req.id,
            requestNumber: req.requestNumber,
            chapterId: req.chapterId,
            chapterName: req.chapterNameSnapshot,
            area: req.areaSnapshot,
            venueName: req.venueNameSnapshot,
            meetingDate: req.meetingDate,
            chapterRegularWeekday: req.chapterRegularWeekday,
            reportingTime: req.reportingTime,
            startTime: req.startTime,
            endTime: req.endTime,
            assignmentMode: req.assignmentMode,
            requireManagerApproval: req.requireManagerApproval,
            allowBids: req.allowBids,
            positionsRequired: req.positionsRequired,
            filledPositions,
            offeredPayout: req.offeredPayout,
            urgency: req.urgency,
            status: req.status,
            specialInstructions: req.specialInstructions,
            coordinatorName: coord?.name ?? 'Agency Coordinator',
            coordinatorCallingPhone: coord?.callingPhone ?? '',
            coordinatorWhatsappPhone: coord?.whatsappPhone ?? '',
            myResponse: myResp,
            myAssignmentId: myAsgn?.id,
            sameDateSelfConflict: sameDateOtherSelf
              ? {
                  assignmentId: sameDateOtherSelf.id,
                  chapterName: conflictReq?.chapterNameSnapshot ?? 'Another Meeting',
                  reportingTime: conflictReq?.reportingTime ?? '',
                }
              : undefined,
          };
        });

      // Confirmed meetings share instructions, venue & coordinator contact ONLY (NEVER member personal/business/contact details)
      const superAdminCoord = data.coordinators.find((c) => c.isSuperAdmin);
      const confirmedBriefings = myAssignments.map((asgn) => {
        const req = data.requests.find((r) => r.id === asgn.requestId);
        const coord = data.coordinators.find((c) => c.id === asgn.coordinatorId) ?? superAdminCoord;
        const viaCoord = data.coordinators.find((c) => c.id === (asgn.assignedViaCoordinatorId || asgn.coordinatorId)) ?? coord;
        return {
          assignment: asgn,
          requestNumber: req?.requestNumber ?? 0,
          chapterName: req?.chapterNameSnapshot ?? '',
          chapterRegularWeekday: req?.chapterRegularWeekday ?? 'Thursday',
          venueName: req?.venueNameSnapshot ?? '',
          area: req?.areaSnapshot ?? '',
          address: req?.addressSnapshot ?? '',
          mapsUrl: req?.mapsUrlSnapshot ?? '',
          directions: req?.directionsSnapshot ?? '',
          reportingTime: req?.reportingTime ?? '',
          startTime: req?.startTime ?? '',
          endTime: req?.endTime ?? '',
          intro30Sec: req?.intro30SecSnapshot ?? '',
          memberNoteType: req?.referralAskSnapshot ? (req?.memberNoteType ?? 'GENERAL_NOTE') : undefined,
          referralAsk: req?.referralAskSnapshot || undefined,
          specialInstructions: req?.specialInstructions ?? '',
          coordinatorName: coord?.name ?? 'Agency Coordinator',
          assignedViaCoordinatorId: viaCoord?.id ?? asgn.assignedViaCoordinatorId,
          assignedViaCoordinatorName: viaCoord?.name ?? coord?.name ?? 'Agency Coordinator',
          coordinatorCallingPhone: coord?.callingPhone || superAdminCoord?.callingPhone || '',
          coordinatorWhatsappPhone: coord?.whatsappPhone || coord?.callingPhone || superAdminCoord?.whatsappPhone || '',
        };
      });

      const myEarnings = data.substituteEarnings
        .filter((e) => e.payeeSubstituteId === actor.substituteId)
        .map((e) => ({
          ...e,
          memberId: '',
          memberName: '',
        }));
      const myPayouts = data.freelancerPayouts.filter((p) => p.payeeSubstituteId === actor.substituteId);
      const myBonuses = data.appreciationBonuses.filter((b) => b.payeeSubstituteId === actor.substituteId);
      const myGuestContacts = actor.canManageNetwork
        ? data.partnerGuestContacts.filter((g) => g.partnerSubstituteId === actor.substituteId)
        : [];
      const milestone = computeMilestoneProgress(data.assignments, actor.substituteId!);
      const myRewards = data.milestoneRewards.filter((m) => m.substituteId === actor.substituteId);

      // Breakdown of meetings & earnings by Assigned Via Coordinator
      const viaMap = new Map<
        string,
        {
          coordinatorId: string;
          coordinatorName: string;
          totalMeetings: number;
          completedMeetings: number;
          totalEarned: number;
          paidAmount: number;
          remainingAmount: number;
        }
      >();
      for (const asgn of myAssignments.filter((a) => !['CANCELLED', 'REPLACED'].includes(a.status))) {
        const cid = asgn.assignedViaCoordinatorId || asgn.coordinatorId;
        const cname = data.coordinators.find((c) => c.id === cid)?.name ?? 'Agency Coordinator';
        const cur = viaMap.get(cid) ?? {
          coordinatorId: cid,
          coordinatorName: cname,
          totalMeetings: 0,
          completedMeetings: 0,
          totalEarned: 0,
          paidAmount: 0,
          remainingAmount: 0,
        };
        cur.totalMeetings += 1;
        if (asgn.status === 'COMPLETED_SELF_REPORTED' || asgn.status === 'VERIFIED') {
          cur.completedMeetings += 1;
        }
        viaMap.set(cid, cur);
      }
      for (const earn of myEarnings) {
        const cid = earn.assignedViaCoordinatorId || earn.coordinatorId;
        const cname = earn.assignedViaCoordinatorName || data.coordinators.find((c) => c.id === cid)?.name || 'Agency Coordinator';
        const cur = viaMap.get(cid) ?? {
          coordinatorId: cid,
          coordinatorName: cname,
          totalMeetings: 0,
          completedMeetings: 0,
          totalEarned: 0,
          paidAmount: 0,
          remainingAmount: 0,
        };
        cur.totalEarned += earn.amount;
        cur.paidAmount += earn.paidAmount;
        cur.remainingAmount += Math.max(0, earn.amount - earn.paidAmount);
        viaMap.set(cid, cur);
      }

      return {
        actor,
        myProfile: this.getMyProfile(actor),
        today: getTomorrowInKolkata(new Date(this.referenceDateProvider().getTime() - 86400000)),
        tomorrow: getTomorrowInKolkata(this.referenceDateProvider()),
        substituteProfile: meSub,
        openRequests,
        confirmedBriefings,
        myResponses,
        myAssignments,
        myAssignmentRequestIds: Array.from(myAssignmentRequestIds),
        myEarnings,
        myPayouts,
        myBonuses,
        myGuestContacts,
        viaCoordinatorSummary: Array.from(viaMap.values()),
        milestone,
        myRewards,
        notifications: data.notifications.filter((n) => n.recipientUserId === actor.id),
      };
    }

    // Admin or External Coordinator scope
    const scopeFilter = <T extends { coordinatorId?: string }>(arr: T[]): T[] =>
      isAdmin ? arr : arr.filter((x) => x.coordinatorId === actor.coordinatorId);

    const scopedMembers = scopeFilter(data.members);
    const scopedRequests = scopeFilter(data.requests);
    const scopedRequestIds = new Set(scopedRequests.map((r) => r.id));
    const scopedResponses = data.responses.filter((r) => scopedRequestIds.has(r.requestId));
    const scopedAssignments = scopeFilter(data.assignments);
    const scopedAssignmentIds = new Set(scopedAssignments.map((a) => a.id));
    const scopedCharges = scopeFilter(data.clientCharges);
    const scopedEarnings = scopeFilter(data.substituteEarnings);
    const scopedCommissions = scopeFilter(data.coordinatorCommissions);
    const scopedReceipts = scopeFilter(data.clientReceipts);
    const scopedPayouts = scopeFilter(data.freelancerPayouts);
    const scopedBonuses = scopeFilter(data.appreciationBonuses);
    const scopedAdjustments = scopeFilter(data.ledgerAdjustments);

    // Shared eligible substitute pool: External Coordinator sees matching fields, NOT private UPI/emergency of others unless Admin
    const visibleSubstitutes = data.substitutes.map((s) =>
      isAdmin
        ? s
        : {
            ...s,
            upiReference: s.upiReference ? 'Protected (Admin Finance)' : undefined,
            emergencyContactPhone: s.emergencyConsent ? s.emergencyContactPhone : undefined,
          }
    );

    // Partner guest contacts visible only if Admin, or referenced in this coordinator's active responses/assignments
    const referencedGuestIds = new Set<string>([
      ...scopedResponses.map((r) => r.delegatedGuestId).filter(Boolean) as string[],
      ...scopedAssignments.map((a) => a.actualAttendeeGuestId).filter(Boolean) as string[],
    ]);
    const visibleGuests = isAdmin
      ? data.partnerGuestContacts
      : data.partnerGuestContacts.filter((g) => referencedGuestIds.has(g.id));

    // Safe user account projections for Super Admin account management (NEVER expose hashes/salts/tokens)
    const managedUsers = isAdmin
      ? data.users.map((u) => ({
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          role: u.role,
          coordinatorId: u.coordinatorId,
          substituteId: u.substituteId,
          canManageNetwork: Boolean(u.canManageNetwork),
          active: u.active,
          hasPendingInvite: Boolean(u.inviteToken),
          showOnLogin: Boolean(u.showOnLogin),
          createdAt: u.createdAt,
        }))
      : [];

    // Safe coordinator name directory (ID + name only, zero private contact/fee leakage)
    const coordinatorDirectory = data.coordinators.map((c) => ({
      id: c.id,
      name: c.name,
      isSuperAdmin: c.isSuperAdmin,
    }));

    return {
      actor,
      myProfile: this.getMyProfile(actor),
      today: getTomorrowInKolkata(new Date(this.referenceDateProvider().getTime() - 86400000)),
      tomorrow: getTomorrowInKolkata(this.referenceDateProvider()),
      coordinators: isAdmin
        ? data.coordinators
        : data.coordinators.filter((c) => c.id === actor.coordinatorId),
      coordinatorDirectory,
      managedUsers,
      locations: data.locations.filter((l) => isAdmin || !l.coordinatorId || l.coordinatorId === actor.coordinatorId),
      chapters: data.chapters.filter((c) => isAdmin || !c.coordinatorId || c.coordinatorId === actor.coordinatorId),
      members: scopedMembers,
      substitutes: visibleSubstitutes,
      partnerGuestContacts: visibleGuests,
      requests: scopedRequests,
      responses: scopedResponses,
      assignments: scopedAssignments,
      checkins: data.checkins.filter((c) => scopedAssignmentIds.has(c.assignmentId)),
      clientCharges: scopedCharges,
      substituteEarnings: scopedEarnings,
      coordinatorCommissions: scopedCommissions,
      clientReceipts: scopedReceipts,
      freelancerPayouts: scopedPayouts,
      appreciationBonuses: scopedBonuses,
      ledgerAdjustments: scopedAdjustments,
      financeSummary: computeFinanceSummary(
        scopedCharges,
        scopedEarnings,
        scopedReceipts,
        scopedPayouts,
        scopedCommissions
      ),
      milestoneTargets: MILESTONE_TARGETS,
      milestoneRewards: isAdmin ? data.milestoneRewards : [],
      notifications: data.notifications.filter((n) => n.recipientUserId === actor.id),
      auditEvents: isAdmin
        ? data.auditEvents
        : data.auditEvents.filter((a) => a.coordinatorId === actor.coordinatorId),
      messageLogs: isCoord
        ? data.messageLogs.filter((m) => m.coordinatorId === actor.coordinatorId)
        : data.messageLogs,
    };
  }

  // ==================== MASTER CRUD ====================

  public upsertLocation(actor: SessionUser, input: Partial<Location> & { name: string; area: string }): Location {
    this.assertRole(actor, ['SUPER_ADMIN', 'EXTERNAL_COORDINATOR']);
    const data = this.ds(actor.namespace);
    if (!input.name.trim() || !input.area.trim()) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'Venue name and area are required.');
    }
    if (input.id) {
      const existing = data.locations.find((l) => l.id === input.id);
      if (!existing) throw new DomainError(404, 'NOT_FOUND', 'Location not found.');
      if (actor.role === 'EXTERNAL_COORDINATOR' && existing.coordinatorId && existing.coordinatorId !== actor.coordinatorId) {
        throw new DomainError(403, 'FORBIDDEN', 'Cannot edit another coordinator location.');
      }
      Object.assign(existing, {
        name: input.name.trim(),
        area: input.area.trim(),
        fullAddress: input.fullAddress?.trim() ?? existing.fullAddress,
        mapsUrl: input.mapsUrl?.trim() ?? existing.mapsUrl,
        nearestStation: input.nearestStation?.trim() ?? existing.nearestStation,
        transportGuidance: input.transportGuidance?.trim() ?? existing.transportGuidance,
        entryNotes: input.entryNotes?.trim() ?? existing.entryNotes,
        active: input.active ?? existing.active,
      });
      this.logAudit(actor, 'LOCATION_UPDATED', 'location', existing.id, `Updated venue ${existing.name}`);
      return existing;
    }
    const loc: Location = {
      id: this.id('loc'),
      namespace: actor.namespace,
      coordinatorId: actor.role === 'SUPER_ADMIN' ? undefined : actor.coordinatorId,
      name: input.name.trim(),
      area: input.area.trim(),
      fullAddress: input.fullAddress?.trim() ?? '',
      mapsUrl: input.mapsUrl?.trim() ?? '',
      nearestStation: input.nearestStation?.trim() ?? '',
      transportGuidance: input.transportGuidance?.trim() ?? '',
      entryNotes: input.entryNotes?.trim() ?? '',
      active: input.active ?? true,
      createdAt: this.now(),
    };
    data.locations.push(loc);
    this.logAudit(actor, 'LOCATION_CREATED', 'location', loc.id, `Created venue ${loc.name} (${loc.area})`);
    return loc;
  }

  public upsertChapter(actor: SessionUser, input: Partial<Chapter> & { name: string; defaultLocationId: string }): Chapter {
    this.assertRole(actor, ['SUPER_ADMIN', 'EXTERNAL_COORDINATOR']);
    const data = this.ds(actor.namespace);
    if (!input.name.trim() || !input.defaultLocationId) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'Chapter name and default venue are required.');
    }
    const loc = data.locations.find((l) => l.id === input.defaultLocationId);
    if (!loc) throw new DomainError(400, 'INVALID_LOCATION', 'Selected default venue does not exist.');

    if (input.id) {
      const existing = data.chapters.find((c) => c.id === input.id);
      if (!existing) throw new DomainError(404, 'NOT_FOUND', 'Chapter not found.');
      if (actor.role === 'EXTERNAL_COORDINATOR' && existing.coordinatorId && existing.coordinatorId !== actor.coordinatorId) {
        throw new DomainError(403, 'FORBIDDEN', 'Cannot edit another coordinator chapter.');
      }
      Object.assign(existing, {
        name: input.name.trim(),
        region: input.region?.trim() || loc.area,
        regularWeekday: input.regularWeekday ?? existing.regularWeekday,
        reportingTime: input.reportingTime ?? existing.reportingTime,
        startTime: input.startTime ?? existing.startTime,
        endTime: input.endTime ?? existing.endTime,
        defaultLocationId: input.defaultLocationId,
        defaultMemberFee: input.defaultMemberFee ?? existing.defaultMemberFee,
        defaultSubstitutePayout: input.defaultSubstitutePayout ?? existing.defaultSubstitutePayout,
        usualInstructions: input.usualInstructions ?? existing.usualInstructions,
        active: input.active ?? existing.active,
      });
      this.logAudit(actor, 'CHAPTER_UPDATED', 'chapter', existing.id, `Updated chapter ${existing.name}`);
      return existing;
    }

    const chapter: Chapter = {
      id: this.id('chap'),
      namespace: actor.namespace,
      coordinatorId: actor.role === 'SUPER_ADMIN' ? undefined : actor.coordinatorId,
      name: input.name.trim(),
      region: input.region?.trim() || loc.area,
      regularWeekday: input.regularWeekday ?? 'Thursday',
      reportingTime: input.reportingTime ?? '07:15 AM',
      startTime: input.startTime ?? '07:30 AM',
      endTime: input.endTime ?? '09:30 AM',
      defaultLocationId: input.defaultLocationId,
      alternateLocationIds: input.alternateLocationIds ?? [],
      defaultMemberFee: Number(input.defaultMemberFee) || 500,
      defaultSubstitutePayout: Number(input.defaultSubstitutePayout) || 350,
      usualInstructions: input.usualInstructions?.trim() ?? '',
      active: input.active ?? true,
      createdAt: this.now(),
    };
    data.chapters.push(chapter);
    this.logAudit(actor, 'CHAPTER_CREATED', 'chapter', chapter.id, `Created chapter ${chapter.name}`);
    return chapter;
  }

  public upsertMember(actor: SessionUser, input: Partial<Member> & { name: string; chapterId: string; phone: string }): Member {
    this.assertRole(actor, ['SUPER_ADMIN', 'EXTERNAL_COORDINATOR']);
    const data = this.ds(actor.namespace);
    if (!input.name.trim() || !input.chapterId || !input.phone.trim()) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'Member name, linked chapter, and phone are required.');
    }
    const chapter = data.chapters.find((c) => c.id === input.chapterId);
    if (!chapter) throw new DomainError(400, 'INVALID_CHAPTER', 'Selected chapter does not exist.');

    if (input.id) {
      const existing = data.members.find((m) => m.id === input.id);
      if (!existing) throw new DomainError(404, 'NOT_FOUND', 'Member not found.');
      if (!this.canAccessCoordinatorScope(actor, existing.coordinatorId)) {
        throw new DomainError(403, 'FORBIDDEN', 'You cannot modify another coordinator member.');
      }
      Object.assign(existing, {
        name: input.name.trim(),
        chapterId: input.chapterId,
        preferredLocationId: input.preferredLocationId || undefined,
        phone: input.phone.trim(),
        whatsappPhone: (input.whatsappPhone || input.phone).trim(),
        email: input.email?.trim() || undefined,
        businessName: input.businessName?.trim() ?? existing.businessName,
        businessCategory: input.businessCategory?.trim() ?? existing.businessCategory,
        intro30Sec: input.intro30Sec?.trim() ?? existing.intro30Sec,
        referralAsk: input.referralAsk?.trim() ?? existing.referralAsk,
        standardFee: Number(input.standardFee) || existing.standardFee,
        notes: input.notes?.trim() ?? existing.notes,
        active: input.active ?? existing.active,
      });
      this.logAudit(actor, 'MEMBER_UPDATED', 'member', existing.id, `Updated member ${existing.name}`, existing.coordinatorId);
      return existing;
    }

    // Server-enforced owner: external coordinator cannot forge another coordinatorId
    const ownerCoordinatorId =
      actor.role === 'SUPER_ADMIN' && input.coordinatorId ? input.coordinatorId : actor.coordinatorId!;

    const member: Member = {
      id: this.id('mem'),
      namespace: actor.namespace,
      coordinatorId: ownerCoordinatorId,
      name: input.name.trim(),
      chapterId: input.chapterId,
      preferredLocationId: input.preferredLocationId || undefined,
      phone: input.phone.trim(),
      whatsappPhone: (input.whatsappPhone || input.phone).trim(),
      email: input.email?.trim() || undefined,
      businessName: input.businessName?.trim() || '',
      businessCategory: input.businessCategory?.trim() || 'General',
      intro30Sec: input.intro30Sec?.trim() || '',
      referralAsk: input.referralAsk?.trim() || '',
      standardFee: Number(input.standardFee) || chapter.defaultMemberFee,
      notes: input.notes?.trim() || '',
      communicationConsent: input.communicationConsent ?? true,
      active: input.active ?? true,
      createdAt: this.now(),
    };
    data.members.push(member);
    this.logAudit(actor, 'MEMBER_CREATED', 'member', member.id, `Added member ${member.name} (${chapter.name})`, ownerCoordinatorId);
    return member;
  }

  public getMemberById(actor: SessionUser, memberId: string): Member {
    this.assertRole(actor, ['SUPER_ADMIN', 'EXTERNAL_COORDINATOR']);
    const member = this.ds(actor.namespace).members.find((m) => m.id === memberId);
    if (!member) throw new DomainError(404, 'NOT_FOUND', 'Member not found.');
    if (!this.canAccessCoordinatorScope(actor, member.coordinatorId)) {
      throw new DomainError(403, 'FORBIDDEN', 'Access denied to member outside your scope.');
    }
    return member;
  }

  public upsertSubstitute(
    actor: SessionUser,
    input: Partial<Substitute> & {
      name: string;
      phone: string;
      email?: string;
      sendInvite?: boolean;
      initialPassword?: string;
      showOnLogin?: boolean;
    }
  ): { substitute: Substitute; inviteToken?: string; passwordConfigured?: boolean } {
    this.assertRole(actor, ['SUPER_ADMIN']);
    const data = this.ds(actor.namespace);
    if (!input.name.trim() || !input.phone.trim()) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'Substitute name and phone are required.');
    }

    if (input.id) {
      const existing = data.substitutes.find((s) => s.id === input.id);
      if (!existing) throw new DomainError(404, 'NOT_FOUND', 'Substitute not found.');
      const nextEmail =
        input.email !== undefined && input.email.trim().length > 0
          ? this.assertEmailUnique(actor.namespace, input.email, existing.userId)
          : existing.email;
      const prevNetwork = existing.canManageNetwork;
      Object.assign(existing, {
        name: input.name.trim(),
        email: nextEmail,
        phone: input.phone.trim(),
        whatsappPhone: (input.whatsappPhone || input.phone).trim(),
        homeArea: input.homeArea?.trim() ?? existing.homeArea,
        preferredAreas: input.preferredAreas ?? existing.preferredAreas,
        preferredChapterIds: input.preferredChapterIds ?? existing.preferredChapterIds,
        defaultPayout: Number(input.defaultPayout) || existing.defaultPayout,
        upiReference: input.upiReference !== undefined ? input.upiReference.trim() : existing.upiReference,
        availability: input.availability ?? existing.availability,
        canManageNetwork: input.canManageNetwork ?? existing.canManageNetwork,
        emergencyContactName: input.emergencyContactName ?? existing.emergencyContactName,
        emergencyContactPhone: input.emergencyContactPhone ?? existing.emergencyContactPhone,
        emergencyConsent: input.emergencyConsent ?? existing.emergencyConsent,
        introducedByCoordinatorId:
          input.introducedByCoordinatorId !== undefined
            ? input.introducedByCoordinatorId || undefined
            : existing.introducedByCoordinatorId,
        notes: input.notes ?? existing.notes,
        verified: input.verified ?? existing.verified,
        active: input.active ?? existing.active,
      });
      const usr = data.users.find((u) => u.id === existing.userId);
      if (usr) {
        usr.displayName = existing.name;
        usr.email = nextEmail;
        usr.canManageNetwork = existing.canManageNetwork;
        usr.active = existing.active;
        if (input.showOnLogin !== undefined) {
          usr.showOnLogin = Boolean(input.showOnLogin);
        }
      }
      if (prevNetwork !== existing.canManageNetwork) {
        this.logAudit(
          actor,
          existing.canManageNetwork ? 'PARTNER_NETWORK_GRANTED' : 'PARTNER_NETWORK_REVOKED',
          'substitute',
          existing.id,
          `${existing.canManageNetwork ? 'Granted' : 'Revoked'} Partner Network (Send Someone Else) for ${existing.name}`
        );
      } else {
        this.logAudit(actor, 'SUBSTITUTE_UPDATED', 'substitute', existing.id, `Updated substitute ${existing.name}`);
      }
      return { substitute: existing };
    }

    if (!input.email || !input.email.trim()) {
      throw new DomainError(400, 'INVALID_EMAIL', 'A unique login email address is required for each substitute account.');
    }
    const email = this.assertEmailUnique(actor.namespace, input.email);
    const { userId, inviteToken, passwordConfigured } = this.inviteUser(actor, {
      email,
      displayName: input.name.trim(),
      role: 'SUBSTITUTE',
      phone: input.phone.trim(),
      whatsappPhone: input.whatsappPhone,
      regionOrArea: input.homeArea || 'Mumbai',
      defaultPayout: Number(input.defaultPayout) || 350,
      canManageNetwork: Boolean(input.canManageNetwork),
      introducedByCoordinatorId: input.introducedByCoordinatorId || undefined,
      initialPassword: input.initialPassword,
      showOnLogin: Boolean(input.showOnLogin),
    });

    const created = data.substitutes.find((s) => s.userId === userId)!;
    created.preferredChapterIds = input.preferredChapterIds ?? [];
    created.preferredAreas = input.preferredAreas?.length ? input.preferredAreas : [created.homeArea];
    created.upiReference = input.upiReference?.trim() || undefined;
    created.availability = input.availability ?? 'AVAILABLE';
    created.emergencyContactName = input.emergencyContactName?.trim() || undefined;
    created.emergencyContactPhone = input.emergencyContactPhone?.trim() || undefined;
    created.emergencyConsent = Boolean(input.emergencyConsent);
    created.notes = input.notes?.trim() || '';
    created.verified = Boolean(input.verified);

    return { substitute: created, inviteToken, passwordConfigured };
  }

  public upsertPartnerGuestContact(
    actor: SessionUser,
    input: Partial<PartnerGuestContact> & { name: string; phone: string; homeArea: string; consentConfirmed: boolean }
  ): PartnerGuestContact {
    this.assertRole(actor, ['SUBSTITUTE', 'SUPER_ADMIN']);
    if (actor.role === 'SUBSTITUTE' && !actor.canManageNetwork) {
      throw new DomainError(403, 'NETWORK_DISABLED', 'Partner network permission is not enabled on your account.');
    }
    if (!input.name.trim() || !input.phone.trim() || !input.consentConfirmed) {
      throw new DomainError(400, 'VALIDATION_ERROR', 'Guest name, mobile number, and contact consent are required.');
    }
    const data = this.ds(actor.namespace);
    const partnerSubId = actor.role === 'SUBSTITUTE' ? actor.substituteId! : input.partnerSubstituteId!;
    if (!partnerSubId) {
      throw new DomainError(400, 'PARTNER_REQUIRED', 'Partner substitute ID is required.');
    }

    const normPhone = input.phone.replace(/\D/g, '').slice(-10);
    if (normPhone.length >= 7) {
      const dup = data.partnerGuestContacts.find(
        (g) =>
          g.partnerSubstituteId === partnerSubId &&
          g.id !== input.id &&
          g.phone.replace(/\D/g, '').slice(-10) === normPhone
      );
      if (dup) {
        throw new DomainError(
          409,
          'DUPLICATE_GUEST_PHONE',
          `A guest contact named "${dup.name}" with mobile ${dup.phone} already exists in your network.`
        );
      }
    }

    if (input.id) {
      const existing = data.partnerGuestContacts.find((g) => g.id === input.id);
      if (!existing) throw new DomainError(404, 'NOT_FOUND', 'Guest contact not found.');
      if (actor.role === 'SUBSTITUTE' && existing.partnerSubstituteId !== actor.substituteId) {
        throw new DomainError(403, 'FORBIDDEN', 'Cannot edit another partner guest contact.');
      }
      Object.assign(existing, {
        name: input.name.trim(),
        phone: input.phone.trim(),
        whatsappPhone: input.whatsappPhone?.trim() || input.phone.trim(),
        homeArea: input.homeArea.trim(),
        preferredAreas: input.preferredAreas?.trim() || existing.preferredAreas,
        notes: input.notes?.trim() ?? existing.notes,
        emergencyContactName: input.emergencyContactName?.trim() || undefined,
        emergencyContactPhone: input.emergencyContactPhone?.trim() || undefined,
        consentConfirmed: Boolean(input.consentConfirmed),
        active: input.active ?? existing.active,
      });
      this.logAudit(actor, 'GUEST_CONTACT_UPDATED', 'partner_guest_contact', existing.id, `Updated guest contact ${existing.name}`);
      return existing;
    }

    const guest: PartnerGuestContact = {
      id: this.id('guest'),
      namespace: actor.namespace,
      partnerSubstituteId: partnerSubId,
      name: input.name.trim(),
      phone: input.phone.trim(),
      whatsappPhone: input.whatsappPhone?.trim() || input.phone.trim(),
      homeArea: input.homeArea.trim(),
      preferredAreas: input.preferredAreas?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      emergencyContactName: input.emergencyContactName?.trim() || undefined,
      emergencyContactPhone: input.emergencyContactPhone?.trim() || undefined,
      consentConfirmed: Boolean(input.consentConfirmed),
      active: true,
      createdAt: this.now(),
    };
    data.partnerGuestContacts.push(guest);
    this.logAudit(actor, 'GUEST_CONTACT_CREATED', 'partner_guest_contact', guest.id, `Saved guest contact ${guest.name} (no login account)`);
    return guest;
  }

  // ==================== REQUEST CREATION & LIFECYCLE ====================

  public createRequest(
    actor: SessionUser,
    input: {
      goingForMemberId: string;
      meetingDate?: string;
      chapterId?: string;
      locationId?: string;
      venueNameOverride?: string;
      addressOverride?: string;
      mapsUrlOverride?: string;
      directionsOverride?: string;
      reportingTime?: string;
      startTime?: string;
      endTime?: string;
      intro30Sec?: string;
      memberNoteType?: MemberNoteType;
      referralAsk?: string;
      assignmentMode: AssignmentMode;
      requireManagerApproval?: boolean;
      allowBids?: boolean;
      positionsRequired?: number;
      memberFee?: number;
      offeredPayout?: number;
      receivedFromType?: ReceivedFromType;
      receivedFrom?: string;
      coordinatorId?: string;
      sourcedViaCoordinatorId?: string;
      coordinatorCommissionEnabled?: boolean;
      coordinatorCommissionAmount?: number;
      urgency?: 'NORMAL' | 'URGENT';
      specialInstructions?: string;
      directSubstituteIds?: string[];
      publishNow?: boolean;
    }
  ): { request: MeetingRequest; directAssignments: Assignment[] } {
    this.assertRole(actor, ['SUPER_ADMIN', 'EXTERNAL_COORDINATOR']);
    const data = this.ds(actor.namespace);

    const member = data.members.find((m) => m.id === input.goingForMemberId);
    if (!member) throw new DomainError(404, 'MEMBER_NOT_FOUND', 'Selected member not found.');
    if (!this.canAccessCoordinatorScope(actor, member.coordinatorId)) {
      throw new DomainError(403, 'FORBIDDEN', 'Cannot create a request for a member outside your scope.');
    }

    const auto = resolveRequestAutoFill(member, data.chapters, data.locations, this.referenceDateProvider());
    if (!auto) throw new DomainError(400, 'CHAPTER_MISSING', 'Member is missing a valid linked chapter.');

    const chosenChapter = input.chapterId
      ? data.chapters.find((c) => c.id === input.chapterId)
      : data.chapters.find((c) => c.id === auto.chapterId);
    if (!chosenChapter) throw new DomainError(400, 'INVALID_CHAPTER', 'Invalid chapter selected.');

    const chosenLoc = input.locationId
      ? data.locations.find((l) => l.id === input.locationId)
      : data.locations.find((l) => l.id === auto.locationId);

    const positionsRequired = Math.max(1, Math.min(10, Math.floor(Number(input.positionsRequired) || 1)));
    const meetingDate = input.meetingDate?.trim() || getTomorrowInKolkata(this.referenceDateProvider());
    const memberFee = Number(input.memberFee ?? auto.memberFee);
    const offeredPayout = Number(input.offeredPayout ?? auto.offeredPayout);

    // Distinct provenance: Responsible Coordinator vs Sourced Via Coordinator
    const responsibleCoordinatorId =
      actor.role === 'SUPER_ADMIN' && input.coordinatorId
        ? input.coordinatorId
        : member.coordinatorId || actor.coordinatorId!;
    const sourcedViaCoordinatorId = input.sourcedViaCoordinatorId?.trim() || undefined;
    const receivedFromType: ReceivedFromType =
      input.receivedFromType ||
      (sourcedViaCoordinatorId && sourcedViaCoordinatorId !== responsibleCoordinatorId
        ? 'EXTERNAL_COORDINATOR'
        : 'DIRECT_MEMBER');

    // Commission is ₹0 by default unless explicitly enabled and approved (> 0)
    const commEnabled = Boolean(input.coordinatorCommissionEnabled) && Number(input.coordinatorCommissionAmount || 0) > 0;
    const commAmount = commEnabled ? Math.max(0, Number(input.coordinatorCommissionAmount) || 0) : 0;
    if (commEnabled && actor.role !== 'SUPER_ADMIN') {
      throw new DomainError(403, 'FORBIDDEN', 'Only Super Admin can approve coordinator commission amounts.');
    }

    const reqId = this.id('req');
    const now = this.now();
    const request: MeetingRequest = {
      id: reqId,
      namespace: actor.namespace,
      requestNumber: data.nextRequestNumber++,
      goingForMemberId: member.id,
      receivedFromType,
      receivedFrom: input.receivedFrom?.trim() || `WhatsApp from ${member.name}`,
      createdByUserId: actor.id,
      coordinatorId: responsibleCoordinatorId,
      sourcedViaCoordinatorId,
      chapterId: chosenChapter.id,
      locationId: chosenLoc?.id ?? auto.locationId,
      meetingDate,
      chapterRegularWeekday: chosenChapter.regularWeekday,
      chapterNameSnapshot: chosenChapter.name,
      venueNameSnapshot: input.venueNameOverride?.trim() || chosenLoc?.name || auto.venueName,
      areaSnapshot: chosenLoc?.area || auto.area,
      addressSnapshot: input.addressOverride?.trim() || chosenLoc?.fullAddress || auto.address,
      mapsUrlSnapshot: input.mapsUrlOverride?.trim() || chosenLoc?.mapsUrl || auto.mapsUrl,
      directionsSnapshot: input.directionsOverride?.trim() || auto.directions,
      reportingTime: input.reportingTime?.trim() || chosenChapter.reportingTime,
      startTime: input.startTime?.trim() || chosenChapter.startTime,
      endTime: input.endTime?.trim() || chosenChapter.endTime,
      intro30SecSnapshot: input.intro30Sec?.trim() || member.intro30Sec,
      memberNoteType: input.referralAsk?.trim() ? (input.memberNoteType ?? 'GENERAL_NOTE') : undefined,
      referralAskSnapshot: input.referralAsk?.trim() || undefined,
      memberNameSnapshot: member.name,
      memberBusinessSnapshot: member.businessName,
      memberPhoneSnapshot: member.phone,
      assignmentMode: input.assignmentMode,
      requireManagerApproval: Boolean(input.requireManagerApproval),
      allowBids: input.allowBids ?? true,
      positionsRequired,
      memberFee,
      offeredPayout,
      coordinatorCommissionEnabled: commEnabled,
      coordinatorCommissionAmount: commAmount,
      urgency: input.urgency ?? 'NORMAL',
      specialInstructions: input.specialInstructions?.trim() || chosenChapter.usualInstructions,
      status: input.publishNow === false ? 'DRAFT' : 'OPEN',
      createdAt: now,
      updatedAt: now,
    };

    data.requests.unshift(request);
    const directAssignments: Assignment[] = [];

    if (input.assignmentMode === 'DIRECT' && input.directSubstituteIds?.length) {
      const uniqueSubs = Array.from(new Set(input.directSubstituteIds)).slice(0, positionsRequired);
      const viaCoordId = request.sourcedViaCoordinatorId || request.coordinatorId;
      uniqueSubs.forEach((subId, idx) => {
        const sub = data.substitutes.find((s) => s.id === subId && s.active);
        if (!sub) return;
        const asgn: Assignment = {
          id: this.id('asgn'),
          namespace: actor.namespace,
          requestId: request.id,
          coordinatorId: request.coordinatorId,
          assignedViaCoordinatorId: viaCoordId,
          confirmedByUserId: actor.id,
          approvedAt: now,
          goingForMemberId: request.goingForMemberId,
          chapterId: request.chapterId,
          meetingDate: request.meetingDate,
          slotIndex: idx + 1,
          contractSubstituteId: sub.id,
          payeeSubstituteId: sub.id,
          actualAttendeeType: 'REGISTERED_SUBSTITUTE',
          actualAttendeeName: sub.name,
          actualAttendeePhone: sub.phone,
          isDelegated: false,
          delegationStatus: 'NONE',
          memberFee: request.memberFee,
          agreedPayout: offeredPayout || sub.defaultPayout,
          coordinatorCommissionAmount: commAmount,
          status: 'CONFIRMED',
          checkinState: 'AWAITING_REPLY',
          lastCheckinReportedByPartner: false,
          finishedReportedByPartner: false,
          disputed: false,
          createdAt: now,
          updatedAt: now,
        };
        data.assignments.unshift(asgn);
        directAssignments.push(asgn);
        this.pushNotification(
          actor.namespace,
          sub.userId,
          `Direct Assignment Confirmed — ${request.chapterNameSnapshot}`,
          `You have been directly assigned for ${request.meetingDate} at ${request.reportingTime} (₹${asgn.agreedPayout}).`,
          'ASSIGNMENT',
          asgn.id
        );
      });
      if (directAssignments.length >= request.positionsRequired) {
        request.status = 'CONFIRMED';
      }
    } else if (request.status === 'OPEN') {
      // Notify active substitutes about newly published request (without leaking member name!)
      for (const sub of data.substitutes.filter((s) => s.active)) {
        this.pushNotification(
          actor.namespace,
          sub.userId,
          `New Open Request — ${request.chapterNameSnapshot}`,
          `${request.areaSnapshot} · ${request.meetingDate} · ${request.reportingTime} · ₹${request.offeredPayout}`,
          'REQUEST',
          request.id
        );
      }
    }

    this.logAudit(
      actor,
      'REQUEST_CREATED',
      'request',
      request.id,
      `Created #${request.requestNumber} for ${member.name} (${request.chapterNameSnapshot}) on ${request.meetingDate} [${request.assignmentMode}]${commEnabled ? ` · Approved Comm ₹${commAmount}` : ''}`,
      request.coordinatorId
    );

    return { request, directAssignments };
  }

  public cancelRequest(actor: SessionUser, requestId: string, reason: string): MeetingRequest {
    this.assertRole(actor, ['SUPER_ADMIN', 'EXTERNAL_COORDINATOR']);
    const data = this.ds(actor.namespace);
    const req = data.requests.find((r) => r.id === requestId);
    if (!req) throw new DomainError(404, 'NOT_FOUND', 'Request not found.');
    if (!this.canAccessCoordinatorScope(actor, req.coordinatorId)) {
      throw new DomainError(403, 'FORBIDDEN', 'Access denied.');
    }
    req.status = 'CANCELLED';
    req.updatedAt = this.now();
    for (const asgn of data.assignments.filter((a) => a.requestId === req.id && a.status !== 'COMPLETED_SELF_REPORTED' && a.status !== 'VERIFIED')) {
      asgn.status = 'CANCELLED';
      asgn.cancelledAt = this.now();
      asgn.cancellationReason = reason || 'Cancelled by coordinator';
      asgn.updatedAt = this.now();
    }
    this.logAudit(actor, 'REQUEST_CANCELLED', 'request', req.id, `Cancelled request #${req.requestNumber}`, req.coordinatorId, reason);
    return req;
  }

  public updateRequestReferralAsk(
    actor: SessionUser,
    requestId: string,
    referralAsk: string,
    memberNoteType?: MemberNoteType
  ): MeetingRequest {
    this.assertRole(actor, ['SUPER_ADMIN', 'EXTERNAL_COORDINATOR']);
    const data = this.ds(actor.namespace);
    const req = data.requests.find((r) => r.id === requestId);
    if (!req) throw new DomainError(404, 'NOT_FOUND', 'Request not found.');
    if (!this.canAccessCoordinatorScope(actor, req.coordinatorId)) {
      throw new DomainError(403, 'FORBIDDEN', 'Access denied.');
    }
    const cleaned = (referralAsk || '').trim();
    const resolvedType: MemberNoteType | undefined = cleaned
      ? (memberNoteType ?? req.memberNoteType ?? 'GENERAL_NOTE')
      : undefined;
    req.referralAskSnapshot = cleaned || undefined;
    req.memberNoteType = resolvedType;
    req.updatedAt = this.now();

    const typeLabel = getMemberNoteTypeLabel(resolvedType);

    // Notify any active confirmed substitutes so they see the updated note immediately
    if (cleaned) {
      const activeAsgns = data.assignments.filter(
        (a) => a.requestId === req.id && a.status !== 'CANCELLED' && a.status !== 'REPLACED'
      );
      const notifiedUsers = new Set<string>();
      for (const asgn of activeAsgns) {
        const sub = data.substitutes.find((s) => s.id === asgn.contractSubstituteId);
        if (sub && !notifiedUsers.has(sub.userId)) {
          notifiedUsers.add(sub.userId);
          this.pushNotification(
            actor.namespace,
            sub.userId,
            `${typeLabel} Updated · ${req.chapterNameSnapshot}`,
            `New ${typeLabel.toLowerCase()} for ${formatShortDate(req.meetingDate)}: "${cleaned.slice(0, 90)}${cleaned.length > 90 ? '…' : ''}"`,
            'ASSIGNMENT',
            asgn.id
          );
        }
      }
    }

    this.logAudit(
      actor,
      'REQUEST_REFERRAL_ASK_UPDATED',
      'request',
      req.id,
      cleaned
        ? `Attached ${typeLabel} on #${req.requestNumber} (${req.chapterNameSnapshot})`
        : `Cleared member note on #${req.requestNumber} (${req.chapterNameSnapshot})`,
      req.coordinatorId
    );
    return req;
  }

  // ==================== SUBSTITUTE RESPONSES, ATOMIC FIRST-CONFIRM & DELEGATION ====================

  public submitResponse(
    actor: SessionUser,
    requestId: string,
    input: {
      responseType: ResponseType;
      proposedPayout?: number;
      delegatedGuestId?: string;
      note?: string;
      requestCrossMeeting?: boolean;
    }
  ): {
    response: RequestResponse;
    assignment?: Assignment;
    autoConfirmed: boolean;
    crossMeetingPending?: boolean;
  } {
    this.assertRole(actor, ['SUBSTITUTE']);
    const data = this.ds(actor.namespace);
    const subId = actor.substituteId!;
    const sub = data.substitutes.find((s) => s.id === subId && s.active);
    if (!sub) throw new DomainError(403, 'INACTIVE_SUBSTITUTE', 'Your Veloctive Team profile is not active.');

    const req = data.requests.find((r) => r.id === requestId);
    if (!req) throw new DomainError(404, 'NOT_FOUND', 'Request not found.');
    if (req.status !== 'OPEN' && req.status !== 'AWAITING_SELECTION') {
      throw new DomainError(409, 'REQUEST_CLOSED', 'This request is already filled or closed.');
    }

    // Critical slot lock guard for atomic concurrency protection (AT-05)
    const lockKey = `${actor.namespace}:req:${req.id}`;
    if (this.activeLocks.has(lockKey)) {
      throw new DomainError(409, 'CONCURRENT_LOCK', 'Another confirmation is being processed; please retry.');
    }
    this.activeLocks.add(lockKey);

    try {
      const liveAssignments = data.assignments.filter(
        (a) => a.requestId === req.id && !['CANCELLED', 'REPLACED', 'NO_SHOW'].includes(a.status)
      );
      if (liveAssignments.length >= req.positionsRequired) {
        throw new DomainError(409, 'ALREADY_FILLED', 'All positions for this request are already filled.');
      }

      // Same-date self-attendance lock across ALL coordinators & Super Admin:
      // If the Veloctive Team member already holds a self-attended meeting on req.meetingDate,
      // they CANNOT auto-accept another request on their own name; they may only submit a
      // Cross-Meeting Request pinned to Super Admin for explicit approval.
      const sameDateSelfAssignment =
        input.responseType === 'DELEGATE_PROPOSAL' || input.responseType === 'NOT_AVAILABLE'
          ? undefined
          : data.assignments.find(
              (a) =>
                a.contractSubstituteId === subId &&
                a.meetingDate === req.meetingDate &&
                !a.isDelegated &&
                !['CANCELLED', 'REPLACED', 'NO_SHOW'].includes(a.status)
            );
      const sameDateConflictReq = sameDateSelfAssignment
        ? data.requests.find((r) => r.id === sameDateSelfAssignment.requestId)
        : undefined;
      const isCrossMeetingRequest = Boolean(sameDateSelfAssignment);

      // Validate partner guest delegation (AT-06, AT-08)
      let guest: PartnerGuestContact | undefined;
      if (input.responseType === 'DELEGATE_PROPOSAL') {
        if (!actor.canManageNetwork) {
          throw new DomainError(403, 'NETWORK_DISABLED', 'Send Someone Else requires Partner Network permission.');
        }
        if (!input.delegatedGuestId) {
          throw new DomainError(400, 'GUEST_REQUIRED', 'Select an approved guest contact from My Network.');
        }
        guest = data.partnerGuestContacts.find(
          (g) => g.id === input.delegatedGuestId && g.partnerSubstituteId === subId && g.active
        );
        if (!guest) {
          throw new DomainError(404, 'GUEST_NOT_FOUND', 'Guest contact not found in your private network.');
        }
        const guestConflict = data.assignments.some((a) => {
          if (!a.isDelegated || a.actualAttendeeGuestId !== guest!.id || a.meetingDate !== req.meetingDate) return false;
          if (['CANCELLED', 'REPLACED', 'NO_SHOW'].includes(a.status)) return false;
          const otherReq = data.requests.find((r) => r.id === a.requestId);
          return otherReq?.reportingTime === req.reportingTime;
        });
        if (guestConflict) {
          throw new DomainError(
            409,
            'TIME_CONFLICT',
            'Nominated guest already has a confirmed assignment at this date and reporting time.'
          );
        }
      }

      if (input.responseType === 'FIRST_CONFIRM' && isCrossMeetingRequest && !input.requestCrossMeeting) {
        throw new DomainError(
          409,
          'TIME_CONFLICT',
          'You already have a meeting on this date. Submit a Cross-Meeting Request so Super Admin can review and allow it.'
        );
      }

      if (input.responseType === 'BID') {
        if (!req.allowBids) {
          throw new DomainError(400, 'BIDS_DISABLED', 'Custom price offers are disabled for this request.');
        }
        if (!input.proposedPayout || input.proposedPayout <= 0) {
          throw new DomainError(400, 'INVALID_BID', 'Enter a valid proposed payout amount.');
        }
      }

      // Upsert unique response per (requestId, substituteId)
      const now = this.now();
      let response = data.responses.find((r) => r.requestId === req.id && r.substituteId === subId);
      const needsApproval =
        input.responseType === 'BID' ||
        input.responseType === 'DELEGATE_PROPOSAL' ||
        req.requireManagerApproval ||
        isCrossMeetingRequest;

      const canAutoConfirm =
        req.assignmentMode === 'FIRST_CONFIRM' &&
        input.responseType === 'FIRST_CONFIRM' &&
        !needsApproval;

      const nextRespStatus =
        input.responseType === 'NOT_AVAILABLE'
          ? 'WITHDRAWN'
          : canAutoConfirm
          ? 'SELECTED'
          : needsApproval
          ? 'AWAITING_APPROVAL'
          : 'PENDING';

      if (response) {
        response.responseType = input.responseType;
        response.proposedPayout = input.responseType === 'BID' ? Number(input.proposedPayout) : undefined;
        response.delegatedGuestId = guest?.id;
        response.delegatedGuestName = guest?.name;
        response.note = input.note?.trim();
        response.isCrossMeetingRequest = isCrossMeetingRequest || undefined;
        response.crossMeetingConflictAssignmentId = sameDateSelfAssignment?.id;
        response.crossMeetingConflictChapter = sameDateConflictReq?.chapterNameSnapshot;
        response.crossMeetingConflictTime = sameDateConflictReq?.reportingTime;
        response.status = nextRespStatus;
        response.updatedAt = now;
      } else {
        response = {
          id: this.id('resp'),
          namespace: actor.namespace,
          requestId: req.id,
          substituteId: subId,
          responseType: input.responseType,
          proposedPayout: input.responseType === 'BID' ? Number(input.proposedPayout) : undefined,
          delegatedGuestId: guest?.id,
          delegatedGuestName: guest?.name,
          note: input.note?.trim(),
          isCrossMeetingRequest: isCrossMeetingRequest || undefined,
          crossMeetingConflictAssignmentId: sameDateSelfAssignment?.id,
          crossMeetingConflictChapter: sameDateConflictReq?.chapterNameSnapshot,
          crossMeetingConflictTime: sameDateConflictReq?.reportingTime,
          status: nextRespStatus,
          createdAt: now,
          updatedAt: now,
        };
        data.responses.unshift(response);
      }

      // Notify coordinator & (for cross-meeting requests) pin directly to Super Admin
      const coord = data.coordinators.find((c) => c.id === req.coordinatorId);

      if (canAutoConfirm) {
        const viaCoordId = req.sourcedViaCoordinatorId || req.coordinatorId;
        const assignment: Assignment = {
          id: this.id('asgn'),
          namespace: actor.namespace,
          requestId: req.id,
          coordinatorId: req.coordinatorId,
          assignedViaCoordinatorId: viaCoordId,
          confirmedByUserId: actor.id,
          approvedAt: now,
          goingForMemberId: req.goingForMemberId,
          chapterId: req.chapterId,
          meetingDate: req.meetingDate,
          slotIndex: liveAssignments.length + 1,
          contractSubstituteId: sub.id,
          payeeSubstituteId: sub.id,
          actualAttendeeType: 'REGISTERED_SUBSTITUTE',
          actualAttendeeName: sub.name,
          actualAttendeePhone: sub.phone,
          isDelegated: false,
          delegationStatus: 'NONE',
          memberFee: req.memberFee,
          agreedPayout: req.offeredPayout,
          coordinatorCommissionAmount: req.coordinatorCommissionEnabled ? req.coordinatorCommissionAmount : 0,
          status: 'CONFIRMED',
          checkinState: 'AWAITING_REPLY',
          lastCheckinReportedByPartner: false,
          finishedReportedByPartner: false,
          disputed: false,
          createdAt: now,
          updatedAt: now,
        };
        data.assignments.unshift(assignment);

        if (liveAssignments.length + 1 >= req.positionsRequired) {
          req.status = 'CONFIRMED';
          req.updatedAt = now;
          for (const other of data.responses.filter(
            (r) => r.requestId === req.id && r.id !== response!.id && (r.status === 'PENDING' || r.status === 'AWAITING_APPROVAL')
          )) {
            other.status = 'FILLED';
            other.updatedAt = now;
          }
        }

        if (coord) {
          this.pushNotification(
            actor.namespace,
            coord.userId,
            `First-Confirm Filled — ${req.chapterNameSnapshot}`,
            `${sub.name} confirmed slot #${assignment.slotIndex} for #${req.requestNumber} (₹${assignment.agreedPayout}).`,
            'ASSIGNMENT',
            assignment.id
          );
        }

        this.logAudit(
          actor,
          'FIRST_CONFIRM_LOCKED',
          'assignment',
          assignment.id,
          `${sub.name} atomically confirmed #${req.requestNumber} (${req.chapterNameSnapshot})`,
          req.coordinatorId
        );

        return { response, assignment, autoConfirmed: true };
      }

      if (req.status === 'OPEN' && input.responseType !== 'NOT_AVAILABLE') {
        req.status = 'AWAITING_SELECTION';
        req.updatedAt = now;
      }

      if (isCrossMeetingRequest && input.responseType !== 'NOT_AVAILABLE') {
        const superAdmins = data.users.filter((u) => u.role === 'SUPER_ADMIN' && u.active);
        const notifiedIds = new Set<string>();
        for (const sa of superAdmins) {
          notifiedIds.add(sa.id);
          this.pushNotification(
            actor.namespace,
            sa.id,
            `Pinned Cross-Meeting Request — ${sub.name}`,
            `${sub.name} is already assigned to ${sameDateConflictReq?.chapterNameSnapshot ?? 'another meeting'} on ${req.meetingDate} (${sameDateConflictReq?.reportingTime ?? ''}) and requested #${req.requestNumber} (${req.chapterNameSnapshot}). Super Admin approval required.`,
            'REQUEST',
            req.id
          );
        }
        if (coord && !notifiedIds.has(coord.userId)) {
          this.pushNotification(
            actor.namespace,
            coord.userId,
            `Cross-Meeting Request Pending Super Admin — #${req.requestNumber}`,
            `${sub.name} already has a meeting on ${req.meetingDate}. Pinned to Super Admin for Cross-Meeting approval.`,
            'REQUEST',
            req.id
          );
        }
      } else if (coord && input.responseType !== 'NOT_AVAILABLE') {
        const label =
          input.responseType === 'DELEGATE_PROPOSAL'
            ? `nominated guest ${guest?.name} (approval required)`
            : input.responseType === 'BID'
            ? `submitted offer ₹${input.proposedPayout} (approval required)`
            : 'expressed interest';
        this.pushNotification(
          actor.namespace,
          coord.userId,
          `New Response on #${req.requestNumber}`,
          `${sub.name} ${label} for ${req.chapterNameSnapshot}.`,
          'REQUEST',
          req.id
        );
      }

      this.logAudit(
        actor,
        isCrossMeetingRequest ? 'CROSS_MEETING_REQUESTED' : 'RESPONSE_SUBMITTED',
        'request_response',
        response.id,
        isCrossMeetingRequest
          ? `${sub.name} submitted pinned Cross-Meeting request on #${req.requestNumber} (same-date conflict with ${sameDateConflictReq?.chapterNameSnapshot ?? 'existing booking'})`
          : `${sub.name} submitted ${input.responseType} on #${req.requestNumber}`,
        req.coordinatorId
      );

      return { response, autoConfirmed: false, crossMeetingPending: isCrossMeetingRequest };
    } finally {
      this.activeLocks.delete(lockKey);
    }
  }

  /**
   * Coordinator selects a candidate (Multi-Interest, Bid Acceptance, or Guest Delegate Approval).
   */
  public approveResponseAndConfirm(
    actor: SessionUser,
    responseId: string,
    overrideOrOptions?:
      | number
      | {
          overridePayout?: number;
          assignedViaCoordinatorId?: string;
          coordinatorCommissionAmount?: number;
        }
  ): Assignment {
    this.assertRole(actor, ['SUPER_ADMIN', 'EXTERNAL_COORDINATOR']);
    const data = this.ds(actor.namespace);
    const resp = data.responses.find((r) => r.id === responseId);
    if (!resp) throw new DomainError(404, 'NOT_FOUND', 'Candidate response not found.');

    const req = data.requests.find((r) => r.id === resp.requestId);
    if (!req) throw new DomainError(404, 'NOT_FOUND', 'Parent request not found.');
    if (!this.canAccessCoordinatorScope(actor, req.coordinatorId)) {
      throw new DomainError(403, 'FORBIDDEN', 'Access denied to this request.');
    }

    const liveAssignments = data.assignments.filter(
      (a) => a.requestId === req.id && !['CANCELLED', 'REPLACED', 'NO_SHOW'].includes(a.status)
    );
    if (liveAssignments.length >= req.positionsRequired) {
      throw new DomainError(409, 'CAPACITY_FULL', 'All required positions are already confirmed.');
    }

    const sub = data.substitutes.find((s) => s.id === resp.substituteId);
    if (!sub) throw new DomainError(404, 'SUB_NOT_FOUND', 'Substitute not found.');

    const isDelegated = resp.responseType === 'DELEGATE_PROPOSAL' && Boolean(resp.delegatedGuestId);
    const guest = isDelegated
      ? data.partnerGuestContacts.find((g) => g.id === resp.delegatedGuestId)
      : undefined;
    if (isDelegated && !guest) {
      throw new DomainError(400, 'GUEST_MISSING', 'Nominated guest contact is no longer available.');
    }

    // Same-date Cross-Meeting protection:
    // - Delegated guests still cannot double-book the exact same date & reportingTime.
    // - Self-attending Veloctive Team members who already hold a meeting on the same date
    //   CANNOT be approved by External Coordinators; ONLY Super Admin may allow a Cross-Meeting!
    if (isDelegated) {
      const guestConflict = data.assignments.some((a) => {
        if (a.meetingDate !== req.meetingDate || ['CANCELLED', 'REPLACED', 'NO_SHOW'].includes(a.status)) return false;
        const otherReq = data.requests.find((r) => r.id === a.requestId);
        return otherReq?.reportingTime === req.reportingTime && a.isDelegated && a.actualAttendeeGuestId === guest?.id;
      });
      if (guestConflict) {
        throw new DomainError(
          409,
          'TIME_CONFLICT',
          'Nominated guest already has a confirmed assignment at this date and reporting time.'
        );
      }
    }

    const sameDateSelfConflict = !isDelegated
      ? data.assignments.find(
          (a) =>
            a.meetingDate === req.meetingDate &&
            !a.isDelegated &&
            a.contractSubstituteId === sub.id &&
            !['CANCELLED', 'REPLACED', 'NO_SHOW'].includes(a.status)
        )
      : undefined;

    const isCrossMeetingApproval = Boolean(sameDateSelfConflict || resp.isCrossMeetingRequest);
    if (isCrossMeetingApproval && actor.role !== 'SUPER_ADMIN') {
      throw new DomainError(
        403,
        'CROSS_MEETING_SUPER_ADMIN_ONLY',
        'This Veloctive Team member already has a meeting on this date. Only Super Admin can approve a Cross-Meeting exception.'
      );
    }

    const opts = typeof overrideOrOptions === 'number' ? { overridePayout: overrideOrOptions } : (overrideOrOptions ?? {});
    const agreedPayout = Number(
      opts.overridePayout ?? (resp.responseType === 'BID' ? resp.proposedPayout : req.offeredPayout)
    );
    const assignedViaCoordinatorId =
      opts.assignedViaCoordinatorId || req.sourcedViaCoordinatorId || req.coordinatorId;
    const approvedCommAmount =
      opts.coordinatorCommissionAmount !== undefined
        ? actor.role === 'SUPER_ADMIN'
          ? Math.max(0, Number(opts.coordinatorCommissionAmount) || 0)
          : 0
        : req.coordinatorCommissionEnabled
        ? req.coordinatorCommissionAmount
        : 0;
    const now = this.now();

    const assignment: Assignment = {
      id: this.id('asgn'),
      namespace: actor.namespace,
      requestId: req.id,
      coordinatorId: req.coordinatorId,
      assignedViaCoordinatorId,
      confirmedByUserId: actor.id,
      approvedAt: now,
      goingForMemberId: req.goingForMemberId,
      chapterId: req.chapterId,
      meetingDate: req.meetingDate,
      slotIndex: liveAssignments.length + 1,
      contractSubstituteId: sub.id,
      payeeSubstituteId: sub.id,
      actualAttendeeType: isDelegated ? 'GUEST' : 'REGISTERED_SUBSTITUTE',
      actualAttendeeGuestId: guest?.id,
      actualAttendeeName: guest ? guest.name : sub.name,
      actualAttendeePhone: guest ? guest.phone : sub.phone,
      isDelegated,
      delegationStatus: isDelegated ? 'APPROVED' : 'NONE',
      memberFee: req.memberFee,
      agreedPayout,
      coordinatorCommissionAmount: approvedCommAmount,
      status: 'CONFIRMED',
      checkinState: 'AWAITING_REPLY',
      lastCheckinReportedByPartner: false,
      finishedReportedByPartner: false,
      isCrossMeeting: isCrossMeetingApproval || undefined,
      crossMeetingApprovedByUserId: isCrossMeetingApproval ? actor.id : undefined,
      disputed: false,
      createdAt: now,
      updatedAt: now,
    };

    data.assignments.unshift(assignment);
    resp.status = 'SELECTED';
    resp.updatedAt = now;

    if (liveAssignments.length + 1 >= req.positionsRequired) {
      req.status = 'CONFIRMED';
      req.updatedAt = now;
      for (const other of data.responses.filter(
        (r) =>
          r.requestId === req.id &&
          r.id !== resp.id &&
          (r.status === 'PENDING' || r.status === 'AWAITING_APPROVAL')
      )) {
        other.status = 'NOT_SELECTED';
        other.updatedAt = now;
      }
    }

    this.pushNotification(
      actor.namespace,
      sub.userId,
      isCrossMeetingApproval
        ? `Cross-Meeting Approved — ${req.chapterNameSnapshot}`
        : isDelegated
        ? `Guest Delegate Approved — ${guest!.name}`
        : `Assignment Confirmed — ${req.chapterNameSnapshot}`,
      isCrossMeetingApproval
        ? `Super Admin approved your Cross-Meeting for ${req.meetingDate} (${req.reportingTime}). Agreed payout: ₹${agreedPayout}.`
        : `Confirmed for ${req.meetingDate} (${req.reportingTime}). Agreed payout: ₹${agreedPayout}. Member briefing is now unlocked.`,
      'ASSIGNMENT',
      assignment.id
    );

    this.logAudit(
      actor,
      isCrossMeetingApproval
        ? 'CROSS_MEETING_APPROVED'
        : isDelegated
        ? 'DELEGATE_APPROVED'
        : 'CANDIDATE_SELECTED',
      'assignment',
      assignment.id,
      isCrossMeetingApproval
        ? `Super Admin approved Cross-Meeting for ${assignment.actualAttendeeName} on #${req.requestNumber} (${req.meetingDate}) for ₹${agreedPayout}`
        : `Confirmed ${assignment.actualAttendeeName} (Payee: ${sub.name}) on #${req.requestNumber} for ₹${agreedPayout}`,
      req.coordinatorId
    );

    return assignment;
  }

  public rejectResponse(actor: SessionUser, responseId: string, reason?: string): RequestResponse {
    this.assertRole(actor, ['SUPER_ADMIN', 'EXTERNAL_COORDINATOR']);
    const data = this.ds(actor.namespace);
    const resp = data.responses.find((r) => r.id === responseId);
    if (!resp) throw new DomainError(404, 'NOT_FOUND', 'Response not found.');
    const req = data.requests.find((r) => r.id === resp.requestId);
    if (!req || !this.canAccessCoordinatorScope(actor, req.coordinatorId)) {
      throw new DomainError(403, 'FORBIDDEN', 'Access denied.');
    }
    resp.status = 'REJECTED';
    resp.updatedAt = this.now();
    this.logAudit(actor, 'RESPONSE_REJECTED', 'request_response', resp.id, `Rejected candidate response on #${req.requestNumber}`, req.coordinatorId, reason);
    return resp;
  }

  public requestResponseChanges(actor: SessionUser, responseId: string, reason: string): RequestResponse {
    this.assertRole(actor, ['SUPER_ADMIN', 'EXTERNAL_COORDINATOR']);
    if (!reason.trim()) throw new DomainError(400, 'REASON_REQUIRED', 'Enter a note describing the requested change.');
    const data = this.ds(actor.namespace);
    const resp = data.responses.find((r) => r.id === responseId);
    if (!resp) throw new DomainError(404, 'NOT_FOUND', 'Response not found.');
    const req = data.requests.find((r) => r.id === resp.requestId);
    if (!req || !this.canAccessCoordinatorScope(actor, req.coordinatorId)) {
      throw new DomainError(403, 'FORBIDDEN', 'Access denied.');
    }
    resp.status = 'PENDING';
    resp.note = `[Changes requested by ${actor.displayName}: ${reason.trim()}]${resp.note ? ` · ${resp.note}` : ''}`;
    resp.updatedAt = this.now();
    const sub = data.substitutes.find((s) => s.id === resp.substituteId);
    if (sub) {
      this.pushNotification(
        actor.namespace,
        sub.userId,
        `Changes Requested on #${req.requestNumber}`,
        `${actor.displayName} requested updates for ${req.chapterNameSnapshot}: ${reason.trim()}`,
        'REQUEST',
        req.id
      );
    }
    this.logAudit(
      actor,
      'RESPONSE_CHANGES_REQUESTED',
      'request_response',
      resp.id,
      `Requested changes on response for #${req.requestNumber}`,
      req.coordinatorId,
      reason.trim()
    );
    return resp;
  }

  /**
   * Invalidates a confirmed assignment (e.g., partner/guest dropout) while preserving history and assignedViaCoordinatorId.
   * Optionally confirms a replacement substitute or replacement guest immediately, or re-opens the request slot.
   */
  public replaceAssignmentAttendee(
    actor: SessionUser,
    assignmentId: string,
    input: {
      reason: string;
      replacementSubstituteId?: string;
      replacementGuestId?: string;
      agreedPayout?: number;
    }
  ): { replacedAssignment: Assignment; replacementAssignment?: Assignment } {
    this.assertRole(actor, ['SUPER_ADMIN', 'EXTERNAL_COORDINATOR']);
    if (!input.reason?.trim()) {
      throw new DomainError(400, 'REASON_REQUIRED', 'Please enter a reason for replacing this attendee.');
    }
    const data = this.ds(actor.namespace);
    const oldAsgn = data.assignments.find((a) => a.id === assignmentId);
    if (!oldAsgn) throw new DomainError(404, 'NOT_FOUND', 'Assignment not found.');
    if (!this.canAccessCoordinatorScope(actor, oldAsgn.coordinatorId)) {
      throw new DomainError(403, 'FORBIDDEN', 'Access denied.');
    }
    if (['COMPLETED_SELF_REPORTED', 'VERIFIED', 'CANCELLED', 'REPLACED'].includes(oldAsgn.status)) {
      throw new DomainError(409, 'CANNOT_REPLACE', 'Finished, cancelled, or already replaced assignments cannot be replaced.');
    }

    const req = data.requests.find((r) => r.id === oldAsgn.requestId);
    if (!req) throw new DomainError(404, 'NOT_FOUND', 'Parent request not found.');

    const now = this.now();
    oldAsgn.status = 'REPLACED';
    oldAsgn.delegationStatus = oldAsgn.isDelegated ? 'REPLACED' : oldAsgn.delegationStatus;
    oldAsgn.replacementReason = input.reason.trim();
    oldAsgn.updatedAt = now;

    let replacementAssignment: Assignment | undefined;

    if (input.replacementSubstituteId || input.replacementGuestId) {
      const targetSubId = input.replacementSubstituteId || oldAsgn.contractSubstituteId;
      const targetSub = data.substitutes.find((s) => s.id === targetSubId && s.active);
      if (!targetSub) throw new DomainError(404, 'SUB_NOT_FOUND', 'Replacement substitute not found.');

      let targetGuest: PartnerGuestContact | undefined;
      if (input.replacementGuestId) {
        targetGuest = data.partnerGuestContacts.find(
          (g) => g.id === input.replacementGuestId && g.partnerSubstituteId === targetSub.id && g.active
        );
        if (!targetGuest) {
          throw new DomainError(404, 'GUEST_NOT_FOUND', 'Replacement guest not found in partner network.');
        }
      }

      const isDelegated = Boolean(targetGuest);
      replacementAssignment = {
        id: this.id('asgn'),
        namespace: actor.namespace,
        requestId: req.id,
        coordinatorId: req.coordinatorId,
        assignedViaCoordinatorId: oldAsgn.assignedViaCoordinatorId,
        confirmedByUserId: actor.id,
        approvedAt: now,
        goingForMemberId: req.goingForMemberId,
        chapterId: req.chapterId,
        meetingDate: req.meetingDate,
        slotIndex: oldAsgn.slotIndex,
        contractSubstituteId: targetSub.id,
        payeeSubstituteId: targetSub.id,
        actualAttendeeType: isDelegated ? 'GUEST' : 'REGISTERED_SUBSTITUTE',
        actualAttendeeGuestId: targetGuest?.id,
        actualAttendeeName: targetGuest ? targetGuest.name : targetSub.name,
        actualAttendeePhone: targetGuest ? targetGuest.phone : targetSub.phone,
        isDelegated,
        delegationStatus: isDelegated ? 'APPROVED' : 'NONE',
        replacedAssignmentId: oldAsgn.id,
        memberFee: req.memberFee,
        agreedPayout: Number(input.agreedPayout ?? oldAsgn.agreedPayout),
        coordinatorCommissionAmount: oldAsgn.coordinatorCommissionAmount,
        status: 'CONFIRMED',
        checkinState: 'AWAITING_REPLY',
        lastCheckinReportedByPartner: false,
        finishedReportedByPartner: false,
        disputed: false,
        createdAt: now,
        updatedAt: now,
      };
      data.assignments.unshift(replacementAssignment);
      req.status = 'CONFIRMED';
      req.updatedAt = now;

      this.pushNotification(
        actor.namespace,
        targetSub.userId,
        `Replacement Confirmed — ${req.chapterNameSnapshot}`,
        `${replacementAssignment.actualAttendeeName} confirmed for ${req.meetingDate} (₹${replacementAssignment.agreedPayout}).`,
        'ASSIGNMENT',
        replacementAssignment.id
      );
    } else {
      // Re-open the unfilled slot so substitutes can apply again
      req.status = 'OPEN';
      req.updatedAt = now;
    }

    this.logAudit(
      actor,
      'ASSIGNMENT_REPLACED',
      'assignment',
      oldAsgn.id,
      `Marked ${oldAsgn.actualAttendeeName} as REPLACED on #${req.requestNumber}${
        replacementAssignment ? ` → replaced by ${replacementAssignment.actualAttendeeName}` : ' (slot re-opened)'
      }`,
      req.coordinatorId,
      input.reason.trim()
    );

    return { replacedAssignment: oldAsgn, replacementAssignment };
  }

  // ==================== MORNING CHECK-INS & ATOMIC IDEMPOTENT FINISH ====================

  public recordCheckin(
    actor: SessionUser,
    assignmentId: string,
    eventType: Exclude<CheckinType, 'FINISH'>,
    note?: string
  ): Assignment {
    const data = this.ds(actor.namespace);
    const asgn = data.assignments.find((a) => a.id === assignmentId);
    if (!asgn) throw new DomainError(404, 'NOT_FOUND', 'Assignment not found.');

    if (actor.role === 'SUBSTITUTE') {
      if (asgn.contractSubstituteId !== actor.substituteId) {
        throw new DomainError(403, 'FORBIDDEN', 'You can only update check-ins for your own or delegated assignments.');
      }
    } else if (!this.canAccessCoordinatorScope(actor, asgn.coordinatorId)) {
      throw new DomainError(403, 'FORBIDDEN', 'Access denied.');
    }

    if (['COMPLETED_SELF_REPORTED', 'VERIFIED', 'CANCELLED'].includes(asgn.status)) {
      throw new DomainError(409, 'INVALID_STATE', 'Assignment is already finished or cancelled.');
    }

    const now = this.now();
    const reportedByPartner = actor.role === 'SUBSTITUTE' && asgn.isDelegated;
    asgn.checkinState = eventType;
    asgn.status = eventType;
    asgn.lastCheckinAt = now;
    asgn.lastCheckinReportedByPartner = reportedByPartner;
    asgn.updatedAt = now;

    const req = data.requests.find((r) => r.id === asgn.requestId);
    if (req && req.status === 'CONFIRMED') {
      req.status = 'IN_PROGRESS';
      req.updatedAt = now;
    }

    data.checkins.unshift({
      id: this.id('chk'),
      namespace: actor.namespace,
      assignmentId: asgn.id,
      eventType,
      reportedByUserId: actor.id,
      reportedByPartner,
      actualAttendeeName: asgn.actualAttendeeName,
      note: note?.trim(),
      createdAt: now,
    });

    const coord = data.coordinators.find((c) => c.id === asgn.coordinatorId);
    const viaCoord = data.coordinators.find((c) => c.id === asgn.assignedViaCoordinatorId);
    const partnerSub = data.substitutes.find((s) => s.id === asgn.contractSubstituteId);
    const attributionPhrase = reportedByPartner
      ? `Reported by Partner ${partnerSub?.name ?? actor.displayName} for Guest ${asgn.actualAttendeeName}`
      : `Self-reported by ${asgn.actualAttendeeName}`;

    if (actor.role === 'SUBSTITUTE') {
      const labelMap = { AWAKE: 'is Awake', LEFT_HOME: 'has Departed', REACHED: 'has Reached Venue' };
      const recipientUserIds = new Set<string>();
      if (coord?.userId) recipientUserIds.add(coord.userId);
      if (viaCoord?.userId) recipientUserIds.add(viaCoord.userId);
      if (asgn.confirmedByUserId && asgn.confirmedByUserId !== actor.id) {
        const confirmer = data.users.find((u) => u.id === asgn.confirmedByUserId && u.active);
        if (confirmer && confirmer.role !== 'SUBSTITUTE') recipientUserIds.add(confirmer.id);
      }
      for (const sa of data.users.filter((u) => u.role === 'SUPER_ADMIN' && u.active)) {
        recipientUserIds.add(sa.id);
      }

      for (const recipientId of recipientUserIds) {
        this.pushNotification(
          actor.namespace,
          recipientId,
          `Check-in: ${asgn.actualAttendeeName} ${labelMap[eventType]}`,
          `${attributionPhrase} · ${req?.chapterNameSnapshot ?? ''} (${req?.memberNameSnapshot ?? ''})`,
          'CHECKIN',
          asgn.id
        );
      }
    }

    this.logAudit(
      actor,
      `CHECKIN_${eventType}`,
      'assignment',
      asgn.id,
      `${asgn.actualAttendeeName} marked ${eventType} (${attributionPhrase})`,
      asgn.coordinatorId
    );
    return asgn;
  }

  public reportAssignmentIssue(
    actor: SessionUser,
    assignmentId: string,
    issueNote: string
  ): Assignment {
    const data = this.ds(actor.namespace);
    const asgn = data.assignments.find((a) => a.id === assignmentId);
    if (!asgn) throw new DomainError(404, 'NOT_FOUND', 'Assignment not found.');

    if (actor.role === 'SUBSTITUTE') {
      if (asgn.contractSubstituteId !== actor.substituteId) {
        throw new DomainError(403, 'FORBIDDEN', 'You can only report issues on your own assignments.');
      }
    } else if (!this.canAccessCoordinatorScope(actor, asgn.coordinatorId)) {
      throw new DomainError(403, 'FORBIDDEN', 'Access denied.');
    }

    if (['COMPLETED_SELF_REPORTED', 'VERIFIED', 'CANCELLED'].includes(asgn.status)) {
      throw new DomainError(409, 'INVALID_STATE', 'Assignment is already finished or cancelled.');
    }

    const cleanNote = (issueNote || '').trim();
    if (!cleanNote) {
      throw new DomainError(400, 'ISSUE_NOTE_REQUIRED', 'Describe the issue before submitting.');
    }

    const now = this.now();
    asgn.issueNote = cleanNote;
    asgn.issueReportedAt = now;
    asgn.updatedAt = now;

    const req = data.requests.find((r) => r.id === asgn.requestId);
    const coord = data.coordinators.find((c) => c.id === asgn.coordinatorId);
    const viaCoord = data.coordinators.find((c) => c.id === asgn.assignedViaCoordinatorId);
    if (actor.role === 'SUBSTITUTE') {
      const recipientUserIds = new Set<string>();
      if (coord?.userId) recipientUserIds.add(coord.userId);
      if (viaCoord?.userId) recipientUserIds.add(viaCoord.userId);
      for (const sa of data.users.filter((u) => u.role === 'SUPER_ADMIN' && u.active)) {
        recipientUserIds.add(sa.id);
      }
      for (const recipientId of recipientUserIds) {
        this.pushNotification(
          actor.namespace,
          recipientId,
          `Issue Alert: ${asgn.actualAttendeeName} (${req?.chapterNameSnapshot ?? 'Meeting'})`,
          cleanNote,
          'ISSUE',
          asgn.id
        );
      }
    }

    this.logAudit(
      actor,
      'ASSIGNMENT_ISSUE_REPORTED',
      'assignment',
      asgn.id,
      `${asgn.actualAttendeeName} flagged an issue: ${cleanNote}`,
      asgn.coordinatorId
    );
    return asgn;
  }

  /**
   * LOCKED RULE (AT-10, AT-11, AT-13):
   * Contracted substitute or accountable partner taps Finish.
   * Atomically posts EXACTLY ONE Member Receivable, EXACTLY ONE Registered Substitute Payable,
   * and — ONLY if explicitly pre-approved (> 0) — EXACTLY ONE Coordinator Commission.
   * Idempotent under retries/double taps.
   */
  public finishAssignmentAtomic(
    actor: SessionUser,
    assignmentId: string,
    input: {
      idempotencyKey?: string;
      notes?: MeetingReportNotes;
      isEarlyFinish?: boolean;
    }
  ): {
    assignment: Assignment;
    clientCharge: ClientCharge;
    substituteEarning: SubstituteEarning;
    coordinatorCommission?: CoordinatorCommission;
    idempotentReplay: boolean;
  } {
    const data = this.ds(actor.namespace);
    const asgn = data.assignments.find((a) => a.id === assignmentId);
    if (!asgn) throw new DomainError(404, 'NOT_FOUND', 'Assignment not found.');

    if (actor.role === 'SUBSTITUTE') {
      if (asgn.contractSubstituteId !== actor.substituteId) {
        throw new DomainError(403, 'FORBIDDEN', 'Only the contracted substitute or partner may Finish this assignment.');
      }
    } else if (!this.canAccessCoordinatorScope(actor, asgn.coordinatorId)) {
      throw new DomainError(403, 'FORBIDDEN', 'Access denied.');
    }

    if (asgn.status === 'CANCELLED' || asgn.status === 'NO_SHOW' || asgn.status === 'REPLACED') {
      throw new DomainError(409, 'CANNOT_FINISH', 'Cancelled or replaced assignments cannot be finished.');
    }

    // Idempotent check: existing charge & earning for this assignment OR matching idempotency key
    const existingCharge = data.clientCharges.find((c) => c.assignmentId === asgn.id);
    const existingEarning = data.substituteEarnings.find((e) => e.assignmentId === asgn.id);
    const existingComm = data.coordinatorCommissions.find((c) => c.assignmentId === asgn.id);
    if (
      existingCharge &&
      existingEarning &&
      (asgn.status === 'COMPLETED_SELF_REPORTED' ||
        asgn.status === 'VERIFIED' ||
        asgn.status === 'DISPUTED' ||
        (input.idempotencyKey && asgn.finishIdempotencyKey === input.idempotencyKey))
    ) {
      return {
        assignment: asgn,
        clientCharge: existingCharge,
        substituteEarning: existingEarning,
        coordinatorCommission: existingComm,
        idempotentReplay: true,
      };
    }

    if (input.isEarlyFinish && !input.notes?.earlyFinishReason?.trim()) {
      throw new DomainError(400, 'EARLY_FINISH_REASON_REQUIRED', 'Please provide a reason for finishing before scheduled end time.');
    }

    const req = data.requests.find((r) => r.id === asgn.requestId);
    const viaCoordId = asgn.assignedViaCoordinatorId || asgn.coordinatorId;
    const viaCoord = data.coordinators.find((c) => c.id === viaCoordId);
    const member = data.members.find((m) => m.id === asgn.goingForMemberId);
    const partnerSub = data.substitutes.find((s) => s.id === asgn.contractSubstituteId);
    const now = this.now();
    const reportedByPartner = actor.role === 'SUBSTITUTE' && asgn.isDelegated;
    const attributionPhrase = reportedByPartner
      ? `Reported by Partner ${partnerSub?.name ?? actor.displayName} for Guest ${asgn.actualAttendeeName}`
      : `Self-reported by ${asgn.actualAttendeeName}`;

    // Atomic state update + 1:1 ledger creation
    asgn.status = 'COMPLETED_SELF_REPORTED';
    asgn.checkinState = 'FINISHED';
    asgn.finishedAt = now;
    asgn.finishIdempotencyKey = input.idempotencyKey || this.id('fin');
    asgn.finishedByUserId = actor.id;
    asgn.finishedReportedByPartner = reportedByPartner;
    asgn.meetingNotes = input.notes;
    asgn.updatedAt = now;

    if (req) {
      const activeAsgns = data.assignments.filter(
        (a) => a.requestId === req.id && !['CANCELLED', 'REPLACED', 'NO_SHOW'].includes(a.status)
      );
      if (activeAsgns.every((a) => a.status === 'COMPLETED_SELF_REPORTED' || a.status === 'VERIFIED')) {
        req.status = 'COMPLETED_SELF_REPORTED';
        req.updatedAt = now;
      }
    }

    const clientCharge: ClientCharge = {
      id: this.id('chg'),
      namespace: actor.namespace,
      assignmentId: asgn.id,
      requestId: asgn.requestId,
      coordinatorId: asgn.coordinatorId,
      assignedViaCoordinatorId: viaCoordId,
      memberId: asgn.goingForMemberId,
      contractSubstituteId: asgn.contractSubstituteId,
      chapterName: req?.chapterNameSnapshot ?? '',
      meetingDate: asgn.meetingDate,
      actualAttendeeName: asgn.actualAttendeeName,
      isDelegated: asgn.isDelegated,
      amount: asgn.memberFee,
      receivedAmount: 0,
      status: 'OUTSTANDING',
      createdAt: now,
    };

    const substituteEarning: SubstituteEarning = {
      id: this.id('earn'),
      namespace: actor.namespace,
      assignmentId: asgn.id,
      requestId: asgn.requestId,
      coordinatorId: asgn.coordinatorId,
      assignedViaCoordinatorId: viaCoordId,
      assignedViaCoordinatorName: viaCoord?.name ?? 'Agency Coordinator',
      memberId: asgn.goingForMemberId,
      memberName: req?.memberNameSnapshot ?? member?.name ?? 'Member',
      payeeSubstituteId: asgn.payeeSubstituteId, // Registered partner ONLY!
      actualAttendeeName: asgn.actualAttendeeName,
      isDelegated: asgn.isDelegated,
      chapterName: req?.chapterNameSnapshot ?? '',
      meetingDate: asgn.meetingDate,
      amount: asgn.agreedPayout,
      paidAmount: 0,
      status: 'OUTSTANDING',
      createdAt: now,
    };

    data.clientCharges.unshift(clientCharge);
    data.substituteEarnings.unshift(substituteEarning);

    // Optional Coordinator Commission: ONLY posted when explicitly approved (> 0)
    let coordinatorCommission: CoordinatorCommission | undefined;
    if (asgn.coordinatorCommissionAmount > 0 && viaCoordId) {
      coordinatorCommission = {
        id: this.id('comm'),
        namespace: actor.namespace,
        assignmentId: asgn.id,
        requestId: asgn.requestId,
        coordinatorId: viaCoordId,
        memberId: asgn.goingForMemberId,
        memberName: req?.memberNameSnapshot ?? member?.name ?? 'Member',
        chapterName: req?.chapterNameSnapshot ?? '',
        meetingDate: asgn.meetingDate,
        actualAttendeeName: asgn.actualAttendeeName,
        amount: asgn.coordinatorCommissionAmount,
        paidAmount: 0,
        status: 'OUTSTANDING',
        createdAt: now,
      };
      data.coordinatorCommissions.unshift(coordinatorCommission);
    }

    data.checkins.unshift({
      id: this.id('chk'),
      namespace: actor.namespace,
      assignmentId: asgn.id,
      eventType: 'FINISH',
      reportedByUserId: actor.id,
      reportedByPartner,
      actualAttendeeName: asgn.actualAttendeeName,
      note: input.notes?.highlights || input.notes?.earlyFinishReason,
      createdAt: now,
    });

    // Check if substitute unlocked a new milestone (uniquely keyed per substitute + targetCount)
    const progress = computeMilestoneProgress(data.assignments, asgn.contractSubstituteId);
    for (const unlocked of progress.unlockedTargets) {
      const alreadyExists = data.milestoneRewards.some(
        (m) => m.substituteId === asgn.contractSubstituteId && m.targetCount === unlocked.count
      );
      if (!alreadyExists) {
        data.milestoneRewards.unshift({
          id: this.id('mile'),
          namespace: actor.namespace,
          substituteId: asgn.contractSubstituteId,
          targetCount: unlocked.count,
          rewardAmount: unlocked.defaultReward,
          status: 'UNLOCKED',
          createdAt: now,
        });
      }
    }

    const coord = data.coordinators.find((c) => c.id === asgn.coordinatorId);
    if (coord) {
      this.pushNotification(
        actor.namespace,
        coord.userId,
        `Meeting Finished — ${req?.chapterNameSnapshot ?? ''}`,
        `${attributionPhrase}. Posted ₹${clientCharge.amount} receivable & ₹${substituteEarning.amount} payable${
          coordinatorCommission ? ` (+ ₹${coordinatorCommission.amount} approved commission)` : ''
        }.`,
        'FINANCE',
        asgn.id
      );
    }

    this.logAudit(
      actor,
      'ASSIGNMENT_FINISHED_ATOMIC',
      'assignment',
      asgn.id,
      `Finished (${attributionPhrase}); atomically posted charge ₹${clientCharge.amount} & earning ₹${substituteEarning.amount}${
        coordinatorCommission ? ` & approved commission ₹${coordinatorCommission.amount}` : ''
      }`,
      asgn.coordinatorId,
      input.notes?.earlyFinishReason
    );

    return { assignment: asgn, clientCharge, substituteEarning, coordinatorCommission, idempotentReplay: false };
  }

  public verifyAssignment(actor: SessionUser, assignmentId: string): Assignment {
    this.assertRole(actor, ['SUPER_ADMIN', 'EXTERNAL_COORDINATOR']);
    const data = this.ds(actor.namespace);
    const asgn = data.assignments.find((a) => a.id === assignmentId);
    if (!asgn) throw new DomainError(404, 'NOT_FOUND', 'Assignment not found.');
    if (!this.canAccessCoordinatorScope(actor, asgn.coordinatorId)) {
      throw new DomainError(403, 'FORBIDDEN', 'Access denied.');
    }
    if (asgn.status !== 'COMPLETED_SELF_REPORTED' && asgn.status !== 'DISPUTED') {
      throw new DomainError(409, 'INVALID_STATE', 'Only finished assignments can be verified.');
    }
    const now = this.now();
    asgn.status = 'VERIFIED';
    asgn.verifiedAt = now;
    asgn.verifiedByUserId = actor.id;
    asgn.disputed = false;
    asgn.disputeResolvedAt = asgn.disputeReason ? now : undefined;
    asgn.updatedAt = now;

    // Release settlement hold if any
    const charge = data.clientCharges.find((c) => c.assignmentId === asgn.id);
    if (charge && charge.status === 'ON_HOLD') {
      charge.status = charge.receivedAmount >= charge.amount ? 'FULLY_PAID' : charge.receivedAmount > 0 ? 'PARTIALLY_PAID' : 'OUTSTANDING';
    }
    const earning = data.substituteEarnings.find((e) => e.assignmentId === asgn.id);
    if (earning && earning.status === 'ON_HOLD') {
      earning.status = earning.paidAmount >= earning.amount ? 'FULLY_PAID' : earning.paidAmount > 0 ? 'PARTIALLY_PAID' : 'OUTSTANDING';
    }

    const req = data.requests.find((r) => r.id === asgn.requestId);
    if (req) req.status = 'VERIFIED';

    this.logAudit(actor, 'ASSIGNMENT_VERIFIED', 'assignment', asgn.id, `Verified attendance for ${asgn.actualAttendeeName}`, asgn.coordinatorId);
    return asgn;
  }

  public openDisputeAndHold(actor: SessionUser, assignmentId: string, reason: string, holdSettlement = true): Assignment {
    this.assertRole(actor, ['SUPER_ADMIN', 'EXTERNAL_COORDINATOR']);
    if (!reason.trim()) throw new DomainError(400, 'REASON_REQUIRED', 'A dispute reason is required.');
    const data = this.ds(actor.namespace);
    const asgn = data.assignments.find((a) => a.id === assignmentId);
    if (!asgn) throw new DomainError(404, 'NOT_FOUND', 'Assignment not found.');
    if (!this.canAccessCoordinatorScope(actor, asgn.coordinatorId)) {
      throw new DomainError(403, 'FORBIDDEN', 'Access denied.');
    }
    const now = this.now();
    asgn.disputed = true;
    asgn.disputeReason = reason.trim();
    asgn.status = 'DISPUTED';
    asgn.updatedAt = now;

    const req = data.requests.find((r) => r.id === asgn.requestId);
    if (req) req.status = 'DISPUTED';

    if (holdSettlement) {
      const chg = data.clientCharges.find((c) => c.assignmentId === asgn.id);
      if (chg && chg.status !== 'FULLY_PAID') {
        chg.status = 'ON_HOLD';
        chg.adjustmentNote = reason.trim();
      }
      const earn = data.substituteEarnings.find((e) => e.assignmentId === asgn.id);
      if (earn && earn.status !== 'FULLY_PAID') {
        earn.status = 'ON_HOLD';
        earn.adjustmentNote = reason.trim();
      }
    }

    this.logAudit(actor, 'DISPUTE_OPENED', 'assignment', asgn.id, `Opened dispute (${holdSettlement ? 'settlement on hold' : 'no hold'})`, asgn.coordinatorId, reason.trim());
    return asgn;
  }

  public adjustDisputedLedger(
    actor: SessionUser,
    assignmentId: string,
    input: { chargeDelta: number; earningDelta: number; reason: string }
  ) {
    this.assertRole(actor, ['SUPER_ADMIN', 'EXTERNAL_COORDINATOR']);
    if (!input.reason.trim()) throw new DomainError(400, 'REASON_REQUIRED', 'Adjustment reason is required.');
    const data = this.ds(actor.namespace);
    const asgn = data.assignments.find((a) => a.id === assignmentId);
    if (!asgn) throw new DomainError(404, 'NOT_FOUND', 'Assignment not found.');
    if (!this.canAccessCoordinatorScope(actor, asgn.coordinatorId)) {
      throw new DomainError(403, 'FORBIDDEN', 'Access denied.');
    }
    const now = this.now();
    const charge = data.clientCharges.find((c) => c.assignmentId === asgn.id);
    const earning = data.substituteEarnings.find((e) => e.assignmentId === asgn.id);

    if (charge && input.chargeDelta !== 0) {
      const nextAmt = Math.max(charge.receivedAmount, charge.amount + input.chargeDelta);
      const actualDelta = nextAmt - charge.amount;
      charge.amount = nextAmt;
      charge.status = nextAmt === 0 ? 'ADJUSTED' : charge.receivedAmount >= nextAmt ? 'FULLY_PAID' : charge.receivedAmount > 0 ? 'PARTIALLY_PAID' : 'OUTSTANDING';
      charge.adjustmentNote = input.reason.trim();
      data.ledgerAdjustments.unshift({
        id: this.id('adj'),
        namespace: actor.namespace,
        coordinatorId: asgn.coordinatorId,
        targetType: 'CLIENT_CHARGE',
        targetId: charge.id,
        deltaAmount: actualDelta,
        reason: input.reason.trim(),
        actorUserId: actor.id,
        createdAt: now,
      });
    }

    if (earning && input.earningDelta !== 0) {
      const nextAmt = Math.max(earning.paidAmount, earning.amount + input.earningDelta);
      const actualDelta = nextAmt - earning.amount;
      earning.amount = nextAmt;
      earning.status = nextAmt === 0 ? 'ADJUSTED' : earning.paidAmount >= nextAmt ? 'FULLY_PAID' : earning.paidAmount > 0 ? 'PARTIALLY_PAID' : 'OUTSTANDING';
      earning.adjustmentNote = input.reason.trim();
      data.ledgerAdjustments.unshift({
        id: this.id('adj'),
        namespace: actor.namespace,
        coordinatorId: asgn.coordinatorId,
        targetType: 'SUBSTITUTE_EARNING',
        targetId: earning.id,
        deltaAmount: actualDelta,
        reason: input.reason.trim(),
        actorUserId: actor.id,
        createdAt: now,
      });
    }

    asgn.disputeResolvedAt = now;
    asgn.updatedAt = now;
    this.logAudit(
      actor,
      'LEDGER_ADJUSTED',
      'assignment',
      asgn.id,
      `Applied immutable adjustment (Charge Δ₹${input.chargeDelta}, Earning Δ₹${input.earningDelta})`,
      asgn.coordinatorId,
      input.reason.trim()
    );
    return { assignment: asgn, charge, earning };
  }

  // ==================== FINANCE: RECEIPTS, PAYOUTS, BONUS, ALLOCATIONS ====================

  public recordClientReceipt(
    actor: SessionUser,
    input: {
      memberId: string;
      amount: number;
      paymentDate: string;
      method: PaymentMethod;
      reference: string;
      notes?: string;
      allocations: ReceiptAllocation[];
      idempotencyKey?: string;
    }
  ): { receipt: ClientReceipt; idempotentReplay: boolean } {
    this.assertRole(actor, ['SUPER_ADMIN', 'EXTERNAL_COORDINATOR']);
    const data = this.ds(actor.namespace);

    if (input.idempotencyKey) {
      const existing = data.clientReceipts.find((r) => r.idempotencyKey === input.idempotencyKey);
      if (existing) return { receipt: existing, idempotentReplay: true };
    }

    const member = data.members.find((m) => m.id === input.memberId);
    if (!member) throw new DomainError(404, 'MEMBER_NOT_FOUND', 'Member not found.');
    if (!this.canAccessCoordinatorScope(actor, member.coordinatorId)) {
      throw new DomainError(403, 'FORBIDDEN', 'Access denied.');
    }

    if (!input.amount || input.amount <= 0) {
      throw new DomainError(400, 'INVALID_AMOUNT', 'Receipt amount must be positive.');
    }
    if (!input.reference?.trim()) {
      throw new DomainError(400, 'REFERENCE_REQUIRED', 'Transfer reference / UPI ID is required.');
    }
    if (!input.allocations?.length) {
      throw new DomainError(400, 'ALLOCATION_REQUIRED', 'Allocate the receipt to at least one dated charge.');
    }

    let allocatedSum = 0;
    for (const alloc of input.allocations) {
      if (alloc.amount <= 0) throw new DomainError(400, 'INVALID_ALLOCATION', 'Allocation must be positive.');
      const charge = data.clientCharges.find((c) => c.id === alloc.chargeId && c.memberId === member.id);
      if (!charge) throw new DomainError(404, 'CHARGE_NOT_FOUND', 'Referenced charge not found for this member.');
      if (charge.status === 'ON_HOLD') {
        throw new DomainError(409, 'CHARGE_ON_HOLD', 'Cannot settle a charge that is currently on dispute hold.');
      }
      const remaining = Math.round((charge.amount - charge.receivedAmount) * 100) / 100;
      if (alloc.amount > remaining + 0.001) {
        throw new DomainError(400, 'OVERPAYMENT_BLOCKED', `Allocation ₹${alloc.amount} exceeds remaining balance ₹${remaining}.`);
      }
      allocatedSum = Math.round((allocatedSum + alloc.amount) * 100) / 100;
    }

    if (Math.abs(allocatedSum - input.amount) > 0.01) {
      throw new DomainError(400, 'ALLOCATION_MISMATCH', `Allocated total (₹${allocatedSum}) must equal receipt amount (₹${input.amount}).`);
    }

    // Apply allocations atomically
    for (const alloc of input.allocations) {
      const charge = data.clientCharges.find((c) => c.id === alloc.chargeId)!;
      charge.receivedAmount = Math.round((charge.receivedAmount + alloc.amount) * 100) / 100;
      charge.status = charge.receivedAmount >= charge.amount ? 'FULLY_PAID' : 'PARTIALLY_PAID';
    }

    const receipt: ClientReceipt = {
      id: this.id('rcpt'),
      namespace: actor.namespace,
      coordinatorId: member.coordinatorId,
      memberId: member.id,
      amount: input.amount,
      paymentDate: input.paymentDate || getTomorrowInKolkata(new Date(this.referenceDateProvider().getTime() - 86400000)),
      method: input.method,
      reference: input.reference.trim(),
      notes: input.notes?.trim(),
      allocations: input.allocations,
      actorUserId: actor.id,
      idempotencyKey: input.idempotencyKey,
      createdAt: this.now(),
    };
    data.clientReceipts.unshift(receipt);

    this.logAudit(
      actor,
      'RECEIPT_RECORDED',
      'client_receipt',
      receipt.id,
      `Recorded ₹${receipt.amount} receipt from ${member.name} via ${receipt.method} (${receipt.reference}) across ${receipt.allocations.length} meeting(s)`,
      member.coordinatorId
    );

    return { receipt, idempotentReplay: false };
  }

  public recordFreelancerPayout(
    actor: SessionUser,
    input: {
      payeeSubstituteId: string;
      amount: number; // Applied to meeting earnings
      bonusAmount?: number; // Optional discretionary appreciation bonus (agency cost, never member bill)
      bonusMessage?: string;
      paymentDate: string;
      method: PaymentMethod;
      reference: string;
      notes?: string;
      allocations: PayoutAllocation[];
      idempotencyKey?: string;
    }
  ): { payout: FreelancerPayout; idempotentReplay: boolean } {
    this.assertRole(actor, ['SUPER_ADMIN', 'EXTERNAL_COORDINATOR']);
    const data = this.ds(actor.namespace);

    if (input.idempotencyKey) {
      const existing = data.freelancerPayouts.find((p) => p.idempotencyKey === input.idempotencyKey);
      if (existing) return { payout: existing, idempotentReplay: true };
    }

    const sub = data.substitutes.find((s) => s.id === input.payeeSubstituteId);
    if (!sub) throw new DomainError(404, 'SUB_NOT_FOUND', 'Registered substitute not found.');

    const bonusAmount = Math.max(0, Number(input.bonusAmount) || 0);
    const meetingAmount = Math.max(0, Number(input.amount) || 0);
    if (meetingAmount <= 0 && bonusAmount <= 0) {
      throw new DomainError(400, 'INVALID_AMOUNT', 'Payout amount must be positive.');
    }
    if (!input.reference?.trim()) {
      throw new DomainError(400, 'REFERENCE_REQUIRED', 'Transfer reference / UPI ID is required.');
    }

    let allocatedSum = 0;
    let ownerCoordinatorId = actor.coordinatorId!;

    for (const alloc of input.allocations) {
      if (alloc.amount <= 0) throw new DomainError(400, 'INVALID_ALLOCATION', 'Allocation must be positive.');
      const earning = data.substituteEarnings.find(
        (e) => e.id === alloc.earningId && e.payeeSubstituteId === sub.id
      );
      if (!earning) throw new DomainError(404, 'EARNING_NOT_FOUND', 'Referenced payable line not found for this substitute.');
      if (!this.canAccessCoordinatorScope(actor, earning.coordinatorId)) {
        throw new DomainError(403, 'FORBIDDEN', 'Cannot settle earnings belonging to another coordinator.');
      }
      if (earning.status === 'ON_HOLD') {
        throw new DomainError(409, 'EARNING_ON_HOLD', 'Cannot pay out an earning line currently on dispute hold.');
      }
      const remaining = Math.round((earning.amount - earning.paidAmount) * 100) / 100;
      if (alloc.amount > remaining + 0.001) {
        throw new DomainError(400, 'OVERPAYMENT_BLOCKED', `Allocation ₹${alloc.amount} exceeds remaining payable ₹${remaining}.`);
      }
      ownerCoordinatorId = earning.coordinatorId;
      allocatedSum = Math.round((allocatedSum + alloc.amount) * 100) / 100;
    }

    if (Math.abs(allocatedSum - meetingAmount) > 0.01) {
      throw new DomainError(400, 'ALLOCATION_MISMATCH', `Allocated meeting sum (₹${allocatedSum}) must equal payout meeting amount (₹${meetingAmount}).`);
    }

    for (const alloc of input.allocations) {
      const earning = data.substituteEarnings.find((e) => e.id === alloc.earningId)!;
      earning.paidAmount = Math.round((earning.paidAmount + alloc.amount) * 100) / 100;
      earning.status = earning.paidAmount >= earning.amount ? 'FULLY_PAID' : 'PARTIALLY_PAID';
    }

    const now = this.now();
    const payoutId = this.id('pay');
    const payout: FreelancerPayout = {
      id: payoutId,
      namespace: actor.namespace,
      coordinatorId: ownerCoordinatorId,
      payeeSubstituteId: sub.id,
      amount: meetingAmount,
      bonusAmount,
      bonusMessage: bonusAmount > 0 ? (input.bonusMessage?.trim() || 'Thank you for your outstanding contribution!') : undefined,
      totalTransferred: Math.round((meetingAmount + bonusAmount) * 100) / 100,
      paymentDate: input.paymentDate || getTomorrowInKolkata(new Date(this.referenceDateProvider().getTime() - 86400000)),
      method: input.method,
      reference: input.reference.trim(),
      notes: input.notes?.trim(),
      allocations: input.allocations,
      actorUserId: actor.id,
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
    };
    data.freelancerPayouts.unshift(payout);

    if (bonusAmount > 0) {
      data.appreciationBonuses.unshift({
        id: this.id('bon'),
        namespace: actor.namespace,
        payoutId,
        coordinatorId: ownerCoordinatorId,
        payeeSubstituteId: sub.id,
        amount: bonusAmount,
        message: payout.bonusMessage!,
        idempotencyKey: input.idempotencyKey,
        createdAt: now,
      });
    }

    this.pushNotification(
      actor.namespace,
      sub.userId,
      `Payout Settled — ₹${payout.totalTransferred}`,
      `Paid ₹${meetingAmount}${bonusAmount > 0 ? ` + ₹${bonusAmount} Appreciation Bonus` : ''} via ${payout.method} (${payout.reference}).`,
      'FINANCE',
      payout.id
    );

    this.logAudit(
      actor,
      'PAYOUT_RECORDED',
      'freelancer_payout',
      payout.id,
      `Paid ₹${meetingAmount}${bonusAmount > 0 ? ` + ₹${bonusAmount} bonus` : ''} to ${sub.name} (${payout.reference})`,
      ownerCoordinatorId
    );

    return { payout, idempotentReplay: false };
  }

  public recordCoordinatorCommissionPayout(
    actor: SessionUser,
    commissionId: string,
    input: {
      amount: number;
      paymentDate: string;
      method: PaymentMethod;
      reference: string;
    }
  ): CoordinatorCommission {
    this.assertRole(actor, ['SUPER_ADMIN']);
    const data = this.ds(actor.namespace);
    const comm = data.coordinatorCommissions.find((c) => c.id === commissionId);
    if (!comm) throw new DomainError(404, 'NOT_FOUND', 'Coordinator commission record not found.');
    const amount = Number(input.amount);
    if (!amount || amount <= 0) throw new DomainError(400, 'INVALID_AMOUNT', 'Commission payout amount must be positive.');
    if (!input.reference?.trim()) throw new DomainError(400, 'REFERENCE_REQUIRED', 'Transfer reference is required.');
    const remaining = Math.round((comm.amount - comm.paidAmount) * 100) / 100;
    if (amount > remaining + 0.001) {
      throw new DomainError(400, 'OVERPAYMENT_BLOCKED', `Payout ₹${amount} exceeds remaining commission ₹${remaining}.`);
    }
    comm.paidAmount = Math.round((comm.paidAmount + amount) * 100) / 100;
    comm.status = comm.paidAmount >= comm.amount ? 'FULLY_PAID' : 'PARTIALLY_PAID';
    comm.paymentDate = input.paymentDate || getTomorrowInKolkata(new Date(this.referenceDateProvider().getTime() - 86400000));
    comm.paymentMethod = input.method;
    comm.paymentReference = input.reference.trim();
    const coord = data.coordinators.find((c) => c.id === comm.coordinatorId);
    this.logAudit(
      actor,
      'COMMISSION_PAYOUT_RECORDED',
      'coordinator_commission',
      comm.id,
      `Paid ₹${amount} approved coordinator commission to ${coord?.name ?? comm.coordinatorId} (${comm.paymentReference})`,
      comm.coordinatorId
    );
    return comm;
  }

  public logMessageDraft(
    actor: SessionUser,
    input: {
      templateType: string;
      recipientLabel: string;
      recipientPhone: string;
      body: string;
      deliveryState: MessageDeliveryState;
      existingId?: string;
    }
  ) {
    const data = this.ds(actor.namespace);
    const now = this.now();
    if (input.existingId) {
      const existing = data.messageLogs.find((m) => m.id === input.existingId);
      if (existing) {
        existing.deliveryState = input.deliveryState;
        existing.updatedAt = now;
        return existing;
      }
    }
    const log = {
      id: this.id('msg'),
      namespace: actor.namespace,
      coordinatorId: actor.coordinatorId,
      actorUserId: actor.id,
      templateType: input.templateType,
      recipientLabel: input.recipientLabel,
      recipientPhone: input.recipientPhone,
      body: input.body,
      deliveryState: input.deliveryState,
      createdAt: now,
      updatedAt: now,
    };
    data.messageLogs.unshift(log);
    return log;
  }

  public markNotificationRead(actor: SessionUser, notificationId: string) {
    const n = this.ds(actor.namespace).notifications.find(
      (item) => item.id === notificationId && item.recipientUserId === actor.id
    );
    if (n) n.read = true;
    return n;
  }
}
