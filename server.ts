import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { AgencyStore, DomainError } from './src/core/store';
import type { Namespace, SessionUser } from './src/core/types';

const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const store = new AgencyStore();
const revokedTokens = new Set<string>();

interface TokenPayload {
  sub: string;
  ns: Namespace;
  exp: number;
  jti: string;
}

function signToken(user: SessionUser): string {
  const payload: TokenPayload = {
    sub: user.id,
    ns: user.namespace,
    exp: Date.now() + 1000 * 60 * 60 * 12,
    jti: crypto.randomBytes(10).toString('hex'),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token: string): TokenPayload | null {
  if (!token || revokedTokens.has(token)) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (!parsed.sub || !parsed.ns || parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

interface AuthedRequest extends Request {
  actor?: SessionUser;
  rawToken?: string;
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ code: 'UNAUTHORIZED', error: 'Authentication required.' });
    return;
  }
  const token = match[1];
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ code: 'INVALID_SESSION', error: 'Session expired or invalid.' });
    return;
  }
  try {
    // Always re-resolve active user & server-controlled role from backend store
    req.actor = store.resolveActiveActor(payload.ns, payload.sub);
    req.rawToken = token;
    next();
  } catch (err) {
    handleError(err, res);
  }
}

function handleError(err: unknown, res: Response): void {
  if (err instanceof DomainError) {
    res.status(err.status).json({ code: err.code, error: err.message });
    return;
  }
  console.error('[AgencyOS API Error]', err);
  res.status(500).json({ code: 'INTERNAL_ERROR', error: 'An unexpected server error occurred.' });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // ==================== PUBLIC AUTH ROUTES ====================

  app.get('/api/auth/status', (_req, res) => {
    res.json({
      workspaceInitialized: store.hasWorkspaceAdmin(),
      supabaseConnected: false,
      environmentMode: 'LOCAL_SANDBOX_WITH_ISOLATED_DEMO',
    });
  });

  app.post('/api/auth/bootstrap-admin', (req, res) => {
    try {
      const user = store.bootstrapWorkspaceAdmin(req.body);
      const token = signToken(user);
      res.status(201).json({ token, user });
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post('/api/auth/login', (req, res) => {
    try {
      const { email, password } = req.body ?? {};
      const user = store.loginWorkspace(String(email || ''), String(password || ''));
      const token = signToken(user);
      res.json({ token, user });
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post('/api/auth/demo-login', (req, res) => {
    try {
      const { roleKey } = req.body ?? {};
      if (!['SA', 'EC', 'SUB'].includes(roleKey)) {
        throw new DomainError(400, 'INVALID_DEMO_ROLE', 'Choose SA, EC, or SUB for demo login.');
      }
      const user = store.loginDemo(roleKey);
      const token = signToken(user);
      res.json({ token, user });
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post('/api/auth/forgot-password', (req, res) => {
    try {
      const result = store.requestPasswordReset(String(req.body?.email || ''));
      res.json(result);
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post('/api/auth/reset-password', (req, res) => {
    try {
      const { email, token, newPassword } = req.body ?? {};
      store.completePasswordReset(String(email || ''), String(token || ''), String(newPassword || ''));
      res.json({ ok: true });
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post('/api/auth/accept-invite', (req, res) => {
    try {
      const { email, inviteToken, password } = req.body ?? {};
      const user = store.acceptInvite(String(email || ''), String(inviteToken || ''), String(password || ''));
      const token = signToken(user);
      res.json({ token, user });
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post('/api/auth/logout', requireAuth, (req: AuthedRequest, res) => {
    if (req.rawToken) revokedTokens.add(req.rawToken);
    res.json({ ok: true });
  });

  // ==================== PROTECTED WORKSPACE ROUTES ====================

  app.get('/api/bootstrap', requireAuth, (req: AuthedRequest, res) => {
    try {
      res.json(store.getBootstrapPayload(req.actor!));
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post('/api/demo/reset', requireAuth, (req: AuthedRequest, res) => {
    try {
      store.resetDemoAuthorized(req.actor!);
      res.json(store.getBootstrapPayload(req.actor!));
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post('/api/admin/clear-transactions', requireAuth, (req: AuthedRequest, res) => {
    try {
      const result = store.clearTestingTransactions(req.actor!);
      res.json(result);
    } catch (err) {
      handleError(err, res);
    }
  });

  app.delete('/api/admin/entities/:type/:id', requireAuth, (req: AuthedRequest, res) => {
    try {
      const entityType = String(req.params.type) as 'member' | 'substitute' | 'request' | 'chapter' | 'location';
      res.json(store.deleteEntity(req.actor!, entityType, String(req.params.id)));
    } catch (err) {
      handleError(err, res);
    }
  });

  // Users & Invites
  app.post('/api/users/invite', requireAuth, (req: AuthedRequest, res) => {
    try {
      const result = store.inviteUser(req.actor!, req.body);
      res.status(201).json(result);
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post('/api/users/:id/admin-reset-password', requireAuth, (req: AuthedRequest, res) => {
    try {
      const result = store.adminResetUserPassword(
        req.actor!,
        String(req.params.id),
        req.body?.newPassword !== undefined ? String(req.body.newPassword) : undefined
      );
      res.json(result);
    } catch (err) {
      handleError(err, res);
    }
  });

  app.patch('/api/users/:id/status', requireAuth, (req: AuthedRequest, res) => {
    try {
      store.setUserActiveStatus(req.actor!, String(req.params.id), Boolean(req.body?.active));
      res.json({ ok: true });
    } catch (err) {
      handleError(err, res);
    }
  });

  // Masters
  app.post('/api/locations', requireAuth, (req: AuthedRequest, res) => {
    try {
      res.status(201).json(store.upsertLocation(req.actor!, req.body));
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post('/api/chapters', requireAuth, (req: AuthedRequest, res) => {
    try {
      res.status(201).json(store.upsertChapter(req.actor!, req.body));
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post('/api/members', requireAuth, (req: AuthedRequest, res) => {
    try {
      res.status(201).json(store.upsertMember(req.actor!, req.body));
    } catch (err) {
      handleError(err, res);
    }
  });

  app.get('/api/members/:id', requireAuth, (req: AuthedRequest, res) => {
    try {
      res.json(store.getMemberById(req.actor!, String(req.params.id)));
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post('/api/substitutes', requireAuth, (req: AuthedRequest, res) => {
    try {
      res.status(201).json(store.upsertSubstitute(req.actor!, req.body));
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post('/api/partner-guests', requireAuth, (req: AuthedRequest, res) => {
    try {
      res.status(201).json(store.upsertPartnerGuestContact(req.actor!, req.body));
    } catch (err) {
      handleError(err, res);
    }
  });

  // Requests & Responses
  app.post('/api/requests', requireAuth, (req: AuthedRequest, res) => {
    try {
      res.status(201).json(store.createRequest(req.actor!, req.body));
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post('/api/requests/:id/cancel', requireAuth, (req: AuthedRequest, res) => {
    try {
      res.json(store.cancelRequest(req.actor!, String(req.params.id), String(req.body?.reason || '')));
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post('/api/requests/:id/respond', requireAuth, (req: AuthedRequest, res) => {
    try {
      res.json(store.submitResponse(req.actor!, String(req.params.id), req.body));
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post('/api/responses/:id/approve', requireAuth, (req: AuthedRequest, res) => {
    try {
      const opts = {
        overridePayout: req.body?.overridePayout !== undefined ? Number(req.body.overridePayout) : undefined,
        assignedViaCoordinatorId: req.body?.assignedViaCoordinatorId ? String(req.body.assignedViaCoordinatorId) : undefined,
        coordinatorCommissionAmount:
          req.body?.coordinatorCommissionAmount !== undefined
            ? Number(req.body.coordinatorCommissionAmount)
            : undefined,
      };
      res.json(store.approveResponseAndConfirm(req.actor!, String(req.params.id), opts));
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post('/api/responses/:id/reject', requireAuth, (req: AuthedRequest, res) => {
    try {
      res.json(store.rejectResponse(req.actor!, String(req.params.id), req.body?.reason));
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post('/api/responses/:id/request-changes', requireAuth, (req: AuthedRequest, res) => {
    try {
      res.json(store.requestResponseChanges(req.actor!, String(req.params.id), String(req.body?.reason || '')));
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post('/api/assignments/:id/replace', requireAuth, (req: AuthedRequest, res) => {
    try {
      res.json(store.replaceAssignmentAttendee(req.actor!, String(req.params.id), req.body ?? {}));
    } catch (err) {
      handleError(err, res);
    }
  });

  // Check-ins, Finish, Disputes & Verification
  app.post('/api/assignments/:id/checkin', requireAuth, (req: AuthedRequest, res) => {
    try {
      res.json(store.recordCheckin(req.actor!, String(req.params.id), req.body?.eventType, req.body?.note));
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post('/api/assignments/:id/finish', requireAuth, (req: AuthedRequest, res) => {
    try {
      res.json(store.finishAssignmentAtomic(req.actor!, String(req.params.id), req.body ?? {}));
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post('/api/assignments/:id/verify', requireAuth, (req: AuthedRequest, res) => {
    try {
      res.json(store.verifyAssignment(req.actor!, String(req.params.id)));
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post('/api/assignments/:id/dispute', requireAuth, (req: AuthedRequest, res) => {
    try {
      res.json(
        store.openDisputeAndHold(
          req.actor!,
          String(req.params.id),
          String(req.body?.reason || ''),
          req.body?.holdSettlement !== false
        )
      );
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post('/api/assignments/:id/adjust', requireAuth, (req: AuthedRequest, res) => {
    try {
      res.json(
        store.adjustDisputedLedger(req.actor!, String(req.params.id), {
          chargeDelta: Number(req.body?.chargeDelta || 0),
          earningDelta: Number(req.body?.earningDelta || 0),
          reason: String(req.body?.reason || ''),
        })
      );
    } catch (err) {
      handleError(err, res);
    }
  });

  // Finance
  app.post('/api/finance/receipts', requireAuth, (req: AuthedRequest, res) => {
    try {
      res.status(201).json(store.recordClientReceipt(req.actor!, req.body));
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post('/api/finance/payouts', requireAuth, (req: AuthedRequest, res) => {
    try {
      res.status(201).json(store.recordFreelancerPayout(req.actor!, req.body));
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post('/api/finance/commissions/:id/pay', requireAuth, (req: AuthedRequest, res) => {
    try {
      res.status(201).json(store.recordCoordinatorCommissionPayout(req.actor!, String(req.params.id), req.body));
    } catch (err) {
      handleError(err, res);
    }
  });

  // Message Logs & Notifications
  app.post('/api/messages/log', requireAuth, (req: AuthedRequest, res) => {
    try {
      res.status(201).json(store.logMessageDraft(req.actor!, req.body));
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post('/api/notifications/:id/read', requireAuth, (req: AuthedRequest, res) => {
    try {
      res.json(store.markNotificationRead(req.actor!, String(req.params.id)) ?? { ok: true });
    } catch (err) {
      handleError(err, res);
    }
  });

  // Mount Vite middleware in dev or serve dist in prod
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AgencyOS server listening on http://localhost:${PORT}`);
  });
}

startServer();
