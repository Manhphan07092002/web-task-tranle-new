import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button, Card, Avatar } from '../../components/UI';
import { PlusCircle, Edit, Trash2, X, Mail, Phone, MapPin, Calendar, Info, CreditCard, Users } from 'lucide-react';
import { User } from '../../types';
import { useData } from '../../contexts/DataContext';
import { useRBAC } from '../../hooks/useRBAC';
import { UserProfilePopup } from '../../components/UserProfilePopup';
import { getSignature } from '../Mail/utils';

interface TeamPageProps {
  t: (key: string) => string;
  user: User;
  users: User[];
  openCreateUserModal: () => void;
  openEditUserModal: (u: User) => void;
  handleDeleteUser: (userId: string) => void;
}

export default function TeamPage({
  t, user, users, openCreateUserModal, openEditUserModal, handleDeleteUser
}: TeamPageProps) {
  const { roles } = useData();
  const { accessibleDepartments } = useRBAC();
  const perms = user.permissions || [];
  const canViewTeam = perms.includes('view_dept_users') || perms.includes('manage_users');
  const canManageTeam = perms.includes('manage_users');
  const navigate = useNavigate();

  // TP+ thấy cả phòng được giao (tên + FK), không chỉ tên phòng mình
  const visibleUsers = users.filter(u => {
    if (canManageTeam) return true;
    if (u.id === user.id) return true;
    if (u.department && (u.department === user.department || accessibleDepartments.includes(u.department))) return true;
    if (u.primaryDepartmentId && user.primaryDepartmentId && u.primaryDepartmentId === user.primaryDepartmentId) return true;
    return false;
  });

  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  if (!canViewTeam) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-gray-800">{t('teamMembers')}</h2>
          <p className="text-gray-500 text-sm mt-1">Manage your team and permissions</p>
        </div>
        {canManageTeam && (
          <Button onClick={() => openCreateUserModal()}>
            <PlusCircle size={18} className="mr-2" /> Add Member
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {visibleUsers.map(u => (
          <Card 
            key={u.id} 
            className="p-6 flex items-center gap-4 relative group cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => setSelectedUser(u)}
          >
            <Avatar src={u.avatar} alt={u.name} size={16} />
            <div className="flex-1 min-w-0">
              <h4 className="font-bold text-gray-800 dark:text-slate-100 text-lg truncate">{u.name}</h4>
              <p className="text-gray-500 dark:text-slate-400 text-sm mb-2">{u.department} • {u.email}</p>
              
              {(() => {
                const roleObj = roles.find(r => r.name === u.role);
                const roleColor = roleObj?.color || '#3b82f6'; // default blue
                return (
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border"
                      style={{ backgroundColor: roleColor + '18', color: roleColor, borderColor: roleColor + '44' }}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      {u.role}
                    </span>
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                      LV {u.managementLevel ?? 10}
                    </span>
                  </span>
                )
              })()}
            </div>
            {canManageTeam && (
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white dark:bg-slate-700 shadow-sm rounded-lg p-1">
                <button 
                  onClick={(e) => { e.stopPropagation(); openEditUserModal(u); }} 
                  className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-md hover:text-blue-600"
                >
                  <Edit size={14} />
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); handleDeleteUser(u.id); }} 
                  className="p-1.5 text-gray-500 hover:bg-red-50 rounded-md hover:text-red-600"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* User Profile Modal */}
      {selectedUser && (
        <UserProfilePopup 
          user={user}
          selectedUser={selectedUser}
          roles={roles}
          onClose={() => setSelectedUser(null)}
        />
      )}
    </div>
  );
}
