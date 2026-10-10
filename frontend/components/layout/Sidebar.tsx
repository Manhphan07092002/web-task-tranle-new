import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { PlusCircle, LogOut, Shield, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useData } from '../../contexts/DataContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { Button, Avatar } from '../UI';
import { apiFetch } from '../../services/api';
import { COMMON_TOP_GROUPS, SYSTEM_GROUP } from './menus/commonMenus';
import { DEPARTMENT_MENUS } from './menus/departmentMenus';
import { resolveDeptKey, roleLabel, roleSubtitle } from './menus/resolveDepartment';
import type { NavGroup } from './menus/menuTypes';

interface SidebarProps {
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (o: boolean) => void;
  openCreateModal: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isMobileMenuOpen, setIsMobileMenuOpen, openCreateModal }) => {
  const { user, logout } = useAuth();
  const { departments } = useData();
  const level = user?.managementLevel ?? 10;
  // Department -> menu config -> render. Only ONE department module renders.
  const deptKey = resolveDeptKey(user, departments || []);
  const deptGroup: NavGroup | null = deptKey ? DEPARTMENT_MENUS[deptKey] : null;
  const NAV_GROUPS: NavGroup[] = deptGroup
    ? [...COMMON_TOP_GROUPS, deptGroup, SYSTEM_GROUP]
    : [...COMMON_TOP_GROUPS, SYSTEM_GROUP];
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const { t } = useLanguage();
  const [unreadMailCount, setUnreadMailCount] = React.useState(0);
  const location = useLocation();

  // Swipe-to-close gesture for mobile sidebar
  const touchStartX = React.useRef<number | null>(null);
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    if (deltaX < -50) { // Swiped left more than 50px
      setIsMobileMenuOpen(false);
    }
    touchStartX.current = null;
  };

  // Fetch unread mail count periodically
  React.useEffect(() => {
    if (!user) return;

    const fetchUnreadCount = async () => {
      try {
        const res = await apiFetch('/api/mail/unread-count');
        if (res.ok) {
          const data = await res.json();
          setUnreadMailCount(data.count || 0);
        }
      } catch (err) {
        console.error('Failed to fetch unread mail count:', err);
      }
    };

    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000); // Check every 30 seconds
    window.addEventListener('mail-count-changed', fetchUnreadCount);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('mail-count-changed', fetchUnreadCount);
    };
  }, [user]);

  // Update document title
  React.useEffect(() => {
    if (unreadMailCount > 0) {
      document.title = `(${unreadMailCount}) Tran Le Tasks`;
    } else {
      document.title = 'Tran Le Tasks';
    }
  }, [unreadMailCount]);

  if (!user) return null;

  const perms = user?.permissions || [];
  const hasPerm = (p: string) => perms.includes(p);

  const canSeeItem = (permission: string[] | null, minLevel?: number) => {
    if (permission && permission.some(p => hasPerm(p))) return true;
    if (minLevel !== undefined && level !== 99 && level >= minLevel) return true;
    if (!permission && minLevel === undefined) return true;
    return false;
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-20 lg:hidden backdrop-blur-sm"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className={`
        fixed inset-y-2 sm:inset-y-4 left-2 sm:left-4 z-40 w-[calc(100vw-1rem)] sm:w-64 max-w-[16rem] bg-white/80 backdrop-blur-3xl border border-white/60 shadow-2xl shadow-brand-500/10 rounded-2xl sm:rounded-[2rem] flex flex-col overflow-hidden transform transition-all duration-500 ease-out
        ${isMobileMenuOpen ? 'translate-x-0 opacity-100' : '-translate-x-[120%] lg:translate-x-0 lg:opacity-100'}
      `}>
        <div className="h-full flex flex-col">

          {/* Logo */}
          <div className="h-20 flex items-center px-5 border-b border-gray-100/80 flex-shrink-0">
            <img src="/logo-square.png" alt="Tran Le Electricity" className="h-9 w-9 object-contain mr-3 drop-shadow-sm flex-shrink-0" />
            <div>
              <span className="text-base font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-gray-100 dark:to-gray-300 tracking-tight block leading-tight">
                Tran Le Tasks
              </span>
              <span className="text-[10px] text-gray-500 font-medium leading-tight block">Tran Le Electricity</span>
            </div>
          </div>

          {/* New Task Button */}
          <div className="px-4 pt-4 pb-2 flex-shrink-0">
            <Button onClick={() => openCreateModal()} className="w-full justify-center gap-2 shadow-brand-200/60 shadow-md" size="sm">
              <PlusCircle size={16} /> Tạo công việc
            </Button>
          </div>

          {/* Nav Groups */}
          <nav className="flex-1 px-3 py-2 overflow-y-auto space-y-4">
            {NAV_GROUPS.map(group => {
              const visibleItems = group.items.filter(item => canSeeItem(item.permission, item.minLevel));
              if (visibleItems.length === 0) return null;
              return (
                <div key={group.label}>
                  <p className="px-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 flex items-center gap-2">
                    {group.label}
                    {group.scopeBadge && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-blue-600 text-white tracking-normal">
                        {roleLabel(level)}
                      </span>
                    )}
                  </p>
                  <div className="space-y-0.5">
                    {visibleItems.map(item => {
                      if (item.children) {
                        const isChildActive = (to: string) => {
                          const [childPath, childQuery] = to.split('?');
                          if (location.pathname !== childPath) return false;
                          const current = new URLSearchParams(location.search);
                          if (!childQuery) return !current.get('type') && !current.get('view');
                          const expected = new URLSearchParams(childQuery);
                          for (const [key, value] of expected) {
                            if (current.get(key) !== value) return false;
                          }
                          return true;
                        };
                        const anyChildActive = item.children.some(child => isChildActive(child.to));
                        const isOpen = expandedGroups[item.id] ?? anyChildActive;
                        return (
                          <div key={item.id} className="space-y-0.5">
                            <button
                              type="button"
                              onClick={() => setExpandedGroups(prev => ({ ...prev, [item.id]: !isOpen }))}
                              className={`
                                w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl transition-all
                                ${anyChildActive
                                  ? 'bg-brand-50/60 text-brand-700 border border-brand-100/50 shadow-sm'
                                  : 'text-gray-600 hover:bg-gray-100/80 hover:text-gray-900'
                                }
                              `}
                            >
                              <item.icon size={17} className="flex-shrink-0" />
                              <span className="flex-1 text-left truncate">{item.label || t(item.id)}</span>
                              {isOpen ? (
                                <ChevronUp size={15} className="text-gray-400" />
                              ) : (
                                <ChevronDown size={15} className="text-gray-400" />
                              )}
                            </button>
                            {isOpen && (
                              <div className="pl-6 pr-1 py-1 space-y-1 border-l-2 border-brand-100/50 ml-5">
                                {item.children.map(child => {
                                  const active = isChildActive(child.to);
                                  return (
                                    <NavLink
                                      key={child.id}
                                      to={child.to}
                                      onClick={() => setIsMobileMenuOpen(false)}
                                      className={`
                                        w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg transition-all
                                        ${active
                                          ? 'bg-brand-50 text-brand-700 shadow-sm border border-brand-100'
                                          : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                                        }
                                      `}
                                    >
                                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${active ? 'bg-brand-600' : 'bg-gray-300'}`} />
                                      <span className="flex-1 truncate">{child.label}</span>
                                    </NavLink>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      }
                      return (
                        <NavLink
                          key={item.id}
                          to={item.path}
                          onClick={() => setIsMobileMenuOpen(false)}
                          className={({ isActive }) => `
                            w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl transition-all
                            ${isActive
                              ? 'bg-brand-50 text-brand-700 shadow-sm border border-brand-100'
                              : 'text-gray-600 hover:bg-gray-100/80 hover:text-gray-900'
                            }
                          `}
                        >
                          <item.icon size={17} className="flex-shrink-0" />
                          <span className="flex-1 truncate">{item.label || t(item.id)}</span>
                          {item.id === 'mail' && unreadMailCount > 0 && (
                            <span className="ml-auto bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center justify-center min-w-[20px]">
                              {unreadMailCount > 99 ? '99+' : unreadMailCount}
                            </span>
                          )}
                        </NavLink>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>

          {/* Bottom Section: Admin + User */}
          <div className="flex-shrink-0 border-t border-gray-100 pt-2 pb-3 px-3 space-y-1">
            {/* Admin link */}
            {hasPerm('admin_panel') && (
              <a
                href="/admin"
                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl transition-all text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-100"
              >
                <Shield size={17} className="flex-shrink-0" />
                Quản trị viên
              </a>
            )}

            {/* User profile / logout */}
            <div
              className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-gray-100/80 cursor-pointer transition-colors group"
              onClick={logout}
              title="Đăng xuất"
            >
              <Avatar src={user.avatar} alt={user.name} size={8} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate leading-tight">{user.name}</p>
                <p className="text-[11px] text-gray-400 truncate leading-tight">{roleSubtitle(user)}</p>
              </div>
              <LogOut size={15} className="text-gray-300 group-hover:text-red-500 transition-colors flex-shrink-0" />
            </div>
          </div>

        </div>
      </aside>
    </>
  );
};




