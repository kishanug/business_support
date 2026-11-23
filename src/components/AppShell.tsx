import React, { useState } from 'react';
import {
  BarChart3,
  Bell,
  Briefcase,
  CalendarCheck2,
  ChevronRight,
  ClipboardList,
  Home,
  IndianRupee,
  LogOut,
  Moon,
  Network,
  RotateCcw,
  Shield,
  Sun,
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
  onSelectNotification: (notification: NotificationItem) => void;
  onLogout: () => void;
  onResetDemo?: () => void;
  onOpenSettings: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  primaryAction?: React.ReactNode;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  user,
  activeTab,
  onSelectTab,
  notifications,
  onSelectNotification,
  onLogout,
  onResetDemo,
  onOpenSettings,
  theme,
  onToggleTheme,
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
      ? 'Veloctive Team Partner'
      : 'Veloctive Team';

  const currentNav = navItems.find((n) => n.id === activeTab) ?? navItems[0];

  return (
    <div className="min-h-screen bg-[#111113] text-[#f2efeb] flex flex-col lg:flex-row">
      {/* Desktop Sidebar — Obsidian Editorial Panel */}
      <aside className="hidden lg:flex lg:flex-col lg:w-[248px] shrink-0 bg-[#18181a] border-r border-[#f2efeb]/10 sticky top-0 h-screen">
        <button
          type="button"
          aria-label="AgencyOS by Kishan — Go to Home"
          onClick={() => onSelectTab('home')}
          className="px-5 h-16 w-full flex items-center gap-3 border-b border-[#f2efeb]/10 overflow-hidden text-left hover:bg-white/[0.02] transition-colors cursor-pointer"
        >
          <img
            src="/assets/aistudio/image__1__81460661.png"
            alt="Veloctive emblem"
            referrerPolicy="no-referrer"
            className="h-8 w-auto object-contain shrink-0"
          />
          <div className="min-w-0 flex flex-col leading-none">
            <span className="font-editorial text-[19px] font-bold tracking-[-0.03em] text-[#f2efeb] whitespace-nowrap">
              Agency<span className="text-[#E2B340]">OS</span>
            </span>
            <span className="font-editorial italic text-[10.5px] font-medium text-[#E2B340] mt-0.5 whitespace-nowrap">
              by Kishan
            </span>
          </div>
        </button>

        <nav aria-label="Main navigation" className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => onSelectTab(item.id)}
                className={`w-full h-11 px-3.5 rounded-[4px] text-sm font-medium flex items-center gap-3 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-[#C81E2B]/18 border-[#E12D39] text-[#f2efeb] font-semibold'
                    : 'border-transparent text-[#f2efeb]/65 hover:bg-white/[0.05] hover:text-[#f2efeb]'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#E2B340]' : ''}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3.5 border-t border-[#f2efeb]/10 space-y-2">
          {user.namespace === 'demo' && onResetDemo && (
            <button
              type="button"
              onClick={onResetDemo}
              className="w-full h-9 px-3 rounded-[4px] border border-[#f2efeb]/12 bg-white/[0.03] hover:bg-white/[0.07] text-xs font-medium text-[#f2efeb]/80 flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#E2B340]" />
              Reset Demo Data
            </button>
          )}
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <button
              type="button"
              onClick={onOpenSettings}
              className="min-w-0 text-left flex-1 hover:opacity-80 cursor-pointer"
            >
              <p className="text-xs font-semibold text-[#f2efeb] truncate">{user.displayName}</p>
              <p className="font-mono text-[10px] text-[#f2efeb]/55 truncate">
                {roleLabel} {user.namespace === 'demo' ? '· Demo' : ''}
              </p>
            </button>
            <button
              type="button"
              aria-label="Sign out"
              onClick={onLogout}
              className="w-9 h-9 rounded-[4px] flex items-center justify-center text-[#f2efeb]/60 hover:bg-white/[0.06] hover:text-[#f2efeb] shrink-0 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 h-[52px] lg:h-16 bg-[#111113]/92 backdrop-blur-md border-b border-[#f2efeb]/10 px-4 lg:px-8 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              aria-label="AgencyOS by Kishan — Go to Home"
              onClick={() => onSelectTab('home')}
              className={`lg:hidden inline-flex items-center gap-2 shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
                activeTab === 'home' ? 'border-[#E2B340]' : 'border-transparent hover:border-[#f2efeb]/30'
              }`}
            >
              <img
                src="/assets/aistudio/image__1__81460661.png"
                alt="Veloctive emblem"
                referrerPolicy="no-referrer"
                className="h-7 w-auto object-contain shrink-0"
              />
              <span className="flex flex-col items-start leading-none">
                <span className="font-editorial text-[15px] font-bold tracking-[-0.03em] text-[#f2efeb] whitespace-nowrap">
                  Agency<span className="text-[#E2B340]">OS</span>
                </span>
                <span className="font-editorial italic text-[9px] font-medium text-[#E2B340] mt-0.5 whitespace-nowrap">
                  by Kishan
                </span>
              </span>
            </button>
            <span aria-hidden="true" className="lg:hidden h-5 w-px bg-[#f2efeb]/15 shrink-0" />
            <div className="min-w-0">
              <h1 className="font-display text-sm sm:text-base lg:text-lg font-extrabold tracking-[-0.02em] text-[#f2efeb] truncate">
                {currentNav.label}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {primaryAction}
            <button
              type="button"
              data-testid="theme-toggle-btn"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              onClick={onToggleTheme}
              className="h-10 px-3 rounded-[4px] border border-[#f2efeb]/15 bg-[#18181a] hover:bg-white/[0.06] flex items-center justify-center gap-1.5 text-xs font-semibold text-[#f2efeb] cursor-pointer transition-colors"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-3.5 h-3.5 text-[#E2B340] shrink-0" />
                  <span className="hidden sm:inline">Light</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5 text-[#C81E2B] shrink-0" />
                  <span className="hidden sm:inline">Dark</span>
                </>
              )}
            </button>
            <button
              type="button"
              aria-label={`Notifications (${unreadCount} unread)`}
              onClick={() => setNotifOpen(true)}
              className="relative w-10 h-10 rounded-[4px] border border-[#f2efeb]/12 bg-[#18181a] hover:bg-white/[0.06] flex items-center justify-center text-[#f2efeb] cursor-pointer transition-colors"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-[4px] bg-[#C81E2B] text-white font-mono text-[10px] font-bold flex items-center justify-center tabular-nums">
                  {unreadCount}
                </span>
              )}
            </button>
            <button
              type="button"
              aria-label="Account and workspace settings"
              onClick={onOpenSettings}
              className="w-10 h-10 rounded-[4px] bg-[#E2B340]/15 border border-[#E2B340]/45 text-[#E2B340] font-mono text-xs font-bold flex items-center justify-center hover:bg-[#E2B340]/25 cursor-pointer transition-colors"
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
        <main className="flex-1 w-full max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 lg:pb-12">
          {children}
        </main>
      </div>

      {/* Mobile Fixed Bottom Navigation Bar */}
      <nav
        aria-label="Mobile navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-14 bg-[#18181a]/95 backdrop-blur-md border-t border-[#f2efeb]/10 flex items-center justify-around px-1"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onSelectTab(item.id)}
              className={`flex-1 h-12 flex flex-col items-center justify-center gap-0.5 rounded-[4px] border-b-2 transition-colors cursor-pointer ${
                active
                  ? 'border-[#E12D39] bg-[#C81E2B]/14 text-[#f2efeb] font-semibold'
                  : 'border-transparent text-[#f2efeb]/55 hover:text-[#f2efeb]/85'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="font-mono text-[9px] uppercase tracking-wider leading-none truncate max-w-[68px]">
                {'shortLabel' in item && item.shortLabel ? item.shortLabel : item.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Notifications Drawer */}
      {notifOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-label="Notifications"
        >
          <div className="w-full max-w-md bg-[#18181a] h-full border-l border-[#f2efeb]/12 flex flex-col">
            <div className="px-5 h-16 border-b border-[#f2efeb]/10 flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-[#f2efeb]">Notifications</h2>
                <p className="font-mono text-[10px] uppercase tracking-wider text-[#f2efeb]/55">
                  {unreadCount} unread
                </p>
              </div>
              <button
                type="button"
                aria-label="Close notifications"
                onClick={() => setNotifOpen(false)}
                className="w-9 h-9 rounded-[4px] flex items-center justify-center text-[#f2efeb]/60 hover:bg-white/[0.06] hover:text-[#f2efeb] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-[#f2efeb]/10">
              {notifications.length === 0 ? (
                <div className="p-8 text-center text-sm text-[#f2efeb]/55">
                  No notifications yet.
                </div>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    data-testid={`notification-item-${n.id}`}
                    onClick={() => {
                      setNotifOpen(false);
                      onSelectNotification(n);
                    }}
                    className={`group w-full text-left px-5 py-4 hover:bg-white/[0.05] transition-colors cursor-pointer flex items-start justify-between gap-3 ${
                      n.read ? 'bg-transparent' : 'bg-[#C81E2B]/10'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-semibold text-[#f2efeb] group-hover:text-[#E2B340] transition-colors">
                          {n.title}
                        </p>
                        <span className="font-mono text-[10px] uppercase tracking-wider text-[#E2B340] shrink-0">
                          {n.read ? 'Read' : 'New'}
                        </span>
                      </div>
                      <p className="text-xs text-[#f2efeb]/65 mt-1 leading-relaxed">{n.body}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#f2efeb]/35 group-hover:text-[#E2B340] shrink-0 mt-0.5 transition-colors" />
                  </button>
                ))
              )}
            </div>
            <div className="px-5 py-3 border-t border-[#f2efeb]/10 bg-[#111113] flex items-center justify-between text-[11px] text-[#f2efeb]/55">
              <span className="inline-flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-[#E2B340]" />
                AgencyOS Activity Feed
              </span>
              <Briefcase className="w-3.5 h-3.5 text-[#f2efeb]/40" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
