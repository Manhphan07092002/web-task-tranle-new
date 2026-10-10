import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import { Sidebar } from './components/layout/Sidebar';
import { TopHeader } from './components/layout/TopHeader';

import DashboardPage from './pages/Dashboard/index';
import TasksPage from './pages/Tasks/index';
import NotesPage from './pages/Notes/index';
import TeamPage from './pages/Team/index';
import { CalendarView as CalendarPage } from './pages/Calendar/index';
const MeetingsPage = React.lazy(() => import('./pages/Meetings/index').then(module => ({ default: module.MeetingView })));
const JoinMeetingPage = React.lazy(() => import('./pages/Meetings/JoinMeeting').then(module => ({ default: module.JoinMeetingPage })));
import { SettingsView as SettingsPage } from './pages/Settings/index';
import ReportsPage from './pages/Reports/TaskReports';
import ContractsPage from './pages/Contracts/index';
import RevenuePage from './pages/Revenue/index';
import ProductsPage from './pages/Products/index';
import DepartmentStubPage from './pages/DepartmentStubPage';
import ForgotPasswordPage from './pages/ForgotPassword/index';
import ResetPasswordPage from './pages/ResetPassword/index';
import NotificationsPage from './pages/Notifications/index';
import ProjectsPage from './pages/Projects/index';
import ProjectReportsPage from './pages/ProjectReports/index';
import DocumentsPage from './pages/DocumentAdmin/index';

import { Sparkles } from 'lucide-react';

import { Task, TaskStatus, Note, RecurrenceType, User, Meeting } from './types';
import { TaskModal } from './components/TaskModal';
import { NoteModal } from './components/NoteModal';
import { UserModal } from './components/UserModal';
import { InviteModal } from './components/InviteModal';
import { TaskSuggestionModal } from './components/TaskSuggestionModal';
import MailPage from './pages/Mail';
const MeetingModal = React.lazy(() => import('./components/MeetingModal').then(module => ({ default: module.MeetingModal })));
const MeetingRoom = React.lazy(() => import('./components/MeetingRoom').then(module => ({ default: module.MeetingRoom })));
import { AIAssistant, AIAssistantHandle } from './components/AIAssistant';
import { useLanguage } from './contexts/LanguageContext';
import { useAuth } from './contexts/AuthContext';
import { useData } from './contexts/DataContext';
import { useNotifications } from './contexts/NotificationContext';
import { LoginView } from './components/LoginView';
import { ConfirmDialog } from './components/ConfirmDialog';

const getNextDate = (dateStr: string, type: RecurrenceType): string => {
  const d = new Date(dateStr + 'T12:00:00Z');
  if (type === RecurrenceType.DAILY) d.setUTCDate(d.getUTCDate() + 1);
  if (type === RecurrenceType.WEEKLY) d.setUTCDate(d.getUTCDate() + 7);
  if (type === RecurrenceType.MONTHLY) d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().split('T')[0];
};

