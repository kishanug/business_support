import React, { useMemo, useState } from 'react';
import {
  Building2,
  ChevronDown,
  ChevronUp,
  Edit3,
  Home,
  KeyRound,
  Layers,
  List,
  Mail,
  MapPin,
  MessageCircle,
  Network,
  Phone,
  Plus,
  Power,
  Search,
  Shield,
  Tag,
  Trash2,
  User,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react';
import { api, ApiError, type AdminBootstrapData } from '../lib/api';
import {
  buildMemberCheckinWhatsAppText,
  buildTeamAvailabilityWhatsAppText,
  buildTelHref,
  formatINR,
  normalizeLocationHub,
} from '../core/rules';
import type { Chapter, Location, Member, Substitute, Weekday } from '../core/types';
import type { DraftMessageConfig } from './WhatsAppModal';

interface PeopleViewProps {
  data: AdminBootstrapData;
  onRefresh: () => Promise<void>;
  onOpenDraft: (draft: DraftMessageConfig) => void;
}

type PeopleTab = 'members' | 'substitutes' | 'chapters' | 'locations' | 'coordinators';

const WEEKDAYS: Weekday[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const PeopleView: React.FC<PeopleViewProps> = ({ data, onRefresh, onOpenDraft }) => {
  const isAdmin = data.actor.role === 'SUPER_ADMIN';
  const [tab, setTab] = useState<PeopleTab>('members');
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  // Member clustering & category/chapter filters
  const [memberViewMode, setMemberViewMode] = useState<'CLUSTERED' | 'FLAT'>('CLUSTERED');
  const [memberCategoryFilter, setMemberCategoryFilter] = useState('ALL');
  const [memberChapterFilter, setMemberChapterFilter] = useState('ALL');
  const [collapsedMemberClusters, setCollapsedMemberClusters] = useState<Record<string, boolean>>({});

  // Substitute clustering & location hub filter
  const [subViewMode, setSubViewMode] = useState<'CLUSTERED' | 'FLAT'>('CLUSTERED');
  const [subHubFilter, setSubHubFilter] = useState('ALL');
  const [collapsedSubClusters, setCollapsedSubClusters] = useState<Record<string, boolean>>({});

  // Inline delete confirmation state
  const [pendingDelete, setPendingDelete] = useState<{
    type: 'member' | 'substitute' | 'chapter' | 'location';
    id: string;
    label: string;
  } | null>(null);

  // Super Admin Password Reset modal
  const [pwResetTarget, setPwResetTarget] = useState<{
    userId: string;
    name: string;
    email: string;
    roleLabel: string;
  } | null>(null);
  const [pwResetValue, setPwResetValue] = useState('');
  const [pwResetMode, setPwResetMode] = useState<'SET_DIRECT' | 'GENERATE_TOKEN'>('SET_DIRECT');

  // Modals
  const [memberModal, setMemberModal] = useState<Partial<Member> | null>(null);
  const [subModal, setSubModal] = useState<
    (Partial<Substitute> & { initialPassword?: string; showOnLogin?: boolean }) | null
  >(null);
  const [chapterModal, setChapterModal] = useState<Partial<Chapter> | null>(null);
  const [locationModal, setLocationModal] = useState<Partial<Location> | null>(null);
  const [coordInviteModal, setCoordInviteModal] = useState(false);

  const [coordForm, setCoordForm] = useState({
    displayName: '',
    email: '',
    phone: '',
    whatsappPhone: '',
    region: '',
    initialPassword: '',
    showOnLogin: false,
  });

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const q = search.trim().toLowerCase();

  const businessCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of data.members) {
      if (!showInactive && !m.active) continue;
      const cat = m.businessCategory.trim();
      if (!cat) continue;
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [data.members, showInactive]);

  const filteredMembers = useMemo(
    () =>
      data.members.filter((m) => {
        if (!showInactive && !m.active) return false;
        if (memberChapterFilter !== 'ALL' && m.chapterId !== memberChapterFilter) return false;
        if (
          memberCategoryFilter !== 'ALL' &&
          m.businessCategory.trim().toLowerCase() !== memberCategoryFilter.toLowerCase()
        ) {
          return false;
        }
        if (!q) return true;
        const chap = data.chapters.find((c) => c.id === m.chapterId);
        return (
          m.name.toLowerCase().includes(q) ||
          m.businessCategory.toLowerCase().includes(q) ||
          m.businessName.toLowerCase().includes(q) ||
          (chap?.name.toLowerCase().includes(q) ?? false)
        );
      }),
    [data.members, data.chapters, showInactive, memberChapterFilter, memberCategoryFilter, q]
  );

  const memberClusters = useMemo(() => {
    const map = new Map<string, { chapterId: string; chapter?: Chapter; members: Member[] }>();
    for (const m of filteredMembers) {
      let g = map.get(m.chapterId);
      if (!g) {
        g = {
          chapterId: m.chapterId,
          chapter: data.chapters.find((c) => c.id === m.chapterId),
          members: [],
        };
        map.set(m.chapterId, g);
      }
      g.members.push(m);
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.chapter?.name ?? 'ZZZ').localeCompare(b.chapter?.name ?? 'ZZZ')
    );
  }, [filteredMembers, data.chapters]);

  const substituteHubs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of data.substitutes) {
      if (!showInactive && !s.active) continue;
      const hub = normalizeLocationHub(s.homeArea);
      counts.set(hub, (counts.get(hub) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([hub, count]) => ({ hub, count }))
      .sort((a, b) => b.count - a.count || a.hub.localeCompare(b.hub));
  }, [data.substitutes, showInactive]);

  const filteredSubstitutes = useMemo(
    () =>
      data.substitutes.filter((s) => {
        if (!showInactive && !s.active) return false;
        const hub = normalizeLocationHub(s.homeArea);
        if (subHubFilter !== 'ALL' && hub !== subHubFilter) return false;
        if (!q) return true;
        return (
          s.name.toLowerCase().includes(q) ||
          s.homeArea.toLowerCase().includes(q) ||
          hub.toLowerCase().includes(q)
        );
      }),
    [data.substitutes, showInactive, subHubFilter, q]
  );

  const substituteClusters = useMemo(() => {
    const map = new Map<string, { hub: string; substitutes: Substitute[] }>();
    for (const s of filteredSubstitutes) {
      const hub = normalizeLocationHub(s.homeArea);
      let g = map.get(hub);
      if (!g) {
        g = { hub, substitutes: [] };
        map.set(hub, g);
      }
      g.substitutes.push(s);
    }
    return Array.from(map.values()).sort((a, b) => b.substitutes.length - a.substitutes.length || a.hub.localeCompare(b.hub));
  }, [filteredSubstitutes]);

  async function saveMember(e: React.FormEvent) {
    e.preventDefault();
    if (!memberModal) return;
    setBusy(true);
    setError(null);
    try {
      await api.upsertMember(memberModal as Record<string, unknown>);
      await onRefresh();
      setMemberModal(null);
      setNotice('Member saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save member.');
    } finally {
      setBusy(false);
    }
  }

  async function saveSubstitute(e: React.FormEvent) {
    e.preventDefault();
    if (!subModal) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.upsertSubstitute(subModal as Record<string, unknown>);
      await onRefresh();
      setSubModal(null);
      setNotice(
        res.passwordConfigured
          ? 'Substitute account created with encrypted initial password (ready to sign in).'
          : res.inviteToken
          ? `Substitute added & invited. Sandbox invite token: ${res.inviteToken}`
          : 'Substitute profile updated.'
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save substitute.');
    } finally {
      setBusy(false);
    }
  }

  async function saveChapter(e: React.FormEvent) {
    e.preventDefault();
    if (!chapterModal) return;
    setBusy(true);
    setError(null);
    try {
      await api.upsertChapter(chapterModal as Record<string, unknown>);
      await onRefresh();
      setChapterModal(null);
      setNotice('Chapter saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save chapter.');
    } finally {
      setBusy(false);
    }
  }

  async function saveLocation(e: React.FormEvent) {
    e.preventDefault();
    if (!locationModal) return;
    setBusy(true);
    setError(null);
    try {
      await api.upsertLocation(locationModal as Record<string, unknown>);
      await onRefresh();
      setLocationModal(null);
      setNotice('Venue location saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save venue.');
    } finally {
      setBusy(false);
    }
  }

  async function inviteCoordinator(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.inviteUser({
        role: 'EXTERNAL_COORDINATOR',
        displayName: coordForm.displayName,
        email: coordForm.email,
        phone: coordForm.phone,
        whatsappPhone: coordForm.whatsappPhone || coordForm.phone,
        regionOrArea: coordForm.region,
        initialPassword: coordForm.initialPassword.trim() || undefined,
        showOnLogin: coordForm.showOnLogin,
      });
      await onRefresh();
      setCoordInviteModal(false);
      setCoordForm({
        displayName: '',
        email: '',
        phone: '',
        whatsappPhone: '',
        region: '',
        initialPassword: '',
        showOnLogin: false,
      });
      setNotice(
        res.passwordConfigured
          ? 'External Coordinator account created with encrypted password (ready to sign in).'
          : `External Coordinator invited. Sandbox invite token: ${res.inviteToken}`
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to invite coordinator.');
    } finally {
      setBusy(false);
    }
  }

  async function handleAdminPasswordReset(e: React.FormEvent) {
    e.preventDefault();
    if (!pwResetTarget) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.adminResetUserPassword(
        pwResetTarget.userId,
        pwResetMode === 'SET_DIRECT' ? pwResetValue : undefined
      );
      await onRefresh();
      setPwResetTarget(null);
      setPwResetValue('');
      setNotice(
        res.passwordUpdated
          ? `Password reset securely for ${res.email}. They can now sign in with the new password.`
          : `Password reset token generated for ${res.email}: ${res.resetToken}`
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reset password.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteEntity() {
    if (!pendingDelete) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteEntity(pendingDelete.type, pendingDelete.id);
      await onRefresh();
      setNotice(`Deleted ${pendingDelete.type}: ${pendingDelete.label}.`);
      setPendingDelete(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete record.');
      setPendingDelete(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {notice && (
        <div role="status" className="px-4 py-2.5 rounded-[6px] bg-[#C81E2B]/20 border border-[#E12D39]/40 text-xs font-medium text-[#F5DFA0] flex items-center justify-between gap-2">
          <span className="break-all">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-semibold shrink-0 cursor-pointer">
            Dismiss
          </button>
        </div>
      )}
      {error && !memberModal && !subModal && !chapterModal && !locationModal && !coordInviteModal && !pwResetTarget && (
        <div role="alert" className="px-4 py-2.5 rounded-[6px] bg-red-500/12 border border-red-500/35 text-xs font-medium text-red-400 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="font-semibold shrink-0 cursor-pointer">
            Dismiss
          </button>
        </div>
      )}
      {pendingDelete && (
        <div role="alertdialog" aria-label="Confirm deletion" className="p-3.5 rounded-[6px] bg-red-500/12 border border-red-500/35 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div>
            <p className="font-bold text-red-300">
              Delete {pendingDelete.type}: &ldquo;{pendingDelete.label}&rdquo;?
            </p>
            <p className="text-red-400 mt-0.5">
              Super Admin cleanup action. Records with active transactions cannot be deleted.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={confirmDeleteEntity}
              className="h-9 px-3.5 rounded-lg bg-red-600 text-white font-semibold cursor-pointer"
            >
              {busy ? 'Deleting...' : 'Confirm Delete'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPendingDelete(null)}
              className="h-9 px-3 rounded-lg border border-red-500/35 bg-[#18181a] text-red-400 font-medium cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 rounded-[6px] bg-[#1f1f23] border border-[#f2efeb]/10 overflow-x-auto">
          {(
            [
              { id: 'members', label: `Members (${data.members.length})` },
              { id: 'substitutes', label: `Veloctive Team (${data.substitutes.length})` },
              { id: 'chapters', label: `Chapters (${data.chapters.length})` },
              { id: 'locations', label: `Locations (${data.locations.length})` },
              ...(isAdmin ? [{ id: 'coordinators', label: `Coordinators (${data.coordinators.length})` }] : []),
            ] as Array<{ id: PeopleTab; label: string }>
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                tab === t.id ? 'bg-[#C81E2B] text-white' : 'text-[#f2efeb]/70 hover:text-[#f2efeb]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Contextual Add Button */}
        <div>
          {tab === 'members' && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMemberModal({
                  name: '',
                  chapterId: data.chapters[0]?.id ?? '',
                  phone: '',
                  whatsappPhone: '',
                  businessName: '',
                  businessCategory: '',
                  intro30Sec: '',
                  referralAsk: '',
                  standardFee: data.chapters[0]?.defaultMemberFee ?? 500,
                  notes: '',
                  active: true,
                });
              }}
              className="h-10 px-4 rounded-[6px] bg-[#C81E2B] hover:bg-[#A31621] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Add Member
            </button>
          )}
          {tab === 'substitutes' && isAdmin && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setSubModal({
                  name: '',
                  email: '',
                  phone: '',
                  whatsappPhone: '',
                  homeArea: '',
                  preferredChapterIds: [],
                  defaultPayout: 350,
                  upiReference: '',
                  availability: 'AVAILABLE',
                  canManageNetwork: false,
                  emergencyConsent: false,
                  notes: '',
                  active: true,
                });
              }}
              className="h-10 px-4 rounded-[6px] bg-[#C81E2B] hover:bg-[#A31621] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              Add Veloctive Team
            </button>
          )}
          {tab === 'chapters' && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setChapterModal({
                  name: '',
                  region: '',
                  regularWeekday: 'Thursday',
                  reportingTime: '07:15 AM',
                  startTime: '07:30 AM',
                  endTime: '09:30 AM',
                  defaultLocationId: data.locations[0]?.id ?? '',
                  defaultMemberFee: 500,
                  defaultSubstitutePayout: 350,
                  usualInstructions: '',
                  active: true,
                });
              }}
              className="h-10 px-4 rounded-[6px] bg-[#C81E2B] hover:bg-[#A31621] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Add Chapter
            </button>
          )}
          {tab === 'locations' && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setLocationModal({
                  name: '',
                  area: '',
                  fullAddress: '',
                  mapsUrl: '',
                  nearestStation: '',
                  transportGuidance: '',
                  entryNotes: '',
                  active: true,
                });
              }}
              className="h-10 px-4 rounded-[6px] bg-[#C81E2B] hover:bg-[#A31621] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Add Location
            </button>
          )}
          {tab === 'coordinators' && isAdmin && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setCoordInviteModal(true);
              }}
              className="h-10 px-4 rounded-[6px] bg-[#C81E2B] hover:bg-[#A31621] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              Invite Coordinator
            </button>
          )}
        </div>
      </div>

      {/* Search, Clustering & Filters Row */}
      {tab === 'members' && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-[#f2efeb]/45 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search members, business, chapters, or categories..."
                className="w-full h-10 pl-10 pr-3.5 rounded-[6px] border border-[#f2efeb]/10 text-sm text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
              />
            </div>

            <select
              aria-label="Filter members by business category"
              value={memberCategoryFilter}
              onChange={(e) => setMemberCategoryFilter(e.target.value)}
              className="h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] text-xs font-medium text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
            >
              <option value="ALL">All Categories ({data.members.length})</option>
              {businessCategories.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.count})
                </option>
              ))}
            </select>

            <select
              aria-label="Filter members by chapter"
              value={memberChapterFilter}
              onChange={(e) => setMemberChapterFilter(e.target.value)}
              className="h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] text-xs font-medium text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
            >
              <option value="ALL">All Chapters</option>
              {data.chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <div className="flex items-center p-0.5 rounded-[6px] bg-[#1f1f23] border border-[#f2efeb]/10">
              <button
                type="button"
                onClick={() => setMemberViewMode('CLUSTERED')}
                className={`h-8 px-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 cursor-pointer ${
                  memberViewMode === 'CLUSTERED' ? 'bg-[#C81E2B] text-white' : 'text-[#f2efeb]/70'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                By Chapter
              </button>
              <button
                type="button"
                onClick={() => setMemberViewMode('FLAT')}
                className={`h-8 px-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 cursor-pointer ${
                  memberViewMode === 'FLAT' ? 'bg-[#C81E2B] text-white' : 'text-[#f2efeb]/70'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                List
              </button>
            </div>

            <label className="inline-flex items-center gap-1.5 text-xs font-medium text-[#f2efeb]/70 cursor-pointer">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="accent-[#C81E2B]"
              />
              Inactive
            </label>
          </div>

          {memberCategoryFilter !== 'ALL' && (
            <div className="flex items-center justify-between px-3.5 py-2 rounded-[6px] bg-[#C81E2B]/18 border border-[#E12D39]/40 text-xs text-[#F5DFA0]">
              <span>
                Showing <strong>{filteredMembers.length}</strong> member(s) in category{' '}
                <strong>{memberCategoryFilter}</strong> across{' '}
                <strong>{memberClusters.length}</strong> chapter(s)
              </span>
              <button
                type="button"
                onClick={() => setMemberCategoryFilter('ALL')}
                className="font-semibold underline cursor-pointer"
              >
                Clear category
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'substitutes' && (
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-[#f2efeb]/45 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Veloctive Team or Mumbai locality..."
              className="w-full h-10 pl-10 pr-3.5 rounded-[6px] border border-[#f2efeb]/10 text-sm text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
            />
          </div>

          <select
            aria-label="Filter Veloctive Team by location cluster"
            value={subHubFilter}
            onChange={(e) => setSubHubFilter(e.target.value)}
            className="h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] text-xs font-medium text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
          >
            <option value="ALL">All Locations ({data.substitutes.length})</option>
            {substituteHubs.map((h) => (
              <option key={h.hub} value={h.hub}>
                {h.hub} ({h.count})
              </option>
            ))}
          </select>

          <div className="flex items-center p-0.5 rounded-[6px] bg-[#1f1f23] border border-[#f2efeb]/10">
            <button
              type="button"
              onClick={() => setSubViewMode('CLUSTERED')}
              className={`h-8 px-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 cursor-pointer ${
                subViewMode === 'CLUSTERED' ? 'bg-[#C81E2B] text-white' : 'text-[#f2efeb]/70'
              }`}
            >
              <MapPin className="w-3.5 h-3.5" />
              By Location
            </button>
            <button
              type="button"
              onClick={() => setSubViewMode('FLAT')}
              className={`h-8 px-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 cursor-pointer ${
                subViewMode === 'FLAT' ? 'bg-[#C81E2B] text-white' : 'text-[#f2efeb]/70'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              List
            </button>
          </div>

          <label className="inline-flex items-center gap-1.5 text-xs font-medium text-[#f2efeb]/70 cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="accent-[#C81E2B]"
            />
            Inactive
          </label>
        </div>
      )}

      {/* MEMBERS VIEW (Default Clustered by Chapter + Business Category Filter) */}
      {tab === 'members' && (
        filteredMembers.length === 0 ? (
          <div className="p-8 rounded-[6px] border border-dashed border-[#f2efeb]/10 text-center text-sm text-[#f2efeb]/60">
            No members match the selected category, chapter, or search filter.
          </div>
        ) : memberViewMode === 'CLUSTERED' ? (
          <div className="space-y-5" data-testid="members-clustered-view">
            {memberClusters.map((cluster) => {
              const isCollapsed = Boolean(collapsedMemberClusters[cluster.chapterId]);
              const chapVenue = data.locations.find((l) => l.id === cluster.chapter?.defaultLocationId);
              return (
                <section key={cluster.chapterId} className="space-y-2.5">
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsedMemberClusters((prev) => ({
                        ...prev,
                        [cluster.chapterId]: !isCollapsed,
                      }))
                    }
                    className="w-full px-1 py-1 flex items-center justify-between gap-2 text-left cursor-pointer group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[#f2efeb]/50 group-hover:text-[#f2efeb] transition-colors">
                        {isCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                      </span>
                      <h3 className="font-mono text-xs font-bold uppercase tracking-[0.08em] text-[#f2efeb]/75 truncate">
                        {cluster.chapter?.name ?? 'Unlinked Chapter'}
                      </h3>
                      {cluster.chapter && (
                        <span className="hidden sm:inline text-[11px] text-[#f2efeb]/45 truncate">
                          · {cluster.chapter.regularWeekday} {cluster.chapter.reportingTime}
                          {chapVenue ? ` · ${chapVenue.name}` : ''}
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-xs font-semibold text-[#f2efeb]/55 tabular-nums shrink-0">
                      {cluster.members.length}
                    </span>
                  </button>

                  {!isCollapsed && (
                    <div className="space-y-2.5">
                      {cluster.members.map((member) => (
                        <div
                          key={member.id}
                          className="p-4 rounded-xl border border-[#f2efeb]/10 bg-[#18181a] hover:border-[#C81E2B]/45 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors"
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p
                                className={`font-display text-[15px] font-bold ${
                                  member.active ? 'text-[#f2efeb]' : 'text-[#f2efeb]/45 line-through'
                                }`}
                              >
                                {member.name}
                              </p>
                              <span className="text-[11px] text-[#f2efeb]/45 tabular-nums">
                                · Std {formatINR(member.standardFee)}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-[#f2efeb]/65">
                              {member.businessName && (
                                <span className="inline-flex items-center gap-1.5">
                                  <Building2 className="w-3.5 h-3.5 text-[#f2efeb]/45 shrink-0" />
                                  <span>{member.businessName}</span>
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => setMemberCategoryFilter(member.businessCategory)}
                                className="inline-flex items-center gap-1 font-medium text-[#E12D39] hover:underline cursor-pointer"
                              >
                                <Tag className="w-3.5 h-3.5 shrink-0" />
                                <span>{member.businessCategory}</span>
                              </button>
                              <span className="inline-flex items-center gap-1 tabular-nums text-[#f2efeb]/60">
                                <Phone className="w-3.5 h-3.5 text-[#f2efeb]/40 shrink-0" />
                                {member.phone}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <a
                              href={buildTelHref(member.phone)}
                              aria-label={`Call ${member.name}`}
                              className="w-8 h-8 rounded-lg border border-[#f2efeb]/10 bg-[#111113] hover:border-[#E2B340]/50 flex items-center justify-center text-[#f2efeb]/80"
                            >
                              <Phone className="w-3.5 h-3.5" />
                            </a>
                            <button
                              type="button"
                              aria-label={`WhatsApp ${member.name}`}
                              onClick={() =>
                                onOpenDraft({
                                  templateType: 'MEMBER_GENERAL',
                                  title: `Message ${member.name}`,
                                  recipientLabel: member.name,
                                  recipientPhone: member.whatsappPhone || member.phone,
                                  defaultBody: buildMemberCheckinWhatsAppText(
                                    member.name,
                                    cluster.chapter?.name ?? 'your chapter'
                                  ),
                                })
                              }
                              className="w-8 h-8 rounded-lg bg-emerald-600/90 hover:bg-emerald-600 text-white flex items-center justify-center cursor-pointer"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Edit ${member.name}`}
                              onClick={() => {
                                setError(null);
                                setMemberModal({ ...member });
                              }}
                              className="w-8 h-8 rounded-lg border border-[#f2efeb]/10 bg-[#111113] hover:border-[#C81E2B]/50 flex items-center justify-center text-[#f2efeb]/70 cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label={`${member.active ? 'Deactivate' : 'Reactivate'} ${member.name}`}
                              onClick={async () => {
                                await api.upsertMember({ ...member, active: !member.active });
                                await onRefresh();
                              }}
                              className="h-8 px-2.5 rounded-lg border border-[#f2efeb]/12 bg-[#111113] hover:border-amber-500/40 text-[11px] font-medium text-[#f2efeb]/70 hover:text-amber-300 cursor-pointer"
                            >
                              {member.active ? 'Deactivate' : 'Reactivate'}
                            </button>
                            {isAdmin && (
                              <button
                                type="button"
                                aria-label={`Delete ${member.name}`}
                                onClick={() =>
                                  setPendingDelete({ type: 'member', id: member.id, label: member.name })
                                }
                                className="w-8 h-8 rounded-lg border border-[#f2efeb]/10 bg-[#111113] hover:bg-red-500/12 flex items-center justify-center text-[#f2efeb]/55 hover:text-red-400 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        ) : (
          <div className="divide-y divide-[#f2efeb]/10 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] overflow-hidden">
            {filteredMembers.map((member) => {
              const chap = data.chapters.find((c) => c.id === member.chapterId);
              const venue = data.locations.find(
                (l) => l.id === (member.preferredLocationId ?? chap?.defaultLocationId)
              );
              return (
                <div
                  key={member.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#18181a]/[0.05] transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`font-display text-sm font-bold ${member.active ? 'text-[#f2efeb]' : 'text-[#f2efeb]/45 line-through'}`}>
                        {member.name}
                      </p>
                      <span className="text-xs font-medium text-[#E2B340]">· {member.businessCategory}</span>
                    </div>
                    <p className="text-xs text-[#f2efeb]/70 mt-0.5 truncate">
                      <strong className="text-[#f2efeb]">{chap?.name ?? 'Unlinked Chapter'}</strong>
                      {' · '}
                      {venue?.name ?? 'Venue TBD'}
                      {' · '}
                      <span className="tabular-nums">Std {formatINR(member.standardFee)}</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <a
                      href={buildTelHref(member.phone)}
                      aria-label={`Call ${member.name}`}
                      className="w-9 h-9 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] hover:bg-[#18181a]/[0.05] flex items-center justify-center text-[#f2efeb]"
                    >
                      <Phone className="w-4 h-4" />
                    </a>
                    <button
                      type="button"
                      aria-label={`WhatsApp ${member.name}`}
                      onClick={() =>
                        onOpenDraft({
                          templateType: 'MEMBER_GENERAL',
                          title: `Message ${member.name}`,
                          recipientLabel: member.name,
                          recipientPhone: member.whatsappPhone || member.phone,
                          defaultBody: buildMemberCheckinWhatsAppText(
                            member.name,
                            chap?.name ?? 'your chapter'
                          ),
                        })
                      }
                      className="w-9 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center cursor-pointer"
                    >
                      <MessageCircle className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Edit ${member.name}`}
                      onClick={() => {
                        setError(null);
                        setMemberModal({ ...member });
                      }}
                      className="w-9 h-9 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] hover:bg-[#C81E2B]/20 flex items-center justify-center text-[#f2efeb]/70 cursor-pointer"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        aria-label={`Delete ${member.name}`}
                        onClick={() => setPendingDelete({ type: 'member', id: member.id, label: member.name })}
                        className="w-9 h-9 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] hover:bg-red-500/12 flex items-center justify-center text-[#f2efeb]/60 hover:text-red-400 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* SUBSTITUTES VIEW (Default Clustered by Mumbai Location Hub + Super Admin Password Reset & Delete) */}
      {tab === 'substitutes' && (
        filteredSubstitutes.length === 0 ? (
          <div className="p-8 rounded-[6px] border border-dashed border-[#f2efeb]/10 text-center text-sm text-[#f2efeb]/60">
            No Veloctive Team members match this location or search filter.
          </div>
        ) : subViewMode === 'CLUSTERED' ? (
          <div className="space-y-5" data-testid="substitutes-clustered-view">
            {substituteClusters.map((cluster) => {
              const isCollapsed = Boolean(collapsedSubClusters[cluster.hub]);
              return (
                <section key={cluster.hub} className="space-y-2.5">
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsedSubClusters((prev) => ({ ...prev, [cluster.hub]: !isCollapsed }))
                    }
                    className="w-full px-1 py-1 flex items-center justify-between gap-2 text-left cursor-pointer group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[#f2efeb]/50 group-hover:text-[#f2efeb] transition-colors">
                        {isCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                      </span>
                      <MapPin className="w-3.5 h-3.5 text-[#E2B340] shrink-0" />
                      <h3 className="font-mono text-xs font-bold uppercase tracking-[0.08em] text-[#f2efeb]/75 truncate">
                        {cluster.hub}
                      </h3>
                    </div>
                    <span className="font-mono text-xs font-semibold text-[#f2efeb]/55 tabular-nums shrink-0">
                      {cluster.substitutes.length}
                    </span>
                  </button>

                  {!isCollapsed && (
                    <div className="space-y-2.5">
                      {cluster.substitutes.map((sub) => {
                        const guestCount = data.partnerGuestContacts.filter(
                          (g) => g.partnerSubstituteId === sub.id && g.active
                        ).length;
                        const introCoord = sub.introducedByCoordinatorId
                          ? data.coordinatorDirectory.find((c) => c.id === sub.introducedByCoordinatorId)
                          : undefined;
                        const linkedUser = data.managedUsers.find((u) => u.id === sub.userId);
                        return (
                          <div
                            key={sub.id}
                            className="p-4 rounded-xl border border-[#f2efeb]/10 bg-[#18181a] hover:border-[#C81E2B]/45 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors"
                          >
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p
                                  className={`font-display text-[15px] font-bold ${
                                    sub.active ? 'text-[#f2efeb]' : 'text-[#f2efeb]/45 line-through'
                                  }`}
                                >
                                  {sub.name}
                                </p>
                                {sub.canManageNetwork && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#C81E2B]/14 border border-[#E12D39]/30 text-[11px] font-semibold text-[#E12D39]">
                                    <Network className="w-3 h-3" />
                                    Partner ({guestCount})
                                  </span>
                                )}
                                {linkedUser?.showOnLogin && isAdmin && (
                                  <span className="px-1.5 py-0.5 rounded bg-[#E2B340]/14 text-[10px] font-semibold text-[#E2B340]">
                                    Quick-fill
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-[#f2efeb]/65 tabular-nums">
                                <span className="inline-flex items-center gap-1">
                                  <Home className="w-3.5 h-3.5 text-[#f2efeb]/40 shrink-0" />
                                  {sub.homeArea}
                                </span>
                                <span className="inline-flex items-center gap-1 text-[#E2B340] font-medium">
                                  <Wallet className="w-3.5 h-3.5 shrink-0" />
                                  {formatINR(sub.defaultPayout)}
                                </span>
                                <span className="inline-flex items-center gap-1 text-[#f2efeb]/60">
                                  <Phone className="w-3.5 h-3.5 text-[#f2efeb]/40 shrink-0" />
                                  {sub.phone}
                                </span>
                                {sub.emergencyContactPhone && (sub.emergencyConsent || isAdmin) && (
                                  <span className="inline-flex items-center gap-1 text-[#f2efeb]/55">
                                    <Shield className="w-3.5 h-3.5 text-[#E12D39]/80 shrink-0" />
                                    Backup: {sub.emergencyContactPhone}
                                  </span>
                                )}
                                {introCoord && (
                                  <span className="text-[#f2efeb]/50">· Intro: {introCoord.name}</span>
                                )}
                                {isAdmin && sub.upiReference && (
                                  <span className="text-[#f2efeb]/50">· UPI: {sub.upiReference}</span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <a
                                href={buildTelHref(sub.phone)}
                                aria-label={`Call ${sub.name}`}
                                className="w-8 h-8 rounded-lg border border-[#f2efeb]/10 bg-[#111113] hover:border-[#E2B340]/50 flex items-center justify-center text-[#f2efeb]/80"
                              >
                                <Phone className="w-3.5 h-3.5" />
                              </a>
                              <button
                                type="button"
                                aria-label={`WhatsApp ${sub.name}`}
                                onClick={() =>
                                  onOpenDraft({
                                    templateType: 'SUB_GENERAL',
                                    title: `Message ${sub.name}`,
                                    recipientLabel: sub.name,
                                    recipientPhone: sub.whatsappPhone || sub.phone,
                                    defaultBody: buildTeamAvailabilityWhatsAppText(sub.name),
                                  })
                                }
                                className="w-8 h-8 rounded-lg bg-emerald-600/90 hover:bg-emerald-600 text-white flex items-center justify-center cursor-pointer"
                              >
                                <MessageCircle className="w-3.5 h-3.5" />
                              </button>
                              {isAdmin && (
                                <>
                                  <button
                                    type="button"
                                    aria-label={`Reset password for ${sub.name}`}
                                    title="Reset Password"
                                    onClick={() => {
                                      setError(null);
                                      setPwResetValue('');
                                      setPwResetMode('SET_DIRECT');
                                      setPwResetTarget({
                                        userId: sub.userId,
                                        name: sub.name,
                                        email: sub.email,
                                        roleLabel: sub.canManageNetwork ? 'Veloctive Team Partner' : 'Veloctive Team',
                                      });
                                    }}
                                    className="w-8 h-8 rounded-lg border border-[#f2efeb]/10 bg-[#111113] hover:border-[#E2B340]/50 flex items-center justify-center text-[#E2B340] cursor-pointer"
                                  >
                                    <KeyRound className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`Edit ${sub.name}`}
                                    onClick={() => {
                                      setError(null);
                                      setSubModal({
                                        ...sub,
                                        showOnLogin: linkedUser?.showOnLogin ?? false,
                                      });
                                    }}
                                    className="w-8 h-8 rounded-lg border border-[#f2efeb]/10 bg-[#111113] hover:border-[#C81E2B]/50 flex items-center justify-center text-[#f2efeb]/70 cursor-pointer"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`${sub.active ? 'Deactivate' : 'Reactivate'} ${sub.name}`}
                                    onClick={async () => {
                                      await api.setUserStatus(sub.userId, !sub.active);
                                      await onRefresh();
                                    }}
                                    className="h-8 px-2.5 rounded-lg border border-[#f2efeb]/12 bg-[#111113] hover:border-amber-500/40 text-[11px] font-medium text-[#f2efeb]/70 hover:text-amber-300 cursor-pointer"
                                  >
                                    {sub.active ? 'Deactivate' : 'Reactivate'}
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`Delete ${sub.name}`}
                                    onClick={() =>
                                      setPendingDelete({ type: 'substitute', id: sub.id, label: sub.name })
                                    }
                                    className="w-8 h-8 rounded-lg border border-[#f2efeb]/10 bg-[#111113] hover:bg-red-500/12 flex items-center justify-center text-[#f2efeb]/55 hover:text-red-400 cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        ) : (
          <div className="divide-y divide-[#f2efeb]/10 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] overflow-hidden">
            {filteredSubstitutes.map((sub) => {
              const guestCount = data.partnerGuestContacts.filter(
                (g) => g.partnerSubstituteId === sub.id && g.active
              ).length;
              return (
                <div
                  key={sub.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#18181a]/[0.05] transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`font-display text-sm font-bold ${sub.active ? 'text-[#f2efeb]' : 'text-[#f2efeb]/45 line-through'}`}>
                        {sub.name}
                      </p>
                      {sub.canManageNetwork && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#E2B340]">
                          <Network className="w-3.5 h-3.5" />
                          Partner ({guestCount} saved guests)
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#f2efeb]/70 mt-0.5 tabular-nums">
                      {sub.homeArea} ({normalizeLocationHub(sub.homeArea)}) · Default {formatINR(sub.defaultPayout)} · {sub.availability}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <a
                      href={buildTelHref(sub.phone)}
                      aria-label={`Call ${sub.name}`}
                      className="w-9 h-9 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] hover:bg-[#18181a]/[0.05] flex items-center justify-center text-[#f2efeb]"
                    >
                      <Phone className="w-4 h-4" />
                    </a>
                    {isAdmin && (
                      <>
                        <button
                          type="button"
                          aria-label={`Reset password for ${sub.name}`}
                          onClick={() => {
                            setError(null);
                            setPwResetValue('');
                            setPwResetMode('SET_DIRECT');
                            setPwResetTarget({
                              userId: sub.userId,
                              name: sub.name,
                              email: sub.email,
                              roleLabel: 'Veloctive Team',
                            });
                          }}
                          className="w-9 h-9 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] hover:bg-[#C81E2B]/20 flex items-center justify-center text-[#E2B340] cursor-pointer"
                        >
                          <KeyRound className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Edit ${sub.name}`}
                          onClick={() => {
                            setError(null);
                            setSubModal({ ...sub });
                          }}
                          className="w-9 h-9 rounded-lg border border-[#f2efeb]/10 bg-[#18181a] hover:bg-[#C81E2B]/20 flex items-center justify-center text-[#f2efeb]/70 cursor-pointer"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* CHAPTERS LIST */}
      {tab === 'chapters' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {data.chapters.map((chap) => {
            const loc = data.locations.find((l) => l.id === chap.defaultLocationId);
            return (
              <div key={chap.id} className="p-4 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] flex flex-col justify-between gap-3">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-display text-sm font-bold text-[#f2efeb]">{chap.name}</h3>
                      <p className="text-xs text-[#f2efeb]/60 mt-0.5">
                        Regular weekday: <strong className="text-[#E2B340]">{chap.regularWeekday}</strong> (info only)
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        aria-label={`Edit ${chap.name}`}
                        onClick={() => setChapterModal({ ...chap })}
                        className="w-8 h-8 rounded-lg border border-[#f2efeb]/10 flex items-center justify-center text-[#f2efeb]/60 hover:text-[#f2efeb] cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      {isAdmin && (
                        <button
                          type="button"
                          aria-label={`Delete ${chap.name}`}
                          onClick={() => setPendingDelete({ type: 'chapter', id: chap.id, label: chap.name })}
                          className="w-8 h-8 rounded-lg border border-[#f2efeb]/10 flex items-center justify-center text-[#f2efeb]/60 hover:text-red-400 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-[#f2efeb]/70 mt-2 flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-[#E2B340] shrink-0" />
                    <span className="break-words">{loc?.name ?? 'Unlinked Venue'} ({loc?.area ?? chap.region})</span>
                  </p>
                  <p className="text-xs text-[#f2efeb]/70 mt-1 tabular-nums">
                    Report {chap.reportingTime} · {chap.startTime} – {chap.endTime} · Default {formatINR(chap.defaultMemberFee)} / {formatINR(chap.defaultSubstitutePayout)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* LOCATIONS LIST */}
      {tab === 'locations' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {data.locations.map((loc) => (
            <div key={loc.id} className="p-4 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] space-y-2 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-display text-sm font-bold text-[#f2efeb] break-words">{loc.name}</h3>
                  <p className="text-xs font-medium text-[#E2B340]">{loc.area}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    aria-label={`Edit ${loc.name}`}
                    onClick={() => setLocationModal({ ...loc })}
                    className="w-8 h-8 rounded-lg border border-[#f2efeb]/10 flex items-center justify-center text-[#f2efeb]/60 hover:text-[#f2efeb] cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      aria-label={`Delete ${loc.name}`}
                      onClick={() => setPendingDelete({ type: 'location', id: loc.id, label: loc.name })}
                      className="w-8 h-8 rounded-lg border border-[#f2efeb]/10 flex items-center justify-center text-[#f2efeb]/60 hover:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs text-[#f2efeb]/70 leading-relaxed break-words">{loc.fullAddress}</p>
              <p className="text-xs text-[#f2efeb]/60 break-words">
                {loc.nearestStation} · {loc.transportGuidance}
              </p>
              {loc.mapsUrl && (
                <a
                  href={loc.mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#E2B340] hover:underline break-all"
                >
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  Google Maps
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* COORDINATORS LIST (Super Admin Only — Activity Overview + Password Reset) */}
      {tab === 'coordinators' && isAdmin && (
        <div className="divide-y divide-[#f2efeb]/10 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] overflow-hidden">
          {data.coordinators.map((coord) => {
            const ownedReqs = data.requests.filter((r) => r.coordinatorId === coord.id).length;
            const viaAsgns = data.assignments.filter(
              (a) => (a.assignedViaCoordinatorId ?? a.coordinatorId) === coord.id
            ).length;
            const ownedMembers = data.members.filter((m) => m.coordinatorId === coord.id && m.active).length;
            return (
              <div key={coord.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={`font-display text-sm font-bold ${coord.active ? 'text-[#f2efeb]' : 'text-[#f2efeb]/45 line-through'}`}>
                    {coord.name} {coord.isSuperAdmin ? '· Super Admin' : '· External Coordinator'}
                  </p>
                  <p className="text-xs text-[#f2efeb]/70 mt-0.5 break-words">
                    {coord.email} · {coord.region} · Call {coord.callingPhone} · WA {coord.whatsappPhone}
                  </p>
                  <p className="text-[11px] text-[#f2efeb]/60 mt-1 tabular-nums">
                    {ownedMembers} Members · {ownedReqs} Owned Requests · {viaAsgns} Via Assignments
                  </p>
                </div>
                {!coord.isSuperAdmin && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setPwResetValue('');
                        setPwResetMode('SET_DIRECT');
                        setPwResetTarget({
                          userId: coord.userId,
                          name: coord.name,
                          email: coord.email,
                          roleLabel: 'External Coordinator',
                        });
                      }}
                      className="h-9 px-3 rounded-lg border border-[#f2efeb]/10 bg-[#1f1f23] hover:bg-[#C81E2B]/20 text-xs font-semibold text-[#E2B340] inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      Reset Password
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.setUserStatus(coord.userId, !coord.active);
                        await onRefresh();
                      }}
                      className="h-9 px-3 rounded-lg border border-[#f2efeb]/10 text-xs font-semibold text-[#f2efeb]/70 hover:bg-red-500/12 hover:text-red-400 cursor-pointer"
                    >
                      {coord.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ADD / EDIT MEMBER MODAL — Clean Sectioned Surface (SS #5) */}
      {memberModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Member form">
          <div className="w-full sm:max-w-lg bg-[#18181a] rounded-t-2xl sm:rounded-2xl border border-[#f2efeb]/10 max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-[#f2efeb]/10 flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-[#f2efeb]">
                  {memberModal.id ? 'Edit Member' : 'Add Member'}
                </h2>
                <p className="text-xs text-[#f2efeb]/50 mt-0.5">
                  {memberModal.id ? 'Update record' : 'New record'}
                </p>
              </div>
              <button type="button" aria-label="Close member form" onClick={() => setMemberModal(null)} className="w-9 h-9 rounded-lg flex items-center justify-center text-[#f2efeb]/60 hover:bg-white/[0.05] cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={saveMember} className="p-5 overflow-y-auto space-y-5">
              {error && <p className="p-2.5 rounded-lg bg-red-500/12 text-xs text-red-400">{error}</p>}

              {/* IDENTITY */}
              <div className="space-y-3">
                <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#f2efeb]/50">
                  Identity
                </p>
                <div>
                  <label className="block text-xs font-medium text-[#f2efeb]/85 mb-1.5">Full name *</label>
                  <div className="relative">
                    <User className="w-4 h-4 text-[#f2efeb]/40 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      required
                      value={memberModal.name ?? ''}
                      onChange={(e) => setMemberModal({ ...memberModal, name: e.target.value })}
                      placeholder="Member full name"
                      className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#f2efeb]/12 bg-[#111113] text-sm text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#f2efeb]/85 mb-1.5">Phone *</label>
                    <div className="relative">
                      <Phone className="w-4 h-4 text-[#f2efeb]/40 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="tel"
                        required
                        value={memberModal.phone ?? ''}
                        onChange={(e) => setMemberModal({ ...memberModal, phone: e.target.value })}
                        placeholder="+91 98..."
                        className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#f2efeb]/12 bg-[#111113] text-sm text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#f2efeb]/85 mb-1.5">WhatsApp</label>
                    <div className="relative">
                      <MessageCircle className="w-4 h-4 text-[#f2efeb]/40 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="tel"
                        value={memberModal.whatsappPhone ?? ''}
                        onChange={(e) => setMemberModal({ ...memberModal, whatsappPhone: e.target.value })}
                        placeholder="Same if blank"
                        className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#f2efeb]/12 bg-[#111113] text-sm text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* BUSINESS & CHAPTER */}
              <div className="space-y-3 pt-1">
                <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#f2efeb]/50">
                  Business &amp; Chapter
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#f2efeb]/85 mb-1.5">Business name</label>
                    <div className="relative">
                      <Building2 className="w-4 h-4 text-[#f2efeb]/40 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={memberModal.businessName ?? ''}
                        onChange={(e) => setMemberModal({ ...memberModal, businessName: e.target.value })}
                        className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#f2efeb]/12 bg-[#111113] text-sm text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#f2efeb]/85 mb-1.5">Category</label>
                    <div className="relative">
                      <Tag className="w-4 h-4 text-[#f2efeb]/40 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={memberModal.businessCategory ?? ''}
                        onChange={(e) => setMemberModal({ ...memberModal, businessCategory: e.target.value })}
                        className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#f2efeb]/12 bg-[#111113] text-sm text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#f2efeb]/85 mb-1.5">Linked chapter *</label>
                    <select
                      required
                      value={memberModal.chapterId ?? ''}
                      onChange={(e) => setMemberModal({ ...memberModal, chapterId: e.target.value })}
                      className="w-full h-10 px-3 rounded-xl border border-[#f2efeb]/12 bg-[#111113] text-sm text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
                    >
                      {data.chapters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.regularWeekday} · {c.reportingTime})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#f2efeb]/85 mb-1.5">Standard bill rate (₹)</label>
                    <div className="relative">
                      <Wallet className="w-4 h-4 text-[#f2efeb]/40 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="number"
                        value={memberModal.standardFee ?? 500}
                        onChange={(e) => setMemberModal({ ...memberModal, standardFee: Number(e.target.value) })}
                        className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#f2efeb]/12 bg-[#111113] text-sm text-[#f2efeb] tabular-nums focus:outline-none focus:border-[#C81E2B]"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#f2efeb]/85 mb-1.5">
                    Preferred venue override (optional)
                  </label>
                  <select
                    value={memberModal.preferredLocationId ?? ''}
                    onChange={(e) => setMemberModal({ ...memberModal, preferredLocationId: e.target.value || undefined })}
                    className="w-full h-10 px-3 rounded-xl border border-[#f2efeb]/12 bg-[#111113] text-sm text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
                  >
                    <option value="">Use Chapter Default Venue</option>
                    {data.locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.area})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* MEETING BRIEFING */}
              <div className="space-y-3 pt-1">
                <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#f2efeb]/50">
                  Meeting Briefing
                </p>
                <div>
                  <label className="block text-xs font-medium text-[#f2efeb]/85 mb-1.5">30-second business introduction</label>
                  <textarea
                    rows={3}
                    value={memberModal.intro30Sec ?? ''}
                    onChange={(e) => setMemberModal({ ...memberModal, intro30Sec: e.target.value })}
                    className="w-full p-3 rounded-xl border border-[#f2efeb]/12 bg-[#111113] text-sm text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#f2efeb]/85 mb-1.5">Ideal referral / ask</label>
                  <input
                    type="text"
                    value={memberModal.referralAsk ?? ''}
                    onChange={(e) => setMemberModal({ ...memberModal, referralAsk: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border border-[#f2efeb]/12 bg-[#111113] text-sm text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
                  />
                </div>
              </div>

              <div className="pt-2 grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setMemberModal(null)} className="h-11 rounded-xl border border-[#f2efeb]/12 text-xs font-semibold text-[#f2efeb] hover:bg-white/[0.04] cursor-pointer">
                  Cancel
                </button>
                <button type="submit" disabled={busy} className="h-11 rounded-xl bg-[#C81E2B] hover:bg-[#A31621] text-white text-xs font-semibold cursor-pointer">
                  {busy ? 'Saving...' : memberModal.id ? 'Update record' : 'Add record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD / EDIT SUBSTITUTE MODAL — Clean Sectioned Surface (SS #5) with Locked Invite Token, Backup Phone & Show-on-Login */}
      {subModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Veloctive Team form">
          <div className="w-full sm:max-w-lg bg-[#18181a] rounded-t-2xl sm:rounded-2xl border border-[#f2efeb]/10 max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-[#f2efeb]/10 flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-[#f2efeb]">
                  {subModal.id ? 'Edit Substitute' : 'Add Substitute'}
                </h2>
                <p className="text-xs text-[#f2efeb]/50 mt-0.5">
                  {subModal.id ? 'Update record' : 'New record'}
                </p>
              </div>
              <button type="button" aria-label="Close substitute form" onClick={() => setSubModal(null)} className="w-9 h-9 rounded-lg flex items-center justify-center text-[#f2efeb]/60 hover:bg-white/[0.05] cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={saveSubstitute} className="p-5 overflow-y-auto space-y-5">
              {error && <p className="p-2.5 rounded-lg bg-red-500/12 text-xs text-red-400">{error}</p>}

              {/* IDENTITY */}
              <div className="space-y-3">
                <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#f2efeb]/50">
                  Identity
                </p>
                <div>
                  <label className="block text-xs font-medium text-[#f2efeb]/85 mb-1.5">Full name *</label>
                  <div className="relative">
                    <User className="w-4 h-4 text-[#f2efeb]/40 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      required
                      value={subModal.name ?? ''}
                      onChange={(e) => setSubModal({ ...subModal, name: e.target.value })}
                      placeholder="Full name"
                      className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#f2efeb]/12 bg-[#111113] text-sm text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#f2efeb]/85 mb-1.5">Phone *</label>
                    <div className="relative">
                      <Phone className="w-4 h-4 text-[#f2efeb]/40 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="tel"
                        required
                        value={subModal.phone ?? ''}
                        onChange={(e) => setSubModal({ ...subModal, phone: e.target.value })}
                        placeholder="+91 98..."
                        className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#f2efeb]/12 bg-[#111113] text-sm text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#f2efeb]/85 mb-1.5">WhatsApp</label>
                    <div className="relative">
                      <MessageCircle className="w-4 h-4 text-[#f2efeb]/40 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="tel"
                        value={subModal.whatsappPhone ?? ''}
                        onChange={(e) => setSubModal({ ...subModal, whatsappPhone: e.target.value })}
                        placeholder="Same if blank"
                        className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#f2efeb]/12 bg-[#111113] text-sm text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
                      />
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#f2efeb]/85 mb-1.5">Home area</label>
                  <div className="relative">
                    <Home className="w-4 h-4 text-[#f2efeb]/40 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={subModal.homeArea ?? ''}
                      onChange={(e) => setSubModal({ ...subModal, homeArea: e.target.value })}
                      placeholder="e.g. Andheri West"
                      className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#f2efeb]/12 bg-[#111113] text-sm text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
                    />
                  </div>
                </div>
              </div>

              {/* ACCOUNT & LOGIN (Locked invite email + optional initial password / invite token + Super Admin Show on Login) */}
              <div className="space-y-3 pt-1">
                <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#f2efeb]/50">
                  Account &amp; Invite
                </p>
                <div className={subModal.id ? '' : 'grid grid-cols-1 sm:grid-cols-2 gap-3'}>
                  <div>
                    <label className="block text-xs font-medium text-[#f2efeb]/85 mb-1.5">Invite email *</label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-[#f2efeb]/40 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="email"
                        required
                        disabled={Boolean(subModal.id)}
                        value={subModal.email ?? ''}
                        onChange={(e) => setSubModal({ ...subModal, email: e.target.value })}
                        placeholder="team@veloctive.com"
                        className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#f2efeb]/12 bg-[#111113] text-sm text-[#f2efeb] disabled:opacity-60 focus:outline-none focus:border-[#C81E2B]"
                      />
                    </div>
                  </div>
                  {!subModal.id && (
                    <div>
                      <label className="block text-xs font-medium text-[#f2efeb]/85 mb-1.5">
                        Initial password (optional)
                      </label>
                      <div className="relative">
                        <KeyRound className="w-4 h-4 text-[#f2efeb]/40 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="password"
                          minLength={8}
                          value={subModal.initialPassword ?? ''}
                          onChange={(e) => setSubModal({ ...subModal, initialPassword: e.target.value })}
                          placeholder="Blank = invite token"
                          className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#f2efeb]/12 bg-[#111113] text-sm text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
                        />
                      </div>
                    </div>
                  )}
                </div>
                {isAdmin && (
                  <label className="flex items-start gap-2.5 cursor-pointer select-none pt-0.5">
                    <input
                      type="checkbox"
                      data-testid="sub-show-on-login-checkbox"
                      checked={Boolean(subModal.showOnLogin)}
                      onChange={(e) => setSubModal({ ...subModal, showOnLogin: e.target.checked })}
                      className="mt-0.5 accent-[#C81E2B]"
                    />
                    <div>
                      <span className="text-xs font-medium text-[#f2efeb]">Show on login quick-fill list</span>
                      <p className="text-[11px] text-[#f2efeb]/50">
                        Only accounts explicitly allowed by Super Admin appear for quick email prefill on the Sign-In screen.
                      </p>
                    </div>
                  </label>
                )}
              </div>

              {/* PAYOUT & PREFERENCES */}
              <div className="space-y-3 pt-1">
                <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#f2efeb]/50">
                  Payout &amp; Preferences
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#f2efeb]/85 mb-1.5">Default payout (₹)</label>
                    <div className="relative">
                      <Wallet className="w-4 h-4 text-[#f2efeb]/40 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="number"
                        value={subModal.defaultPayout ?? 350}
                        onChange={(e) => setSubModal({ ...subModal, defaultPayout: Number(e.target.value) })}
                        className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#f2efeb]/12 bg-[#111113] text-sm text-[#f2efeb] tabular-nums focus:outline-none focus:border-[#C81E2B]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#f2efeb]/85 mb-1.5">Private UPI reference</label>
                    <input
                      type="text"
                      value={subModal.upiReference ?? ''}
                      onChange={(e) => setSubModal({ ...subModal, upiReference: e.target.value })}
                      placeholder="name@upi (Admin only)"
                      className="w-full h-10 px-3 rounded-xl border border-[#f2efeb]/12 bg-[#111113] text-sm text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#f2efeb]/85 mb-1.5">
                    Introduced by coordinator (optional)
                  </label>
                  <select
                    value={subModal.introducedByCoordinatorId ?? ''}
                    onChange={(e) =>
                      setSubModal({ ...subModal, introducedByCoordinatorId: e.target.value || undefined })
                    }
                    className="w-full h-10 px-3 rounded-xl border border-[#f2efeb]/12 bg-[#111113] text-sm text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
                  >
                    <option value="">Direct / Agency Pool</option>
                    {data.coordinatorDirectory.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <span className="block text-xs font-medium text-[#f2efeb]/85 mb-1.5">Preferred chapters</span>
                  <div className="grid grid-cols-2 gap-1.5 p-2.5 rounded-xl border border-[#f2efeb]/12 bg-[#111113] max-h-28 overflow-y-auto">
                    {data.chapters.map((c) => {
                      const selected = (subModal.preferredChapterIds ?? []).includes(c.id);
                      return (
                        <label key={c.id} className="flex items-center gap-2 text-xs text-[#f2efeb]/85 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => {
                              const curr = subModal.preferredChapterIds ?? [];
                              setSubModal({
                                ...subModal,
                                preferredChapterIds: selected ? curr.filter((x) => x !== c.id) : [...curr, c.id],
                              });
                            }}
                            className="accent-[#C81E2B]"
                          />
                          <span className="truncate">{c.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* EMERGENCY CONTACT (Backup mobile + Consent matching SS #5) */}
              <div className="space-y-2.5 pt-1">
                <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#f2efeb]/50">
                  Emergency Contact
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="relative">
                    <Shield className="w-4 h-4 text-[#f2efeb]/40 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="tel"
                      data-testid="sub-backup-phone-input"
                      aria-label="Backup phone"
                      value={subModal.emergencyContactPhone ?? ''}
                      onChange={(e) => setSubModal({ ...subModal, emergencyContactPhone: e.target.value })}
                      placeholder="Backup phone"
                      className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#f2efeb]/12 bg-[#111113] text-sm text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
                    />
                  </div>
                  <input
                    type="text"
                    aria-label="Emergency contact name"
                    value={subModal.emergencyContactName ?? ''}
                    onChange={(e) => setSubModal({ ...subModal, emergencyContactName: e.target.value })}
                    placeholder="Contact name (optional)"
                    className="w-full h-10 px-3 rounded-xl border border-[#f2efeb]/12 bg-[#111113] text-sm text-[#f2efeb] focus:outline-none focus:border-[#C81E2B]"
                  />
                </div>
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={Boolean(subModal.emergencyConsent)}
                    onChange={(e) => setSubModal({ ...subModal, emergencyConsent: e.target.checked })}
                    className="mt-0.5 accent-[#C81E2B]"
                  />
                  <div>
                    <span className="text-xs font-medium text-[#f2efeb]">Emergency contact has consented</span>
                    <p className="text-[11px] text-[#f2efeb]/50">
                      Only visible to coordinators. Requires consent.
                    </p>
                  </div>
                </label>
              </div>

              {/* PERMISSIONS */}
              <div className="space-y-2 pt-1">
                <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#f2efeb]/50">
                  Permissions
                </p>
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={Boolean(subModal.canManageNetwork)}
                    onChange={(e) => setSubModal({ ...subModal, canManageNetwork: e.target.checked })}
                    className="mt-0.5 accent-[#C81E2B]"
                  />
                  <div>
                    <span className="text-xs font-medium text-[#f2efeb]">
                      Can manage network <span className="text-[#E12D39] font-semibold">(Partner)</span>
                    </span>
                    <p className="text-[11px] text-[#f2efeb]/50">
                      Allows saving guest contacts and nominating &ldquo;Send Someone Else&rdquo; with mandatory coordinator approval.
                    </p>
                  </div>
                </label>
              </div>

              <div className="pt-2 grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setSubModal(null)} className="h-11 rounded-xl border border-[#f2efeb]/12 text-xs font-semibold text-[#f2efeb] hover:bg-white/[0.04] cursor-pointer">
                  Cancel
                </button>
                <button type="submit" disabled={busy} className="h-11 rounded-xl bg-[#C81E2B] hover:bg-[#A31621] text-white text-xs font-semibold cursor-pointer">
                  {busy ? 'Saving...' : subModal.id ? 'Update record' : subModal.initialPassword ? 'Add record' : 'Create & invite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD / EDIT CHAPTER MODAL */}
      {chapterModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Chapter form">
          <div className="w-full sm:max-w-lg bg-[#18181a] rounded-t-lg sm:rounded-lg border border-[#f2efeb]/10 max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-[#f2efeb]/10 flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-[#f2efeb]">{chapterModal.id ? 'Edit Chapter' : 'Add Chapter'}</h2>
              <button type="button" onClick={() => setChapterModal(null)} className="w-9 h-9 rounded-lg flex items-center justify-center text-[#f2efeb]/60">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={saveChapter} className="p-5 overflow-y-auto space-y-3.5">
              {error && <p className="p-2.5 rounded-lg bg-red-500/12 text-xs text-red-400">{error}</p>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Chapter Name *</label>
                  <input type="text" required value={chapterModal.name ?? ''} onChange={(e) => setChapterModal({ ...chapterModal, name: e.target.value })} className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Regular Weekday (Info Only)</label>
                  <select value={chapterModal.regularWeekday ?? 'Thursday'} onChange={(e) => setChapterModal({ ...chapterModal, regularWeekday: e.target.value as Weekday })} className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] text-sm">
                    {WEEKDAYS.map((w) => <option key={w} value={w}>{w}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Linked Default Venue *</label>
                <select required value={chapterModal.defaultLocationId ?? ''} onChange={(e) => setChapterModal({ ...chapterModal, defaultLocationId: e.target.value })} className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] text-sm">
                  {data.locations.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.area})</option>)}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Reporting</label>
                  <input type="text" value={chapterModal.reportingTime ?? '07:15 AM'} onChange={(e) => setChapterModal({ ...chapterModal, reportingTime: e.target.value })} className="w-full h-10 px-2.5 rounded-[6px] border border-[#f2efeb]/10 text-xs" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Start</label>
                  <input type="text" value={chapterModal.startTime ?? '07:30 AM'} onChange={(e) => setChapterModal({ ...chapterModal, startTime: e.target.value })} className="w-full h-10 px-2.5 rounded-[6px] border border-[#f2efeb]/10 text-xs" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">End</label>
                  <input type="text" value={chapterModal.endTime ?? '09:30 AM'} onChange={(e) => setChapterModal({ ...chapterModal, endTime: e.target.value })} className="w-full h-10 px-2.5 rounded-[6px] border border-[#f2efeb]/10 text-xs" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Default Member Fee (₹)</label>
                  <input type="number" value={chapterModal.defaultMemberFee ?? 500} onChange={(e) => setChapterModal({ ...chapterModal, defaultMemberFee: Number(e.target.value) })} className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm tabular-nums" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Default Sub Payout (₹)</label>
                  <input type="number" value={chapterModal.defaultSubstitutePayout ?? 350} onChange={(e) => setChapterModal({ ...chapterModal, defaultSubstitutePayout: Number(e.target.value) })} className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm tabular-nums" />
                </div>
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setChapterModal(null)} className="h-10 px-4 rounded-[6px] border border-[#f2efeb]/10 text-xs font-semibold">Cancel</button>
                <button type="submit" disabled={busy} className="h-10 px-5 rounded-[6px] bg-[#C81E2B] text-white text-xs font-semibold">Save Chapter</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD / EDIT LOCATION MODAL */}
      {locationModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Location form">
          <div className="w-full sm:max-w-lg bg-[#18181a] rounded-t-lg sm:rounded-lg border border-[#f2efeb]/10 max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-[#f2efeb]/10 flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-[#f2efeb]">{locationModal.id ? 'Edit Location' : 'Add Location'}</h2>
              <button type="button" onClick={() => setLocationModal(null)} className="w-9 h-9 rounded-lg flex items-center justify-center text-[#f2efeb]/60">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={saveLocation} className="p-5 overflow-y-auto space-y-3.5">
              {error && <p className="p-2.5 rounded-lg bg-red-500/12 text-xs text-red-400">{error}</p>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Venue Name *</label>
                  <input type="text" required value={locationModal.name ?? ''} onChange={(e) => setLocationModal({ ...locationModal, name: e.target.value })} className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Locality / Area *</label>
                  <input type="text" required value={locationModal.area ?? ''} onChange={(e) => setLocationModal({ ...locationModal, area: e.target.value })} className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Full Address</label>
                <input type="text" value={locationModal.fullAddress ?? ''} onChange={(e) => setLocationModal({ ...locationModal, fullAddress: e.target.value })} className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Google Maps URL</label>
                <input type="url" value={locationModal.mapsUrl ?? ''} onChange={(e) => setLocationModal({ ...locationModal, mapsUrl: e.target.value })} className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Nearest Station</label>
                  <input type="text" value={locationModal.nearestStation ?? ''} onChange={(e) => setLocationModal({ ...locationModal, nearestStation: e.target.value })} className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Entry Notes</label>
                  <input type="text" value={locationModal.entryNotes ?? ''} onChange={(e) => setLocationModal({ ...locationModal, entryNotes: e.target.value })} className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm" />
                </div>
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setLocationModal(null)} className="h-10 px-4 rounded-[6px] border border-[#f2efeb]/10 text-xs font-semibold">Cancel</button>
                <button type="submit" disabled={busy} className="h-10 px-5 rounded-[6px] bg-[#C81E2B] text-white text-xs font-semibold">Save Venue</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* INVITE COORDINATOR MODAL */}
      {coordInviteModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Invite coordinator">
          <div className="w-full sm:max-w-md bg-[#18181a] rounded-t-lg sm:rounded-lg border border-[#f2efeb]/10 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#f2efeb]/10 flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-[#f2efeb]">Invite External Coordinator</h2>
              <button type="button" onClick={() => setCoordInviteModal(false)} className="w-9 h-9 rounded-lg flex items-center justify-center text-[#f2efeb]/60">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={inviteCoordinator} className="p-5 space-y-3.5">
              {error && <p className="p-2.5 rounded-lg bg-red-500/12 text-xs text-red-400">{error}</p>}
              <div>
                <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Full Name *</label>
                <input type="text" required value={coordForm.displayName} onChange={(e) => setCoordForm({ ...coordForm, displayName: e.target.value })} className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Invite Email *</label>
                <input type="email" required value={coordForm.email} onChange={(e) => setCoordForm({ ...coordForm, email: e.target.value })} className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Calling Number *</label>
                  <input type="tel" required value={coordForm.phone} onChange={(e) => setCoordForm({ ...coordForm, phone: e.target.value })} className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#f2efeb] mb-1">WhatsApp Number</label>
                  <input type="tel" value={coordForm.whatsappPhone} onChange={(e) => setCoordForm({ ...coordForm, whatsappPhone: e.target.value })} className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#f2efeb] mb-1">Managed Zone / Region</label>
                <input type="text" value={coordForm.region} onChange={(e) => setCoordForm({ ...coordForm, region: e.target.value })} className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#f2efeb] mb-1">
                  Optional Initial Password (min 8 chars — leave blank for invite token)
                </label>
                <input
                  type="password"
                  minLength={8}
                  value={coordForm.initialPassword}
                  onChange={(e) => setCoordForm({ ...coordForm, initialPassword: e.target.value })}
                  placeholder="Hashed on server; never stored in plaintext"
                  className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm"
                />
              </div>
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={coordForm.showOnLogin}
                  onChange={(e) => setCoordForm({ ...coordForm, showOnLogin: e.target.checked })}
                  className="mt-0.5 accent-[#C81E2B]"
                />
                <div>
                  <span className="text-xs font-medium text-[#f2efeb]">Show on login quick-fill list</span>
                  <p className="text-[11px] text-[#f2efeb]/50">
                    Allows this email to appear in the Login page quick-fill panel.
                  </p>
                </div>
              </label>
              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setCoordInviteModal(false)} className="h-10 px-4 rounded-[6px] border border-[#f2efeb]/10 text-xs font-semibold">Cancel</button>
                <button type="submit" disabled={busy} className="h-10 px-5 rounded-[6px] bg-[#C81E2B] text-white text-xs font-semibold cursor-pointer">
                  {coordForm.initialPassword ? 'Create Account' : 'Send Invite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SUPER ADMIN PASSWORD RESET MODAL */}
      {pwResetTarget && isAdmin && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Reset user password"
        >
          <div className="w-full sm:max-w-md bg-[#18181a] rounded-t-lg sm:rounded-lg border border-[#f2efeb]/10 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#f2efeb]/10 flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-[#f2efeb]">Reset Account Password</h2>
                <p className="text-xs text-[#f2efeb]/60">
                  {pwResetTarget.name} ({pwResetTarget.roleLabel}) · {pwResetTarget.email}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close password reset modal"
                onClick={() => setPwResetTarget(null)}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-[#f2efeb]/60"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAdminPasswordReset} className="p-5 space-y-4">
              {error && <p className="p-2.5 rounded-lg bg-red-500/12 text-xs text-red-400">{error}</p>}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPwResetMode('SET_DIRECT')}
                  className={`p-2.5 rounded-[6px] border text-left text-xs font-semibold cursor-pointer ${
                    pwResetMode === 'SET_DIRECT'
                      ? 'border-[#C81E2B] bg-[#C81E2B]/18 text-[#f2efeb]'
                      : 'border-[#f2efeb]/10 text-[#f2efeb]/60'
                  }`}
                >
                  Set New Password
                </button>
                <button
                  type="button"
                  onClick={() => setPwResetMode('GENERATE_TOKEN')}
                  className={`p-2.5 rounded-[6px] border text-left text-xs font-semibold cursor-pointer ${
                    pwResetMode === 'GENERATE_TOKEN'
                      ? 'border-[#C81E2B] bg-[#C81E2B]/18 text-[#f2efeb]'
                      : 'border-[#f2efeb]/10 text-[#f2efeb]/60'
                  }`}
                >
                  Generate Reset Token
                </button>
              </div>

              {pwResetMode === 'SET_DIRECT' ? (
                <div>
                  <label htmlFor="admin-reset-pw" className="block text-xs font-semibold text-[#f2efeb] mb-1">
                    New Password (min 8 characters) *
                  </label>
                  <input
                    id="admin-reset-pw"
                    type="password"
                    required
                    minLength={8}
                    value={pwResetValue}
                    onChange={(e) => setPwResetValue(e.target.value)}
                    placeholder="Enter new strong password"
                    className="w-full h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 text-sm"
                  />
                  <p className="text-[11px] text-[#f2efeb]/60 mt-1">
                    Encrypted immediately with scrypt on the server and logged in the audit trail.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-[#f2efeb]/70 leading-relaxed p-3 rounded-[6px] bg-[#1f1f23] border border-[#f2efeb]/10">
                  Generates a one-time sandbox reset token that the user can enter under &ldquo;Forgot password?&rdquo; on the Sign-In page.
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPwResetTarget(null)}
                  className="h-10 px-4 rounded-[6px] border border-[#f2efeb]/10 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="h-10 px-5 rounded-[6px] bg-[#C81E2B] text-white text-xs font-semibold cursor-pointer"
                >
                  {busy ? 'Updating...' : pwResetMode === 'SET_DIRECT' ? 'Update Password' : 'Issue Reset Token'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
