/**
 * API Request/Response Types
 */

// ─── Common Response Types ───────────────────────────────────────────────────

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface ApiError {
  error: string;
  details?: any;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface SuccessResponse {
  success: boolean;
  message?: string;
}

export interface IdResponse {
  id: string;
}

// ─── Auth Types ──────────────────────────────────────────────────────────────

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    department: string;
    permissions: string[];
  };
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  role: string;
  department: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

// ─── Task Types ──────────────────────────────────────────────────────────────

export interface CreateTaskRequest {
  title: string;
  description?: string;
  startDate?: string;
  dueDate?: string;
  priority?: string;
  status?: string;
  assignees?: string[];
  tags?: string[];
  department?: string;
  contractId?: string;
  projectId?: string;
}

export interface UpdateTaskRequest extends Partial<CreateTaskRequest> {
  id: string;
}

// ─── Contract Types ──────────────────────────────────────────────────────────

export interface CreateContractRequest {
  contractNumber: string;
  clientName: string;
  contractName: string;
  preTaxValue?: number;
  department: string;
  contractType?: string;
  status?: string;
}

export interface UpdateContractRequest extends Partial<CreateContractRequest> {
  id: string;
}

// ─── Project Types ───────────────────────────────────────────────────────────

export interface CreateProjectRequest {
  projectCode: string;
  name: string;
  clientName?: string;
  department?: string;
  managerId?: string;
  budget?: number;
}

export interface UpdateProjectRequest extends Partial<CreateProjectRequest> {
  id: string;
}

// ─── Report Types ────────────────────────────────────────────────────────────

export interface CreateReportRequest {
  title: string;
  content?: string;
  department: string;
}

export interface UpdateReportRequest extends Partial<CreateReportRequest> {
  id: string;
  status?: string;
  managerFeedback?: string;
  directorFeedback?: string;
}

// ─── Revenue Report Types ────────────────────────────────────────────────────

export interface CreateRevenueReportRequest {
  title: string;
  reportType: string;
  periodStart: string;
  periodEnd: string;
  department: string;
  content?: string;
}

export interface UpdateRevenueReportRequest extends Partial<CreateRevenueReportRequest> {
  id: string;
  status?: string;
}

// ─── Note Types ──────────────────────────────────────────────────────────────

export interface CreateNoteRequest {
  title: string;
  content?: string;
  color?: string;
  reminderAt?: string;
}

export interface UpdateNoteRequest extends Partial<CreateNoteRequest> {
  id: string;
}

// ─── User Types ──────────────────────────────────────────────────────────────

export interface CreateUserRequest {
  name: string;
  email: string;
  password: string;
  role: string;
  department: string;
  phone?: string;
  jobTitle?: string;
}

export interface UpdateUserRequest {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  department?: string;
  phone?: string;
  dob?: string;
  hometown?: string;
  bio?: string;
  cccd?: string;
  gender?: string;
  jobTitle?: string;
  avatar?: string;
}

// ─── Meeting Types ───────────────────────────────────────────────────────────

export interface CreateMeetingRequest {
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  participants?: string[];
}

export interface UpdateMeetingRequest extends Partial<CreateMeetingRequest> {
  id: string;
  status?: string;
}

// ─── Product Types ───────────────────────────────────────────────────────────

export interface CreateProductRequest {
  name: string;
  unit?: string;
  origin?: string;
  defaultPrice?: number;
  category?: string;
  importQuantity?: number;
  importPrice?: number;
  salePrice?: number;
  importCode?: string;
}

export interface UpdateProductRequest extends Partial<CreateProductRequest> {
  id: string;
  remainingQuantity?: number;
}

// ─── AI Types ────────────────────────────────────────────────────────────────

export interface AIChatRequest {
  message: string;
  context?: string;
}

export interface AIChatResponse {
  response: string;
  model: string;
}

export interface AITaskSuggestionRequest {
  description: string;
  department?: string;
}

export interface AITaskSuggestionResponse {
  suggestions: Array<{
    title: string;
    description: string;
    priority: string;
    estimatedDuration: string;
  }>;
}

// ─── Mail Types ──────────────────────────────────────────────────────────────

export interface SendMailRequest {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  attachments?: Array<{
    filename: string;
    path: string;
  }>;
}

export interface ScheduleMailRequest extends SendMailRequest {
  scheduledAt: string;
}

// ─── Upload Types ────────────────────────────────────────────────────────────

export interface UploadResponse {
  filename: string;
  originalName: string;
  size: number;
  mimeType: string;
  url: string;
}

// ─── Validation Error ────────────────────────────────────────────────────────

export interface ValidationError {
  error: string;
  details: Array<{
    field: string;
    message: string;
  }>;
}
