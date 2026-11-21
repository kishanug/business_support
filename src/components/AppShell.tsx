import React, { useState } from 'react';
import {
  BarChart3,
  Bell,
  Briefcase,
  CalendarCheck2,
  ClipboardList,
  Home,
  IndianRupee,
  LogOut,
  Network,
  RotateCcw,
  Shield,
  Users,
  X,
} from 'lucide-react';
import type { NotificationItem, SessionUser } from '../core/types';

export type AdminTab = 'home' | 'requests' | 'people' | 'finance' | 'reports';
export type SubTab = 'home' | 'open' | 'meetings' | 'earnings' | 'network';

interface AppShellProps {
  user: SessionUser;
  activeTab: string;
  onSelectTab: (tab: string) => void;
  notifications: NotificationItem[];
  onMarkNotificationRead: (id: string) => void;
  onLogout: () => void;
  onResetDemo?: () => void;
  onOpenSettings: () => void;
  primaryAction?: React.ReactNode;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  user,
  activeTab,
  onSelectTab,
  notifications,
  onMarkNotificationRead,
  onLogout,
  onResetDemo,
  onOpenSettings,
  primaryAction,
  children,
}) => {
  const [notifOpen, setNotifOpen] = useState(false);

  const isSub = user.role === 'SUBSTITUTE';
  const unreadCount = notifications.filter((n) => !n.read).length;

  const navItems = isSub
    ? [
        { id: 'home', label: 'Home', icon: Home },
        { id: 'open', label: 'Open Requests', shortLabel: 'Open', icon: ClipboardList },
        { id: 'meetings', label: 'My Meetings', shortLabel: 'Meetings', icon: CalendarCheck2 },
        { id: 'earnings', label: 'Earnings', shortLabel: 'Earnings', icon: IndianRupee },
        ...(user.canManageNetwork
          ? [{ id: 'network', label: 'My Network', shortLabel: 'Network', icon: Network }]
          : []),
      ]
    : [
        { id: 'home', label: 'Home', icon: Home },
        { id: 'requests', label: 'Requests', icon: ClipboardList },
        { id: 'people', label: 'People', icon: Users },
        { id: 'finance', label: 'Finance', icon: IndianRupee },
        { id: 'reports', label: 'Reports', icon: BarChart3 },
      ];

  const roleLabel =
    user.role === 'SUPER_ADMIN'
      ? 'Super Admin'
      : user.role === 'EXTERNAL_COORDINATOR'
      ? 'External Coordinator'
      : user.canManageNetwork
      ? 'Partner Substitute'
      : 'Substitute';

  const currentNav = navItems.find((n) => n.id === activeTab) ?? navItems[0];

  return (
    <div className="min-h-screen bg-[#FFFFFF] flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-[248px] shrink-0 bg-[#F8F7FC] border-r border-[#E6E8EF] sticky top-0 h-screen">
        <div className="px-5 h-16 flex items-center gap-2.5 border-b border-[#E6E8EF]">
          <img
            src="/assets/aistudio/image__1__81460661.png"
            alt="AgencyOS emblem"
            referrerPolicy="no-referrer"
            className="h-8 w-auto object-contain shrink-0"
          />
          <div className="relative inline-flex items-baseline">
            <span className="font-display text-lg font-extrabold tracking-tight text-[#142342]">
              Agency<span className="text-[#C59D45]">OS</span>
            </span>
            <span className="ml-0.5 -mt-1 self-start text-[10px] font-medium italic text-[#B58F3D] -rotate-6 whitespace-nowrap">
              by Kishan
            </span>
          </div>
        </div>

        <nav aria-label="Main navigation" className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`w-full h-11 px-3.5 rounded-xl text-sm font-medium flex items-center gap-3 transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-[#6D28D9] text-white font-semibold'
                    : 'text-[#334155] hover:bg-[#F3E8FF]/70 hover:text-[#142342]'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3.5 border-t border-[#E6E8EF] space-y-2">
          {user.namespace === 'demo' && onResetDemo && (
            <button
              type="button"
              onClick={onResetDemo}
              className="w-full h-9 px-3 rounded-lg border border-[#E6E8EF] bg-white hover:bg-[#F3E8FF]/50 text-xs font-medium text-[#475569] flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Demo Data
            </button>
          )}
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <button
              type="button"
              onClick={onOpenSettings}
              className="min-w-0 text-left flex-1 hover:opacity-80 cursor-pointer"
            >
              <p className="text-xs font-semibold text-[#142342] truncate">{user.displayName}</p>
              <p className="text-[11px] text-[#64748B] truncate">
                {roleLabel} {user.namespace === 'demo' ? '· Demo' : ''}
              </p>
            </button>
            <button
              type="button"
              aria-label="Sign out"
              onClick={onLogout}
              className="w-9 h-9 rounded-lg flex items-center justify-center text-[#64748B] hover:bg-white hover:text-[#142342] shrink-0 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar (Compact 52px on mobile, 64px on desktop) */}
        <header className="sticky top-0 z-30 h-[52px] lg:h-16 bg-white/95 backdrop-blur-sm border-b border-[#E6E8EF] px-4 lg:px-8 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="/assets/aistudio/image__1__81460661.png"
              alt="AgencyOS"
              referrerPolicy="no-referrer"
              className="h-7 w-auto object-contain lg:hidden shrink-0"
            />
            <div className="min-w-0">
              <h1 className="font-display text-base lg:text-lg font-bold text-[#142342] truncate">
                {currentNav.label}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {primaryAction}
            <button
              type="button"
              aria-label={`Notifications (${unreadCount} unread)`}
              onClick={() => setNotifOpen(true)}
              className="relative w-10 h-10 rounded-xl border border-[#E6E8EF] bg-white hover:bg-[#F8F7FC] flex items-center justify-center text-[#142342] cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#6D28D9] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                  {unreadCount}
                </span>
              )}
            </button>
            <button
              type="button"
              aria-label="Account and workspace settings"
              onClick={onOpenSettings}
              className="w-10 h-10 rounded-xl bg-[#F3E8FF] text-[#6D28D9] font-display text-xs font-bold flex items-center justify-center hover:bg-[#E9D5FF] cursor-pointer"
            >
              {user.displayName
                .split(' ')
                .map((p) => p[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </button>
          </div>
        </header>

        {/* Scrollable Workspace Viewport */}
        <main className="flex-1 w-full max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-5 pb-24 lg:pb-10">
          {children}
        </main>
      </div>

      {/* Mobile Fixed Bottom Navigation Bar (56px height + 52px top bar = 108px < 13% of 844px viewport) */}
      <nav
        aria-label="Mobile navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-14 bg-white/95 backdrop-blur-md border-t border-[#E6E8EF] flex items-center justify-around px-1"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`flex-1 h-12 flex flex-col items-center justify-center gap-0.5 rounded-lg transition-colors ${
                active ? 'text-[#6D28D9] font-semibold' : 'text-[#64748B]'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] leading-none truncate max-w-[68px]">
                {'shortLabel' in item && item.shortLabel ? item.shortLabel : item.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Notifications Drawer */}
      {notifOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#142342]/40 backdrop-blur-[1px] flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-label="Notifications"
        >
          <div className="w-full max-w-md bg-white h-full border-l border-[#E6E8EF] flex flex-col">
            <div className="px-5 h-16 border-b border-[#E6E8EF] flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-[#142342]">Notifications</h2>
                <p className="text-xs text-[#64748B]">{unreadCount} unread in-app updates</p>
              </div>
              <button
                type="button"
                aria-label="Close notifications"
                onClick={() => setNotifOpen(false)}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-[#64748B] hover:bg-[#F8F7FC]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-[#E6E8EF]">
              {notifications.length === 0 ? (
                <div className="p-8 text-center text-sm text-[#64748B]">
                  No notifications yet.
                </div>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => onMarkNotificationRead(n.id)}
                    className={`w-full text-left px-5 py-4 hover:bg-[#F8F7FC] transition-colors ${
                      n.read ? 'bg-white' : 'bg-[#F3E8FF]/30'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold text-[#142342]">{n.title}</p>
                      <span className="text-[11px] text-[#64748B] shrink-0">
                        {n.read ? 'Read' : 'New'}
                      </span>
                    </div>
                    <p className="text-xs text-[#475569] mt-1 leading-relaxed">{n.body}</p>
                  </button>
                ))
              )}
            </div>
            <div className="px-5 py-3.5 border-t border-[#E6E8EF] bg-[#F8F7FC] flex items-center justify-between text-[11px] text-[#64748B]">
              <span className="inline-flex items-center gap-1">
                <Shield className="w-3.5 h-3.5 text-[#B58F3D]" />
                In-app feed (push & auto-WhatsApp deferred to V1.1+)
              </span>
              <Briefcase className="w-3.5 h-3.5 text-[#94A3B8]" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
