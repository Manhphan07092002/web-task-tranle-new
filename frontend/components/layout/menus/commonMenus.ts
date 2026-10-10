import {
  CheckSquare, Calendar, FileText, FolderOpen,
  Mail, Video, StickyNote, Bell, Users, Settings,
} from 'lucide-react';
import type { NavGroup } from './menuTypes';

// Company-wide modules. Identical for every department.
export const COMMON_TOP_GROUPS: NavGroup[] = [
  {
    label: 'Công việc',
    items: [
      { id: 'tasks', label: 'Công việc', icon: CheckSquare, path: '/tasks', permission: ['view_all_tasks', 'manage_dept_tasks', 'view_own_tasks'] },
      { id: 'calendar', label: 'Lịch', icon: Calendar, path: '/calendar', permission: ['view_all_tasks', 'manage_dept_tasks', 'view_own_tasks'] },
      { id: 'reports', label: 'Báo cáo CV', icon: FileText, path: '/reports', permission: ['view_all_reports', 'approve_dept_reports', 'create_report', 'director_feedback'] },
      { id: 'documents', label: 'Tài liệu', icon: FolderOpen, path: '/documents', permission: null },
    ],
  },
  {
    label: 'Giao tiếp',
    items: [
      { id: 'mail', label: 'Hộp thư', icon: Mail, path: '/mail', permission: null },
      { id: 'meetings', label: 'Cuộc họp', icon: Video, path: '/meetings', permission: null },
      { id: 'notes', label: 'Ghi chú', icon: StickyNote, path: '/notes', permission: null },
      { id: 'notifications', label: 'Thông báo', icon: Bell, path: '/notifications', permission: null },
    ],
  },
];

// System group is also permission-filtered (personal settings for all,
// user management only for privileged roles).
export const SYSTEM_GROUP: NavGroup = {
  label: 'Hệ thống',
  items: [
    { id: 'team', label: 'Đội ngũ', icon: Users, path: '/team', permission: ['view_dept_users', 'manage_users'] },
    { id: 'settings', label: 'Cài đặt', icon: Settings, path: '/settings', permission: null },
  ],
};
