/**
 * Database interface - Type-safe wrapper for MySQL operations
 */

export interface QueryResult {
  changes: number;
  lastInsertRowid?: number | string;
}

export interface Database {
  get<T = any>(sql: string, params?: any[]): Promise<T | undefined>;
  all<T = any>(sql: string, params?: any[]): Promise<T[]>;
  run(sql: string, params?: any[]): Promise<QueryResult>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

// ─── Domain Types ────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string;
  password: string;
  role: string;
  department: string;
  avatar: string;
  mailPassword?: string;
  isLocked: number;
  tokenVersion: number;
  phone?: string;
  dob?: string;
  hometown?: string;
  bio?: string;
  cccd?: string;
  gender?: string;
  jobTitle?: string;
  preferences?: string;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  startDate?: string;
  dueDate?: string;
  estimatedEndAt?: string;
  priority?: string;
  status?: string;
  createdBy?: string;
  department?: string;
  recurrence?: string;
  contractId?: string;
  projectId?: string;
}

export interface Contract {
  id: string;
  contractNumber: string;
  clientName: string;
  contractName: string;
  preTaxValue?: number;
  invoiceDate?: string;
  invoiceNumber?: string;
  department: string;
  createdBy: string;
  docSentDate?: string;
  docReceivedDate?: string;
  docAccountantDate?: string;
  docReceiver?: string;
  docAccountantUserId?: string;
  docAccountantStatus?: string;
  approvalFeedback?: string;
  createdAt: string;
  updatedAt?: string;
  isDeleted?: number;
  status?: string;
  attachments?: string;
  products?: string;
  vatRate?: number;
  postTaxValue?: number;
  paidAmount?: number;
  projectId?: string;
  contractType?: string;
  supplierName?: string;
  documentChecklist?: string;
  signedDate?: string;
  startDate?: string;
  endDate?: string;
  warrantyMonths?: number;
  payments?: string;
}

export interface Project {
  id: string;
  projectCode: string;
  name: string;
  clientName?: string;
  department?: string;
  managerId?: string;
  status?: string;
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
  createdAt: string;
  updatedAt?: string;
  isDeleted?: number;
  priority?: string;
  phase?: string;
}

export interface Report {
  id: string;
  title: string;
  content?: string;
  authorId: string;
  department: string;
  status: string;
  createdAt: string;
  submittedAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  directorFeedback?: string;
  managerFeedback?: string;
  deletedAt?: string;
  isDeleted?: number;
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
  generationMode?: string;
}

export interface Note {
  id: string;
  title: string;
  content?: string;
  color?: string;
  createdAt?: string;
  reminderAt?: string;
  userId?: string;
}

export interface Role {
  id: string;
  name: string;
  description?: string;
  color: string;
  permissions: string;
  isSystem: number;
}

export interface Department {
  id: string;
  name: string;
  description?: string;
  color: string;
  managerId?: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  relatedId?: string;
  dedupeKey?: string;
  isRead: number;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  userId: string;
  action: string;
  entityId?: string;
  entityType?: string;
  metadata?: string;
  createdAt: string;
}