export default function TranLeTaskApp() {
  const { t } = useLanguage();
  const { user, isLoading: isAuthLoading } = useAuth();
  const { tasks, notes, users, reports, contracts, isLoading: isDataLoading, saveTask, deleteTask, saveNote, deleteNote, saveUser, deleteUser } = useData();
  const { setNotes, pushLocalNotification } = useNotifications();

  useEffect(() => {
    if (setNotes && notes) {
      setNotes(notes);
    }
  }, [notes, setNotes]);

  // Apply Theme
  useEffect(() => {
    const root = window.document.documentElement;
    const theme = user?.preferences?.theme || 'system';

    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  }, [user?.preferences?.theme]);

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Modals Data
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [selectedDateForCreate, setSelectedDateForCreate] = useState<string>('');
  const [isSuggestionModalOpen, setIsSuggestionModalOpen] = useState(false);
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isMeetingModalOpen, setIsMeetingModalOpen] = useState(false);
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null);
  const [notification, setNotification] = useState({ visible: false, title: '', message: '', type: 'info' as any });

  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false, title: '', message: '', onConfirm: () => {}, type: 'danger' as any
  });

  const aiAssistantRef = useRef<AIAssistantHandle>(null);

  const checkPermission = (action: 'edit' | 'delete', task: Task, currentUser: User) => {
    const perms = currentUser.permissions || [];
    const isAdmin = perms.includes('admin_panel') || perms.includes('manage_users');
    const isCreator = task.createdBy === currentUser.id;
    const isAssignee = task.assignees.includes(currentUser.id);

    if (action === 'edit') {
      // Chỉ người tạo hoặc người được phân công mới được chỉnh sửa
      // Trưởng phòng, Giám đốc, Admin KHÔNG được edit task của người khác
      return isCreator || isAssignee;
    }

    if (action === 'delete') {
      // Chỉ người tạo hoặc Admin mới được xóa
      return isCreator || isAdmin;
    }

    return false;
  };

  const roleBasedTasks = useMemo(() => {
    if (!user) return [];
    const perms = user.permissions || [];
    return tasks.filter(t => {
      if (perms.includes('admin_panel') || perms.includes('view_all_tasks')) return true;
      if (perms.includes('manage_dept_tasks') && t.department === user.department) return true;
      if (t.assignees.includes(user.id) || t.createdBy === user.id) return true;
      return false;
    });
  }, [tasks, user]);

  const rawTodaysTasks = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return roleBasedTasks.filter(t => t.startDate === today);
  }, [roleBasedTasks]);

  useEffect(() => {
    const checkPendingTasks = () => {
      const pendingCount = rawTodaysTasks.filter(t => t.status !== TaskStatus.DONE).length;
      if (pendingCount > 0) {
        setNotification({
          visible: true, title: "Reminder: Pending Tasks ⏰",
          message: `You have ${pendingCount} unfinished tasks for today.`, type: 'warning'
        });
        setTimeout(() => setNotification(prev => ({ ...prev, visible: false })), 10000);
      }
    };
    const intervalId = setInterval(checkPendingTasks, 300000);
    return () => clearInterval(intervalId);
  }, [rawTodaysTasks]);

  useEffect(() => {
    // Report Reminder: Every Friday at >= 16:00
    const checkReportTime = () => {
      const now = new Date();
      if (now.getDay() === 5 && now.getHours() >= 16 && user && user.permissions?.includes('create_report')) {
        const hasFired = localStorage.getItem(`report_reminder_${now.toLocaleDateString()}`);
        if (!hasFired) {
          // Check if user already reported this week
          const currentWeekStartStr = (() => {
            const d = new Date();
            const day = d.getDay();
            const diffToMon = day === 0 ? -6 : 1 - day;
            const mon = new Date(d);
            mon.setDate(d.getDate() + diffToMon);
            return mon.toISOString().split('T')[0];
          })();
          
          const hasReportedThisWeek = reports.some(r => {
            if (r.authorId !== user.id) return false;
            try {
              const c = JSON.parse(r.content);
              return c.weekStart === currentWeekStartStr;
            } catch {
              return false;
            }
          });

          if (!hasReportedThisWeek) {
            pushLocalNotification({
              userId: user.id,
              type: 'report_reminder',
              title: "⏰ Đã đến giờ làm Báo cáo!",
              message: "Hôm nay là Thứ 6, đã qua 16h00. Vui lòng nhấp vào đây để tạo và gửi báo cáo công việc tuần này nhé!"
            });
          }
          // Mark as fired regardless, so we don't spam if they choose not to report
          localStorage.setItem(`report_reminder_${now.toLocaleDateString()}`, 'true');
        }
      }
    };
    const interval = setInterval(checkReportTime, 60000);
    checkReportTime(); // check immediately on mount
    return () => clearInterval(interval);
  }, [user, reports, pushLocalNotification]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    roleBasedTasks.forEach(task => task.tags?.forEach(tag => {
      if (tag && tag.trim()) tags.add(tag.trim());
    }));
    return Array.from(tags).sort();
  }, [roleBasedTasks]);

  const filteredTasks = useMemo(() => {
    let result = roleBasedTasks;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(t =>
        (t.title ?? '').toLowerCase().includes(q) ||
        (t.description ?? '').toLowerCase().includes(q) ||
        t.tags?.some(tag => (tag ?? '').toLowerCase().includes(q))
      );
    }
    if (selectedTags.length > 0) {
      result = result.filter(t => t.tags && t.tags.some(tag => selectedTags.includes(tag)));
    }
    return result;
  }, [roleBasedTasks, searchQuery, selectedTags]);

  const filteredNotes = useMemo(() => {
    if (!searchQuery) return notes;
    const q = searchQuery.toLowerCase();
    return notes.filter(n =>
      (n.title ?? '').toLowerCase().includes(q) ||
      (n.content ?? '').toLowerCase().includes(q)
    );
  }, [notes, searchQuery]);

  const handleSaveTask = async (task: Task) => {
    const isNew = !tasks.find(t => t.id === task.id);
    if (!isNew && !checkPermission('edit', task, user!)) {
      setNotification({ visible: true, title: 'Error', message: 'No permission to edit this task.', type: 'warning' });
      return;
    }
    await saveTask(task);
  };

  const handleAddMultipleTasks = async (newTasks: Task[]) => {
    const existingIds = new Set(tasks.map(t => t.id));
    const tasksToAdd = newTasks.filter(t => !existingIds.has(t.id));
    for (const t of tasksToAdd) {
      await saveTask(t);
    }
    setNotification({ visible: true, title: 'Success', message: `Added ${tasksToAdd.length} tasks.`, type: 'info' });
  };

  const handleDeleteTask = (taskId: string) => {
    const taskToDelete = tasks.find(t => t.id === taskId);
    if (!taskToDelete) return;
    if (!checkPermission('delete', taskToDelete, user!)) {
      setNotification({ visible: true, title: t('permissionDenied') || 'Permission Denied', message: t('noPermissionDeleteTask') || 'No permission.', type: 'warning' });
      return;
    }
    setConfirmDialog({
      isOpen: true, title: t('confirmDelete'), message: t('confirmDeleteTask'), type: 'danger',
      onConfirm: async () => {
        await deleteTask(taskId);
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleStatusToggle = async (task: Task) => {
    const canEdit = checkPermission('edit', task, user!);
    const isAssignee = task.assignees.includes(user!.id);
    if (!canEdit && !isAssignee) {
      setNotification({ visible: true, title: 'Permission Denied', message: 'You cannot update this task status.', type: 'warning' });
      return;
    }
    const newStatus = task.status === TaskStatus.DONE ? TaskStatus.TODO : TaskStatus.DONE;
    const updatedTask = { ...task, status: newStatus };
    await saveTask(updatedTask);

    if (newStatus === TaskStatus.DONE && task.recurrence && task.recurrence !== RecurrenceType.NONE) {
      const nextDate = getNextDate(task.startDate, task.recurrence);
      const exists = tasks.some(t => t.title === task.title && t.startDate === nextDate && t.status === TaskStatus.TODO);
      if (!exists) {
        const newTask: Task = { ...task, id: Math.random().toString(36).substr(2, 9), startDate: nextDate, status: TaskStatus.TODO, subtasks: task.subtasks?.map(st => ({ ...st, isCompleted: false })), comments: [] };
        await saveTask(newTask);
      }
    }
  };

  const openCreateModal = (date?: string) => { setEditingTask(null); setSelectedDateForCreate(date || new Date().toISOString().split('T')[0]); setIsModalOpen(true); };
  const openEditModal = (task: Task) => { setEditingTask(task); setIsModalOpen(true); };
  const toggleTagFilter = (tag: string) => setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);

  const handleSaveNote = async (note: Note) => await saveNote({ ...note, userId: user!.id });
  const handleDeleteNote = async (noteId: string) => await deleteNote(noteId);
  const openCreateNoteModal = () => { setEditingNote(null); setIsNoteModalOpen(true); };
  const openEditNoteModal = (note: Note) => { setEditingNote(note); setIsNoteModalOpen(true); };

  const handleSaveUser = async (u: User) => await saveUser(u);
  const handleDeleteUser = (userId: string) => {
    if (userId === user?.id) { setNotification({ visible: true, title: t('error'), message: t('cannotDeleteSelf'), type: 'warning' }); return; }
    setConfirmDialog({ isOpen: true, title: t('confirmDelete'), message: t('confirmDeleteUser'), type: 'danger', onConfirm: async () => { await deleteUser(userId); setConfirmDialog(prev => ({ ...prev, isOpen: false })); }});
  };
  const openCreateUserModal = () => { setEditingUser(null); setIsUserModalOpen(true); };
  const openEditUserModal = (u: User) => { setEditingUser(u); setIsUserModalOpen(true); };

  if (isAuthLoading || isDataLoading) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#F8FAFC] relative overflow-hidden">
        {/* Ambient background */}
        <div className="absolute top-[-20%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-emerald-100/40 blur-[130px] pointer-events-none" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[45vw] h-[45vw] rounded-full bg-amber-100/30 blur-[120px] pointer-events-none" />

        {/* Brand Emblem + Spinner */}
        <div className="relative flex items-center justify-center mb-5">
          <div 
            className="absolute w-16 h-16 rounded-full border-[3px] border-transparent border-t-[#16A34A] border-r-emerald-300 animate-spin" 
            style={{ animationDuration: '0.9s' }} 
          />
          <div 
            className="absolute w-20 h-20 rounded-full border-2 border-transparent border-b-amber-400/50 border-l-amber-200/30 animate-spin" 
            style={{ animationDuration: '1.6s', animationDirection: 'reverse' }} 
          />
          <div className="w-12 h-12 rounded-xl bg-white shadow-md border border-[#E2E8F0] flex items-center justify-center p-2">
            <img src="/logo-square.png" alt="Tran Le Electricity" className="w-full h-full object-contain" />
          </div>
        </div>

        <h1 className="text-base font-bold text-[#0F172A] tracking-tight mb-1">Tran Le Tasks</h1>
        <p className="text-xs text-[#64748B] font-medium mb-4">Đang tải không gian làm việc...</p>

        <div className="flex items-center gap-1.5">
          {[0, 1, 2, 3].map(i => (
            <span 
              key={i} 
              className="w-1.5 h-1.5 rounded-full bg-[#16A34A] animate-bounce"
              style={{ animationDelay: `${i * 0.15}s`, animationDuration: '0.8s' }} 
            />
          ))}
        </div>
      </div>
    );
  }
  if (!user) {
    return (
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<LoginView />} />
      </Routes>
    );
  }

  return (
    <div className="flex h-screen bg-transparent text-gray-800 overflow-hidden font-sans selection:bg-brand-200">
      <Sidebar isMobileMenuOpen={isMobileMenuOpen} setIsMobileMenuOpen={setIsMobileMenuOpen} openCreateModal={openCreateModal} />

      <main className="flex-1 flex flex-col min-w-0 h-full relative lg:pl-80 transition-all duration-300">
        <TopHeader
          setIsMobileMenuOpen={setIsMobileMenuOpen}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          notification={notification}
          setNotification={setNotification}
        />

        <div className="flex-1 overflow-y-auto p-4 lg:p-8 flex flex-col">
          <div className="w-full flex-1 space-y-8">
            <Routes>
              <Route path="/" element={
                 <DashboardPage
                  roleBasedTasks={roleBasedTasks} filteredTasks={filteredTasks} filteredNotes={filteredNotes}
                  notes={notes} users={users} user={user} reports={reports} contracts={contracts} searchQuery={searchQuery}
                  openCreateModal={openCreateModal} openEditModal={openEditModal}
                  handleStatusToggle={handleStatusToggle} handleDeleteTask={handleDeleteTask}
                  checkPermission={checkPermission}
                />
              } />
              
              <Route path="/tasks" element={
                <TasksPage 
                  t={t}
                  rawTodaysTasks={rawTodaysTasks}
                  filteredTasks={filteredTasks}
                  allTags={allTags}
                  selectedTags={selectedTags}
                  toggleTagFilter={toggleTagFilter}
                  setSelectedTags={setSelectedTags}
                  searchQuery={searchQuery}
                  openCreateModal={openCreateModal}
                  openEditModal={openEditModal}
                  handleStatusToggle={handleStatusToggle}
                  handleDeleteTask={handleDeleteTask}
                  checkPermission={checkPermission}
                  user={user}
                  users={users}
                  aiAssistantRef={aiAssistantRef}
                  setIsSuggestionModalOpen={setIsSuggestionModalOpen}
                  handleSaveTask={handleSaveTask}
                />
              } />

              <Route path="/calendar" element={
                <div className="h-[calc(100vh-8rem)]">
                  <CalendarPage tasks={roleBasedTasks} contracts={contracts} onDateClick={(date) => openCreateModal(date)} onTaskClick={(task) => openEditModal(task)} />
                </div>
              } />

              <Route path="/mail" element={
                <div className="h-[calc(100vh-8rem)]">
                  <MailPage />
                </div>
              } />

              <Route path="/notes" element={
                <NotesPage 
                  t={t}
                  filteredNotes={filteredNotes}
                  openCreateNoteModal={openCreateNoteModal}
                  openEditNoteModal={openEditNoteModal}
                />
              } />

              <Route path="/team" element={
                <TeamPage 
                  t={t}
                  user={user}
                  users={users}
                  openCreateUserModal={openCreateUserModal}
                  openEditUserModal={openEditUserModal}
                  handleDeleteUser={handleDeleteUser}
                />
              } />

              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/project-reports" element={<ProjectReportsPage />} />
              <Route path="/contracts" element={<ContractsPage />} />
              <Route path="/products" element={<ProductsPage />} />
              <Route path="/dept/:key" element={<DepartmentStubPage />} />
              <Route path="/revenue" element={<RevenuePage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/documents" element={<DocumentsPage />} />

              <Route path="/meetings" element={<React.Suspense fallback={<div className="p-8 text-center">Loading Meetings...</div>}><MeetingsPage allUsers={users} onJoinMeeting={setActiveMeeting} onCreateMeeting={() => setIsMeetingModalOpen(true)} /></React.Suspense>} />
              <Route path="/meetings/join/:meetingId" element={<React.Suspense fallback={<div className="p-8 text-center">Loading Meeting Room...</div>}><JoinMeetingPage onJoinMeeting={setActiveMeeting} /></React.Suspense>} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/forgot-password" element={<Navigate to="/" replace />} />
              <Route path="/reset-password" element={<Navigate to="/" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </div>
      </main>

      <AIAssistant ref={aiAssistantRef} />
      <TaskModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveTask} initialTask={editingTask} initialDate={selectedDateForCreate} user={user} readOnly={editingTask ? !checkPermission('edit', editingTask, user!) : false} allUsers={users} />
      <TaskSuggestionModal isOpen={isSuggestionModalOpen} onClose={() => setIsSuggestionModalOpen(false)} onAddTasks={handleAddMultipleTasks} currentUser={user} />
      <NoteModal isOpen={isNoteModalOpen} onClose={() => setIsNoteModalOpen(false)} onSave={handleSaveNote} onDelete={handleDeleteNote} initialNote={editingNote} />
      <UserModal isOpen={isUserModalOpen} onClose={() => setIsUserModalOpen(false)} onSave={handleSaveUser} initialUser={editingUser} />
      <InviteModal isOpen={isInviteModalOpen} onClose={() => setIsInviteModalOpen(false)} />
      <React.Suspense fallback={null}>
        {activeMeeting && <MeetingRoom meeting={activeMeeting} onLeave={() => setActiveMeeting(null)} allUsers={users} />}
      </React.Suspense>
      <React.Suspense fallback={null}>
        <MeetingModal isOpen={isMeetingModalOpen} onClose={() => setIsMeetingModalOpen(false)} allUsers={users} />
      </React.Suspense>
      <ConfirmDialog isOpen={confirmDialog.isOpen} title={confirmDialog.title} message={confirmDialog.message} onConfirm={confirmDialog.onConfirm} onCancel={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))} type={confirmDialog.type} confirmText={t('delete')} cancelText={t('cancel')} />
    </div>
  );
}
