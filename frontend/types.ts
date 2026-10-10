
export enum TaskStatus {
  TODO = 'Todo',
  IN_PROGRESS = 'In Progress',
  DONE = 'Done',
}

export enum TaskPriority {
  LOW = 'Low',
  MEDIUM = 'Medium',
  HIGH = 'High',
}

export enum RecurrenceType {
  NONE = 'None',
  DAILY = 'Daily',
  WEEKLY = 'Weekly',
  MONTHLY = 'Monthly',
}

export interface Subtask {
  id: string;
  title: string;
  isCompleted: boolean;
}

export interface Comment {
  id: string;
  userId: string;
  content: string;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  startDate: string;
  dueDate?: string;
  estimatedEndAt?: string;
  priority: TaskPriority;
  status: TaskStatus;
  assignees: string[];
  tags?: string[];
  createdBy: string;
  department: string;
  recurrence?: RecurrenceType;
  subtasks?: Subtask[];
  comments?: Comment[];
  contractId?: string;
  projectId?: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  color: string;
  createdAt: string;
  reminderAt?: string; // ISO datetime string, optional
  userId?: string;     // owner – private notes
}

// Core roles are the 4 built-in system roles.
// The type is kept open (| string) to support custom roles created via Admin panel.
export type UserRole = 'Admin' | 'Director' | 'Manager' | 'Employee' | (string & {});

export type ReportStatus = 'Draft' | 'Pending' | 'Approved' | 'Rejected';

export interface Report {
  id: string;
  title: string;
  content: string;
  authorId: string;
  department: string;
  status: ReportStatus;
  createdAt: string;
  submittedAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  directorFeedback?: string;
  managerFeedback?: string;
  isDeleted?: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  password?: string;
  role: UserRole;
  jobTitle?: string | null;
  department: string;
  primaryDepartmentId?: string;
  managementLevel?: number;
  managedDepartments?: string[];
  avatar: string;
  bio?: string;
  phone?: string;
  dob?: string;
  hometown?: string;
  cccd?: string;
  gender?: string;
  joinDate?: string;
  permissions?: string[];
  isLocked?: boolean;
  preferences?: {
    reportNotifs?: boolean;
    taskNotifs?: boolean;
    meetingNotifs?: boolean;
    emailNotifs?: boolean;
    language?: 'vi' | 'en';
    theme?: 'light' | 'dark' | 'system';
  };
}

export type MeetingStatus = 'scheduled' | 'ongoing' | 'completed' | 'cancelled';

export interface Meeting {
  id: string;
  title: string;
  description: string;
  hostId: string;
  startTime: string;
  endTime: string;
  meetingLink: string;
  status: MeetingStatus;
  participants: string[];
}

export interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
}

export interface Role {
  id: string;
  name: string;
  description?: string;
  color: string;
  permissions: string[];
  isSystem: number;
}

export interface Department {
  id: string;
  name: string;
  code?: string;
  description?: string;
  color: string;
  managerId?: string;
}

export interface PasswordResetRequest {
  id: string;
  userId: string;
  email: string;
  status: 'pending' | 'resolved';
  createdAt: string;
}

export interface Contract {
  id: string;
  contractNumber: string;
  clientName: string;
  contractName: string;
  preTaxValue?: number;
  postTaxValue?: number;
  invoiceDate?: string;
  invoiceNumber?: string;
  department: string;
  status?: string;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
  isDeleted?: number;
  projectId?: string;
  products?: any[];
  vatRate?: number;
  attachments?: string[];
  paidAmount?: number;
  contractType?: 'output' | 'input';
  supplierName?: string;
  documentChecklist?: any;
  signedDate?: string;
  startDate?: string;
  endDate?: string;
  warrantyMonths?: number;
  payments?: any[];
  docSentDate?: string;
  docReceivedDate?: string;
  docAccountantDate?: string;
  docReceiver?: string;
  docAccountantUserId?: string;
  docAccountantStatus?: string;
  approvalFeedback?: string;
}

export interface RevenueReport {
  id: string;
  title: string;
  reportType: string;
  periodStart: string;
  periodEnd: string;
  content?: string;
  totalPreTax?: number;
  totalDelivered?: number;
  totalCumulative?: number;
  authorId: string;
  department: string;
  status: string;
  approvedBy?: string;
  approvedAt?: string;
  managerFeedback?: string;
  directorFeedback?: string;
  createdAt: string;
  submittedAt?: string;
  isDeleted?: number;
}

export type ProjectPriority = 'low' | 'medium' | 'high' | 'critical';
export type ProjectPhase = 'initiation' | 'planning' | 'execution' | 'monitoring' | 'closure';

export interface Project {
  id: string;
  projectCode: string;
  name: string;
  clientName?: string;
  department?: string;
  managerId?: string;
  status: string;
  startDate?: string;
  endDate?: string;
  budget?: number;
  description?: string;
  biddingCode?: string;
  biddingDate?: string;
  procurementMethod?: string;
  investor?: string;
  biddingPrice?: number;
  winningPrice?: number;
  priority?: ProjectPriority;
  phase?: ProjectPhase;
  createdAt: string;
  updatedAt?: string;
  isDeleted?: number;
}

export interface ProjectMilestone {
  id: string;
  projectId: string;
  title: string;
  dueDate?: string;
  completedAt?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'overdue';
  sortOrder: number;
  createdAt: string;
}

export interface ProjectReport {
  id: string;
  projectId: string;
  title: string;
  content?: string;
  progress?: number;
  authorId: string;
  status: string;
  createdAt: string;
}

export interface Client {
  id: string;
  name: string;
  region?: string;
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  unit?: string;
  origin?: string;
  defaultPrice?: number;
  createdAt: string;
}
