import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  api,
  ApiError,
  setAuthToken,
  type AdminBootstrapData,
  type BootstrapPayload,
  type SubstituteBootstrapData,
} from './lib/api';
import type { SessionUser } from './core/types';
import { LoginView } from './components/LoginView';
import { AppShell, type AdminTab, type SubTab } from './components/AppShell';
import { OverviewHome } from './components/OverviewHome';
import { RequestsView } from './components/RequestsView';
import { PeopleView } from './components/PeopleView';
import { FinanceView } from './components/FinanceView';
import { ReportsView } from './components/ReportsView';
import { SubstitutePortal } from './components/SubstitutePortal';
import { WhatsAppModal, type DraftMessageConfig } from './components/WhatsAppModal';
import { SettingsDrawer } from './components/SettingsDrawer';

export interface RequestsFilterIntent {
  chapterId?: string;
  status?: 'ALL' | 'OPEN' | 'CONFIRMED' | 'COMPLETED' | 'DISPUTED';
  coordinatorId?: string;
  date?: string;
  nonce?: number;
}

export interface FinanceFilterIntent {
  tab?: 'receipts' | 'payments' | 'commissions' | 'ledger';
  status?: 'ALL' | 'OUTSTANDING' | 'SETTLED' | 'ON_HOLD';
  viaCoordinatorId?: string;
  responsibleCoordinatorId?: string;
  chapterId?: string;
  nonce?: number;
}

