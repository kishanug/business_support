import React, { useState } from 'react';
import { History, LogOut, RotateCcw, ShieldCheck, Trash2, X } from 'lucide-react';
import type { AuditEvent, SessionUser } from '../core/types';

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  user: SessionUser;
  auditEvents?: AuditEvent[];
  onLogout: () => void;
  onResetDemo?: () => Promise<void> | void;
  onClearTransactions?: () => Promise<void> | void;
}

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({
  open,
  onClose,
  user,
  auditEvents = [],
  onLogout,
  onResetDemo,
  onClearTransactions,
}) => {
  const [confirmMode, setConfirmMode] = useState<'NONE' | 'RESET_DEMO' | 'CLEAR_TX'>('NONE');
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const isSuperAdmin = user.role === 'SUPER_ADMIN';

  async function runConfirmedAction(action: 'RESET_DEMO' | 'CLEAR_TX') {
    setBusy(true);
    try {
      if (action === 'RESET_DEMO' && onResetDemo) {
        await onResetDemo();
      } else if (action === 'CLEAR_TX' && onClearTransactions) {
        await onClearTransactions();
      }
      setConfirmMode('NONE');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-[#142342]/45 backdrop-blur-[2px] flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Account and workspace settings"
    >
      <div className="w-full max-w-md bg-white h-full border-l border-[#E6E8EF] flex flex-col">
        <div className="px-5 h-16 border-b border-[#E6E8EF] flex items-center justify-between">
          <div>
            <h2 className="font-display text-base font-bold text-[#142342]">Account &amp; Audit</h2>
            <p className="text-xs text-[#64748B]">{user.email}</p>
          </div>
          <button
            type="button"
            aria-label="Close settings"
            onClick={onClose}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-[#64748B] hover:bg-[#F8F7FC]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Profile Summary */}
          <div className="p-4 rounded-xl bg-[#F8F7FC] border border-[#E6E8EF] space-y-1.5 text-xs">
            <p className="font-display text-sm font-bold text-[#142342]">{user.displayName}</p>
            <p className="text-[#475569]">
              Server-verified role: <strong className="text-[#6D28D9]">{user.role.replace(/_/g, ' ')}</strong>
            </p>
            <p className="text-[#475569]">
              Workspace partition: <strong className="text-[#142342]">{user.namespace === 'demo' ? 'Isolated Demo Sandbox' : 'Local Workspace'}</strong>
            </p>
            {user.canManageNetwork && (
              <p className="text-[#B58F3D] font-semibold">Partner Network Permission Enabled</p>
            )}
          </div>

          {/* Super Admin Testing & Data Maintenance Controls */}
          {isSuperAdmin && (onResetDemo || onClearTransactions) && (
            <div className="p-4 rounded-xl border border-[#E6E8EF] bg-white space-y-3 text-xs">
              <div>
                <p className="font-display text-sm font-bold text-[#142342]">
                  Super Admin Data Maintenance
                </p>
                <p className="text-[#64748B] mt-0.5 leading-relaxed">
                  Clean up test entries after QA without losing accounts or directory master records.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {user.namespace === 'demo' && onResetDemo && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmMode('RESET_DEMO')}
                    className="h-9 px-3 rounded-lg border border-[#E6E8EF] bg-[#F8F7FC] hover:bg-[#F3E8FF]/60 text-xs font-semibold text-[#142342] inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-[#6D28D9]" />
                    Reset Demo Data
                  </button>
                )}

                {onClearTransactions && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmMode('CLEAR_TX')}
                    className="h-9 px-3 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-xs font-semibold text-red-700 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear Testing Transactions
                  </button>
                )}
              </div>

              {confirmMode === 'RESET_DEMO' && (
                <div className="p-3 rounded-lg bg-[#F3E8FF]/60 border border-[#DDD6FE] space-y-2">
                  <p className="font-semibold text-[#142342]">
                    Restore clean demo seed dataset?
                  </p>
                  <p className="text-[11px] text-[#475569]">
                    All edits made in the isolated demo partition will be reset to baseline fixtures.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => runConfirmedAction('RESET_DEMO')}
                      className="h-8 px-3 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold cursor-pointer"
                    >
                      {busy ? 'Resetting...' : 'Confirm Reset'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmMode('NONE')}
                      className="h-8 px-3 rounded-lg border border-[#E6E8EF] bg-white text-xs font-medium text-[#475569] cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {confirmMode === 'CLEAR_TX' && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 space-y-2">
                  <p className="font-semibold text-red-800">
                    Clear all requests, assignments &amp; finance ledgers?
                  </p>
                  <p className="text-[11px] text-red-700">
                    User accounts, chapters, venues, members, and substitutes remain intact. An audit entry will be recorded.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => runConfirmedAction('CLEAR_TX')}
                      className="h-8 px-3 rounded-lg bg-red-600 text-white text-xs font-semibold cursor-pointer"
                    >
                      {busy ? 'Clearing...' : 'Confirm Clear All'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmMode('NONE')}
                      className="h-8 px-3 rounded-lg border border-red-200 bg-white text-xs font-medium text-red-700 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Environment Honesty Disclosure */}
          <div className="p-4 rounded-xl border border-[#E6E8EF] space-y-1.5 text-xs">
            <p className="font-semibold text-[#142342] inline-flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[#B58F3D]" />
              Backend &amp; Database Status
            </p>
            <p className="text-[#475569] leading-relaxed">
              Running on the local Express/TypeScript transactional server with strict server-side RBAC and isolated Demo vs Workspace namespaces. No external Supabase project is connected in this environment; full Supabase PostgreSQL schema, RLS policies, RPCs, and negative tests are included in <code className="font-mono text-[11px]">/supabase/migrations/</code>.
            </p>
          </div>

          {/* Audit Trail (Admin & Coordinator) */}
          {user.role !== 'SUBSTITUTE' && (
            <div className="space-y-2.5">
              <h3 className="font-display text-sm font-bold text-[#142342] inline-flex items-center gap-1.5">
                <History className="w-4 h-4 text-[#6D28D9]" />
                Recent Audit Trail ({auditEvents.length})
              </h3>
              <div className="divide-y divide-[#E6E8EF] rounded-xl border border-[#E6E8EF] bg-white max-h-72 overflow-y-auto">
                {auditEvents.length === 0 ? (
                  <p className="p-4 text-xs text-[#64748B]">No audit events yet.</p>
                ) : (
                  auditEvents.slice(0, 25).map((ev) => (
                    <div key={ev.id} className="p-3 text-xs">
                      <p className="font-semibold text-[#142342]">{ev.action.replace(/_/g, ' ')}</p>
                      <p className="text-[#475569] mt-0.5 leading-snug">{ev.summary}</p>
                      <p className="text-[11px] text-[#94A3B8] mt-1">
                        {ev.actorName} · {new Date(ev.createdAt).toLocaleString('en-IN')}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-[#E6E8EF] bg-[#F8F7FC] flex items-center justify-between gap-2">
          {isSuperAdmin && user.namespace === 'demo' && onResetDemo ? (
            <button
              type="button"
              onClick={() => setConfirmMode('RESET_DEMO')}
              className="h-10 px-3.5 rounded-xl border border-[#E6E8EF] bg-white hover:bg-[#F3E8FF]/40 text-xs font-semibold text-[#142342] inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Demo
            </button>
          ) : (
            <span />
          )}

          <button
            type="button"
            onClick={onLogout}
            className="h-10 px-4 rounded-xl bg-[#142342] hover:bg-[#26385E] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
};