function isSubData(payload: BootstrapPayload): payload is SubstituteBootstrapData {
  return payload.actor.role === 'SUBSTITUTE';
}

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('tab') || 'home';
  });
  const [openCreateRequest, setOpenCreateRequest] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [requestsFilterIntent, setRequestsFilterIntent] = useState<RequestsFilterIntent | null>(() => {
    const p = new URLSearchParams(window.location.search);
    const chapterId = p.get('chapter') || undefined;
    const status = (p.get('status') as RequestsFilterIntent['status']) || undefined;
    const coordinatorId = p.get('coord') || undefined;
    const date = p.get('date') || undefined;
    if (chapterId || status || coordinatorId || date) {
      return { chapterId, status, coordinatorId, date, nonce: 1 };
    }
    return null;
  });
  const [financeFilterIntent, setFinanceFilterIntent] = useState<FinanceFilterIntent | null>(() => {
    const p = new URLSearchParams(window.location.search);
    const tab = (p.get('fTab') as FinanceFilterIntent['tab']) || undefined;
    const status = (p.get('fStatus') as FinanceFilterIntent['status']) || undefined;
    const viaCoordinatorId = p.get('via') || undefined;
    const responsibleCoordinatorId = p.get('fCoord') || undefined;
    const chapterId = p.get('fChapter') || undefined;
    if (tab || status || viaCoordinatorId || responsibleCoordinatorId || chapterId) {
      return { tab, status, viaCoordinatorId, responsibleCoordinatorId, chapterId, nonce: 1 };
    }
    return null;
  });
  const [draftModal, setDraftModal] = useState<DraftMessageConfig | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const syncUrlParams = useCallback((updates: Record<string, string | undefined>) => {
    try {
      const url = new URL(window.location.href);
      for (const [k, v] of Object.entries(updates)) {
        if (v) url.searchParams.set(k, v);
        else url.searchParams.delete(k);
      }
      window.history.replaceState({}, '', url.toString());
    } catch {
      // ignore restricted history environments
    }
  }, []);

  const handleSelectTab = useCallback(
    (tab: string) => {
      setActiveTab(tab);
      syncUrlParams({ tab });
    },
    [syncUrlParams]
  );

  const handleDrillToRequests = useCallback(
    (intent: Omit<RequestsFilterIntent, 'nonce'>) => {
      setRequestsFilterIntent({ ...intent, nonce: Date.now() });
      setActiveTab('requests');
      syncUrlParams({
        tab: 'requests',
        chapter: intent.chapterId,
        status: intent.status && intent.status !== 'ALL' ? intent.status : undefined,
        coord: intent.coordinatorId,
        date: intent.date,
      });
    },
    [syncUrlParams]
  );

  const handleDrillToFinance = useCallback(
    (intent: Omit<FinanceFilterIntent, 'nonce'>) => {
      setFinanceFilterIntent({ ...intent, nonce: Date.now() });
      setActiveTab('finance');
      syncUrlParams({
        tab: 'finance',
        fTab: intent.tab,
        fStatus: intent.status && intent.status !== 'ALL' ? intent.status : undefined,
        via: intent.viaCoordinatorId,
        fCoord: intent.responsibleCoordinatorId,
        fChapter: intent.chapterId,
      });
    },
    [syncUrlParams]
  );

  const loadBootstrap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await api.getBootstrap();
      setData(payload);
      setUser(payload.actor);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setAuthToken(null);
        setUser(null);
        setData(null);
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Unable to reach AgencyOS server.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Optional ?autostart=1|SA|EC|SUB query hook for rapid verification without exposing debug UI
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const auto = params.get('autostart');
    if (auto && !user) {
      const roleKey = auto === 'EC' || auto === 'SUB' ? auto : 'SA';
      api
        .demoLogin(roleKey)
        .then(({ token, user: u }) => {
          setAuthToken(token);
          setUser(u);
          if (!params.get('tab')) setActiveTab('home');
          return loadBootstrap();
        })
        .catch(() => {});
    }
  }, [user, loadBootstrap]);

  async function handleAuthenticated(authenticatedUser: SessionUser) {
    setUser(authenticatedUser);
    handleSelectTab('home');
    await loadBootstrap();
  }

  async function handleLogout() {
    try {
      await api.logout();
    } catch {
      // ignore network error during sign out
    }
    setAuthToken(null);
    setUser(null);
    setData(null);
    setSettingsOpen(false);
    handleSelectTab('home');
  }

  async function handleResetDemo() {
    setLoading(true);
    try {
      const fresh = await api.resetDemo();
      setData(fresh);
      setSettingsOpen(false);
    } finally {
      setLoading(false);
    }
  }

  async function handleClearTestingTransactions() {
    setLoading(true);
    try {
      await api.clearTestingTransactions();
      await loadBootstrap();
      setSettingsOpen(false);
    } finally {
      setLoading(false);
    }
  }

  async function handleMarkNotifRead(id: string) {
    try {
      await api.markNotificationRead(id);
      await loadBootstrap();
    } catch {
      // ignore
    }
  }

  if (!user) {
    return <LoginView onAuthenticated={handleAuthenticated} />;
  }

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center">
        <img
          src="/assets/aistudio/image__1__81460661.png"
          alt="AgencyOS"
          className="h-12 w-auto object-contain mb-4 opacity-90"
        />
        <p className="font-display text-sm font-bold text-[#142342]">Loading AgencyOS workspace...</p>
        <p className="text-xs text-[#64748B] mt-1">Verifying server-scoped permissions</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto">
        <p className="font-display text-base font-bold text-red-700">Connection or Authorization Error</p>
        <p className="text-xs text-[#475569] mt-2">{error}</p>
        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={loadBootstrap}
            className="h-10 px-4 rounded-xl bg-[#6D28D9] text-white text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="h-10 px-4 rounded-xl border border-[#E6E8EF] text-xs font-semibold text-[#142342]"
          >
            Back to Sign In
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const isSub = isSubData(data);
  const adminData = isSub ? null : (data as AdminBootstrapData);
  const isSuperAdmin = data.actor.role === 'SUPER_ADMIN';

  return (
    <>
      <AppShell
        user={data.actor}
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        notifications={data.notifications}
        onMarkNotificationRead={handleMarkNotifRead}
        onLogout={handleLogout}
        onResetDemo={isSuperAdmin && data.actor.namespace === 'demo' ? handleResetDemo : undefined}
        onOpenSettings={() => setSettingsOpen(true)}
      >
        {isSub ? (
          <SubstitutePortal
            data={data}
            activeTab={activeTab as SubTab}
            onSelectTab={(t) => handleSelectTab(t)}
            onRefresh={loadBootstrap}
          />
        ) : (
          adminData && (
            <>
              {activeTab === 'home' && (
                <OverviewHome
                  data={adminData}
                  onOpenNewRequest={() => {
                    setOpenCreateRequest(true);
                    handleSelectTab('requests');
                  }}
                  onSelectRequest={(reqId) => {
                    setSelectedRequestId(reqId);
                    handleSelectTab('requests');
                  }}
                  onNavigateTab={(t: AdminTab) => handleSelectTab(t)}
                  onDrillToRequests={handleDrillToRequests}
                  onDrillToFinance={handleDrillToFinance}
                  onVerifyAssignment={async (asgnId) => {
                    await api.verifyAssignment(asgnId);
                    await loadBootstrap();
                  }}
                />
              )}

              {activeTab === 'requests' && (
                <RequestsView
                  data={adminData}
                  initialOpenCreate={openCreateRequest}
                  initialSelectedRequestId={selectedRequestId}
                  filterIntent={requestsFilterIntent}
                  onClearInitials={() => {
                    setOpenCreateRequest(false);
                    setSelectedRequestId(null);
                  }}
                  onRefresh={loadBootstrap}
                  onOpenDraft={setDraftModal}
                />
              )}

              {activeTab === 'people' && (
                <PeopleView
                  data={adminData}
                  onRefresh={loadBootstrap}
                  onOpenDraft={setDraftModal}
                />
              )}

              {activeTab === 'finance' && (
                <FinanceView
                  data={adminData}
                  filterIntent={financeFilterIntent}
                  onRefresh={loadBootstrap}
                  onOpenDraft={setDraftModal}
                />
              )}

              {activeTab === 'reports' && <ReportsView data={adminData} />}
            </>
          )
        )}
      </AppShell>

      <WhatsAppModal
        draft={draftModal}
        onClose={() => setDraftModal(null)}
        onLogged={loadBootstrap}
      />

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        user={data.actor}
        auditEvents={adminData?.auditEvents}
        onLogout={handleLogout}
        onResetDemo={isSuperAdmin && data.actor.namespace === 'demo' ? handleResetDemo : undefined}
        onClearTransactions={isSuperAdmin ? handleClearTestingTransactions : undefined}
      />
    </>
  );
}
