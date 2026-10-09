# DATA DICTIONARY TOÀN HỆ THỐNG

> Kiểu dữ liệu đề xuất theo MySQL 8. ORM có thể khác, nhưng ý nghĩa nghiệp vụ và rule phải giữ thống nhất.

## 1. Quy ước
- PK: `id BIGINT UNSIGNED AUTO_INCREMENT`; bảng nghiệp vụ có thêm `code` (hiển thị, UNIQUE); bảng migrate có `legacy_id VARCHAR(64) NULL UNIQUE` (ADR-001).
- Tên bảng/cột mới: snake_case; enum UPPER_SNAKE; JSON của API camelCase (ADR-002).
- Money chứng từ: `DECIMAL(18,2)`; đơn giá/giá vốn/tỷ giá: `DECIMAL(18,4)`; số lượng: `DECIMAL(18,3)` (ADR-007). Chứng từ có tiền phải có `currency` (mặc định VND).
- Datetime lưu UTC.
- Audit: `created_by`, `created_at`, `updated_by`, `updated_at` ở mọi bảng nghiệp vụ (không lặp lại ở từng bảng bên dưới).
- Soft delete: `deleted_at`, `deleted_by` cho danh mục và dữ liệu chưa duyệt; **không** áp dụng cho sổ cái/chứng từ đã duyệt (ADR-003).
- Khóa ngoại trỏ tới bảng **cũ** đang chạy (`users`, `tasks`, `projects`, `contracts`, ...) dùng đúng kiểu khóa hiện có của bảng đó (VARCHAR) cho đến khi bảng cũ được tái tạo; các cột `*_id` trong tài liệu này viết chung và được hiện thực theo quy tắc ở `32_MIGRATION_PLAN.md` §5.
- Phần 1 (mục 2-11) là bản gốc đã sửa; Phần 2 (mục 12 trở đi) định nghĩa mọi bảng còn lại. File 15 là chỉ mục sinh từ file này.

## 2. Core
### users
- id BIGINT PK
- email VARCHAR(255) UNIQUE NOT NULL
- password_hash VARCHAR(255) NOT NULL
- status VARCHAR(30)
- last_login_at DATETIME

### employees
- id
- employee_code UNIQUE
- user_id UNIQUE nullable
- full_name
- department_id
- position_id
- direct_manager_id nullable
- join_date
- status
(cấp quản lý lấy từ `positions.management_level`, không lưu ở đây – ADR-010)

### departments
- id
- code UNIQUE
- name UNIQUE
- parent_id nullable
- path VARCHAR(255) (đường dẫn vật chất hóa phục vụ scope phòng con – ADR-011)
- manager_id nullable (phải là nhân viên level >= 20 của phòng)
- exclude_children_scope TINYINT default 0
- active

## 3. CRM
### customers
- id
- code UNIQUE
- type COMPANY/INDIVIDUAL
- customer_class END_CUSTOMER/DEALER/DISTRIBUTOR/PARTNER
- name
- tax_code
- phone
- email
- address
- owner_id
- status

### contacts
- id
- customer_id
- full_name
- title
- phone
- email
- is_primary

### leads
- id
- code UNIQUE
- name
- company_name
- phone
- email
- lead_source (lookup LEAD_SOURCE)
- campaign_id nullable
- owner_id
- stage_owner MARKETING/SALES
- handoff_at nullable
- status NEW/CONTACTED/CONVERTED/CLOSED (vòng đời)
- qualification_status UNQUALIFIED/QUALIFIED/DISQUALIFIED
- disqualified_reason
- expected_value DECIMAL(18,2)
- next_action_at
- converted_customer_id
- converted_opportunity_id

### opportunities
- id
- code UNIQUE
- customer_id
- owner_id
- stage
- value DECIMAL(18,2)
- probability DECIMAL(5,2)
- expected_close_date
- lost_reason
- source_lead_id

### quotes
Header:
- id, code, opportunity_id, customer_id, owner_id
- version_no, status, valid_from, valid_to
- subtotal, discount_amount, tax_amount, total
- currency

quote_lines:
- quote_id
- product_id
- description
- qty
- uom_id
- unit_price
- discount_percent
- tax_rate
- line_total

### contracts
- id, code, direction OUTBOUND/INBOUND (ADR-014)
- customer_id nullable, supplier_id nullable (đúng một trong hai có giá trị)
- opportunity_id, quote_id
- owner_id, status
- project_split_mode SINGLE/PER_SITE/MANUAL
- signed_date, effective_date, end_date
- subtotal, tax_amount, total_value
- warranty_months, currency

contract_payments:
- contract_id
- name
- percentage
- amount
- due_condition
- due_date
- paid_amount
- status

## 4. Project / Work
### projects
- id, code UNIQUE, name
- customer_id, contract_id
- project_manager_id, sales_owner_id, technical_owner_id
- department_id
- start_date, planned_end_date, actual_end_date
- status, progress
- contract_value
- site_address, project_type, risk_level

### tasks
- id
- project_id nullable
- epic_id nullable
- parent_task_id nullable
- title, description
- type, priority, status
- department_id
- reporter_id, assignee_id
- start_date, due_date, completed_at
- progress
- related_type, related_id

## 5. Technical / Service
### technical_requests
- id, code, source_type, source_id
- customer_id, requester_id, assignee_id
- request_type, site_address, requirement
- priority, requested_date, due_date, status

### surveys
- id, technical_request_id, survey_date, surveyor_id
- site_address
- current_state TEXT
- constraints TEXT
- risks TEXT
- preliminary_solution TEXT
- status

### boms
- id, code, source_type, source_id
- version_no, status, created_by, reviewed_by

### bom_lines
- bom_id, product_id, description
- qty, uom_id, waste_percent
- alternative_product_id, note

### tickets
- id, code, customer_id, contact_id
- contract_id, project_id, asset_id
- type, category, priority
- description, assignee_id, status
- sla_due_at, root_cause, resolution, closed_at

### customer_assets
- id, code, customer_id, contract_id, project_id
- product_id, serial_no, model
- installed_at, location
- warranty_start, warranty_end
- status, manufacturer, supplier_id

## 6. Purchasing
### purchase_requests
- id, code, requester_id, department_id, project_id
- reason, required_date, priority
- estimated_amount DECIMAL(18,2)
- status

### purchase_orders
- id, code, supplier_id, purchase_request_id
- status, order_date, expected_delivery_date
- subtotal, tax_amount, total, currency

## 7. Inventory
### warehouses
- id, code, name, region, address, manager_id

### locations
- id, warehouse_id, parent_id, code, name, type

### stock_moves
- id, document_id nullable (tham chiếu stock_documents – ADR-013)
- move_type NORMAL/COST_ADJUSTMENT
- product_id, lot_id nullable, serial_id nullable
- from_location_id, to_location_id
- qty DECIMAL(18,3)
- unit_cost DECIMAL(18,4)
- reference_type, reference_id
- done_at, created_by

`DONE` stock move bất biến.

## 8. Finance
### receivables
- id, customer_id, contract_id, payment_milestone_id
- expected_amount, official_amount
- due_date, paid_amount, outstanding_amount
- payment_status UPCOMING/DUE/PARTIAL/PAID
- (quá hạn là giá trị dẫn xuất: due_date < hôm nay và outstanding_amount > 0 – ADR-015)
- misa_reference

### payment_requests
- id, code, requester_id, department_id
- beneficiary, project_id, purpose
- amount DECIMAL(18,2)
- requested_date, paid_at, payment_reference
- status DRAFT/PENDING_APPROVAL/APPROVED/PAID/REJECTED/CANCELLED (chuỗi duyệt ở `approvals` – ADR-009)

## 9. Workflow
### workflows
- id, key, name, status

### workflow_versions
- id, workflow_id, version, definition_json, published_at

### workflow_runs
- id, workflow_version_id
- subject_type, subject_id
- state, started_by, started_at, finished_at

### approvals
- id, run_id, step_key, level (level1/level2/level3), sequence_no, approver_id
- state PENDING/APPROVED/REJECTED/SKIPPED, comment, decided_at, policy_id

## 10. Dashboard
### dashboard_templates
- id, name, department_id nullable
- management_level, is_default

### dashboard_widgets
- id, template_id, widget_type, entity
- filter_json, aggregation, group_by
- position_json, config_json

## 11. Integration
### integration_mappings
- id, integration_id, entity_type
- local_id, remote_id, remote_code
- sync_direction, status, last_synced_at

---

# PHẦN 2 – CÁC BẢNG BỔ SUNG (V8)

> Bảng trong phần này đã được liệt kê ở `15_DATA_MODEL_DE_XUAT.md` nhưng chưa có định nghĩa ở v7, hoặc là thực thể mới từ `39_QUYET_DINH_NEN.md` và `40_BO_SUNG_NGHIEP_VU.md`. Kiểu dữ liệu theo mục 1 (Quy ước). Mọi trường là **đề xuất thiết kế**; giá trị nghiệp vụ (ngưỡng, danh mục) do phòng liên quan xác nhận.

## 12. Core bổ sung
### positions
- id, code UNIQUE, name
- management_level INT (10/20/30/40) – nguồn sự thật của cấp quản lý
- department_id nullable, active

### roles
- id, code UNIQUE, name, is_system_role, description

### permissions
- id, code UNIQUE (`resource.action[.scope]`), resource, action, scope nullable, description

### user_roles
- user_id, role_id, valid_from, valid_to, granted_by

### role_permissions
- role_id, permission_id

### management_scopes
- id, employee_id, scope_type MANAGED_DEPARTMENTS/EXPLICIT
- department_id, valid_from, valid_to, granted_by, reason

### approval_policies
- id, process_key, department_id nullable, level, sequence_no
- condition_json, approver_role, approver_scope
- active, valid_from, valid_to

### audit_logs (chỉ thêm, không sửa, không xóa)
- id, request_id, actor_id, action
- entity_type, entity_id, before_json, after_json
- ip_address, user_agent, created_at

### notifications
- id, user_id, event_key, entity_type, entity_id
- title, body, channel IN_APP/EMAIL, read_at, created_at

### lookups
- id, lookup_type, code, label, sort_order, active, config_json
- UNIQUE(lookup_type, code)
- Dùng cho: LEAD_SOURCE, LOST_REASON, DISQUALIFIED_REASON, CAMPAIGN_CHANNEL, TICKET_CATEGORY, COST_CATEGORY, REVENUE_CATEGORY...

### custom_fields
- id, entity, field_key, label, data_type, options_json
- required, sort_order, active, permission_key nullable
- UNIQUE(entity, field_key). Giá trị lưu ở cột `custom_json` của bảng thực thể.

### business_calendars
- id, name, timezone, work_days_json, work_hours_json, active

### business_holidays
- calendar_id, holiday_date, name

### sla_policies
- id, process_key, priority
- response_minutes, resolve_minutes
- calendar_id, pause_statuses_json, active

### saved_views
- id, owner_id, entity, name
- filter_json, columns_json, sort_json
- visibility PRIVATE/DEPARTMENT/COMPANY, is_default

### outbox_events (ADR-006)
- id, event_key, aggregate_type, aggregate_id, payload_json
- created_at, processed_at nullable, attempts, last_error

### jobs (ADR-006)
- id, job_type, payload_json
- status PENDING/RUNNING/DONE/FAILED
- run_at, attempts, max_attempts
- locked_by, locked_until, last_error, created_at

## 13. Work / Project bổ sung
### epics
- id, code, project_id, title, description
- status, owner_id, start_date, due_date

### entity_relations (thay cho `task_relations` ở v7)
- id, source_type, source_id, target_type, target_id
- relation_type BLOCKS/RELATES/DUPLICATES/PARENT_OF/CAUSED_BY
- created_by

### comments
- id, entity_type, entity_id, author_id
- body, parent_id nullable, mentions_json, edited_at

### milestones
- id, project_id, name
- planned_date, actual_date, status
- payment_milestone_id nullable

### project_issues
- id, code, project_id, title
- severity, status, owner_id, due_date, resolution

### project_risks
- id, project_id, title
- probability, impact, mitigation
- owner_id, status

### material_requests
- id, code, project_id, requested_by
- needed_date, status

### material_request_lines
- id, request_id, product_id, qty DECIMAL(18,3), uom_id
- availability_status AVAILABLE/TO_PURCHASE/PARTIAL
- reserved_qty

### acceptances
- id, code, project_id, milestone_id nullable
- acceptance_type, status, accepted_at
- customer_signer, document_id

### handovers
- id, code, project_id, status
- handed_over_at, receiver_name, checklist_json, document_id
- Hoàn tất handover tạo `customer_assets` (xem 23, 34).

### site_diaries
- id, project_id, diary_date, weather
- workforce_json, progress_note, issues_note

### project_cost_entries (xem `40` §5)
- id, project_id
- cost_type MATERIAL/SUBCONTRACT/LABOR/EQUIPMENT/OTHER
- source_type, source_id
- amount DECIMAL(18,2), currency, incurred_at
- status COMMITTED/ACTUAL

## 14. CRM bổ sung
### sales_orders
- id, code, customer_id, quote_id nullable, owner_id
- order_type PROJECT/DISTRIBUTION
- status DRAFT/PENDING_APPROVAL(tùy chọn)/APPROVED/WAITING_STOCK/READY/DELIVERED/COMPLETED/CANCELLED
- price_list_id nullable
- subtotal, discount_amount, tax_amount, total, currency
- credit_check_status OK/EXCEEDED/EXCEPTION_APPROVED
- delivery_date

### sales_order_lines
- id, order_id, product_id, qty DECIMAL(18,3), uom_id
- unit_price DECIMAL(18,4), discount_percent, tax_rate, line_total

### activities
- id, entity_type, entity_id
- activity_type CALL/MEETING/EMAIL/VISIT/NOTE
- subject, outcome, due_at, done_at, owner_id

### dealer_profiles
- id, customer_id UNIQUE, tier, region
- credit_limit DECIMAL(18,2), payment_terms_days
- agreement_contract_id nullable
- status, valid_from, valid_to

### price_lists
- id, code, name, tier nullable, currency
- valid_from, valid_to, status

### price_list_items
- id, price_list_id, product_id
- min_qty DECIMAL(18,3), unit_price DECIMAL(18,4)

### discount_policies
- id, name, applies_to_tier, product_category_id nullable
- condition_json, discount_json
- valid_from, valid_to, status

### vendor_targets
- id, vendor_name (hoặc lookup brand), period_start, period_end
- target_amount, currency, owner_department_id

### partner_links (ADR-018)
- id, customer_id, supplier_id, link_type SAME_LEGAL_ENTITY/RELATED
- UNIQUE(customer_id, supplier_id)

### campaigns
- id, code, name, objective, channel
- start_date, end_date, budget DECIMAL(18,2)
- owner_id, target_audience, status DRAFT/PLANNED/ACTIVE/PAUSED/COMPLETED

### campaign_spend
- id, campaign_id, channel, amount DECIMAL(18,2), spent_at, note

### content_plans
- id, campaign_id, topic, content_type, channel
- owner_id, planned_publish_at, status
- Công việc thực hiện nội dung dùng `tasks` (loại CONTENT).

### contract_links (ADR-014)
- id, outbound_contract_id, inbound_contract_id, note

### contract_amendments
- id, contract_id, amendment_no
- amendment_type VALUE/SCOPE/SCHEDULE/OTHER
- effective_date, value_delta DECIMAL(18,2)
- status, document_id

### contract_accounting_handoffs
- id, contract_id
- sent_at, sent_by, received_at, received_by
- accountant_id, status, feedback

## 15. Technical / Service bổ sung
### drawings
- id, code, technical_request_id nullable, project_id nullable
- title, version_no, status, document_id

### ticket_events
- id, ticket_id, actor_id
- event_type STATUS_CHANGE/COMMENT/ASSIGN/SLA_PAUSE/SLA_RESUME
- from_status, to_status, note, created_at

### warranties
- id, asset_id
- coverage_type MANUFACTURER/CONTRACT/EXTENDED
- start_date, end_date, terms
- source_contract_id nullable, lot_certificate_id nullable

### maintenance_plans
- id, asset_id nullable, project_id nullable, name
- frequency_json, next_due_at
- checklist_template_id nullable, assignee_id, status

### asset_replacements
- id, ticket_id, asset_id
- old_serial_id, new_serial_id, stock_document_id nullable
- reason, rma_reference

### compliance_items (xem `40` §3)
- id, item_type PARTNER_CERT/LICENSE/CALIBRATION/PERSONNEL_CERT/OTHER
- name, owner_department_id, responsible_employee_id
- issuer, reference_no, issued_at, expires_at
- remind_days_before_json, document_id
- related_type, related_id
- (trạng thái VALID/EXPIRING/EXPIRED dẫn xuất từ `expires_at`; `status` chỉ lưu RENEWING/ARCHIVED)

## 16. Purchasing bổ sung
### suppliers
- id, code UNIQUE, name, tax_code
- phone, email, address
- payment_terms_days, owner_id, status
- (thông tin tài khoản ngân hàng: bảng riêng hoặc mã hóa, quyền xem riêng)

### purchase_request_lines
- id, request_id, product_id nullable, description
- qty DECIMAL(18,3), uom_id, estimated_price DECIMAL(18,4)
- needed_date, project_id nullable

### rfqs
- id, code, purchase_request_id, status, due_date

### rfq_suppliers
- rfq_id, supplier_id, sent_at, response_status

### supplier_quotes
- id, rfq_id, supplier_id, status, valid_to
- total, currency, is_selected

### supplier_quote_lines
- id, supplier_quote_id, product_id, qty, unit_price DECIMAL(18,4), lead_time_days

### purchase_order_lines
- id, purchase_order_id, product_id
- qty DECIMAL(18,3), uom_id, unit_price DECIMAL(18,4), tax_rate
- received_qty, project_id nullable

### supplier_evaluations
- id, supplier_id, purchase_order_id nullable, period
- delivery_score, quality_score, price_score
- evaluator_id, note

## 17. Inventory bổ sung
### product_categories
- id, code, name, parent_id nullable

### uoms
- id, code, name, group_code

### products
- id, sku UNIQUE, name, category_id, base_uom_id
- brand (lookup), origin
- tracking NONE/LOT/SERIAL
- has_expiry, requires_certificates
- costing_method AVG/FIFO
- default_sale_price DECIMAL(18,4), active

### lots
- id, product_id, lot_no, receipt_line_id nullable
- manufactured_at, expiry_date
- UNIQUE(product_id, lot_no)

### serials
- id, product_id, serial_no, lot_id nullable
- status IN_STOCK/RESERVED/SHIPPED/INSTALLED/RETURNED/SCRAPPED
- current_location_id, asset_id nullable
- UNIQUE(product_id, serial_no)

### stock_documents (ADR-013)
- id, code
- doc_type RECEIPT/ISSUE/TRANSFER/RETURN/ADJUSTMENT
- status (theo doc_type, xem 23)
- from_location_id, to_location_id
- partner_type, partner_id
- reference_type, reference_id, project_id nullable
- planned_at, done_at

### stock_document_lines
- id, document_id, product_id, lot_id nullable, serial_id nullable
- uom_id, qty_planned DECIMAL(18,3), qty_done DECIMAL(18,3)
- unit_cost DECIMAL(18,4)

### stock_balances (bảng chiếu, cập nhật cùng transaction với stock_moves)
- product_id, location_id, lot_id NOT NULL DEFAULT 0
- qty_on_hand DECIMAL(18,3), qty_reserved DECIMAL(18,3)
- PRIMARY KEY (product_id, location_id, lot_id)

### stock_reservations
- id, product_id, location_id, lot_id nullable
- qty DECIMAL(18,3), reference_type, reference_id
- status ACTIVE/RELEASED/CONSUMED, expires_at

### stock_counts
- id, code, location_id
- status DRAFT/COUNTING/REVIEW/APPROVED/ADJUSTED/CLOSED/CANCELLED
- counted_at, approved_by

### stock_count_lines
- id, count_id, product_id, lot_id nullable
- system_qty, counted_qty, diff_qty, reason

### landed_costs (xem `40` §2)
- id, document_id (phiếu RECEIPT)
- cost_type CUSTOMS/FREIGHT/INSURANCE/OTHER
- amount, currency, allocation_method BY_VALUE/BY_QTY/BY_WEIGHT
- invoice_ref, status

### landed_cost_allocations
- id, landed_cost_id, document_line_id, allocated_amount

### lot_certificates (xem `40` §2)
- id, lot_id, cert_type CO/CQ/MANUFACTURER_WARRANTY/OTHER
- document_id, issued_at, expires_at, status

## 18. Finance bổ sung
### payables
- id, supplier_id, purchase_order_id nullable
- supplier_invoice_no, invoice_date, due_date
- amount, paid_amount, outstanding_amount
- payment_status UPCOMING/DUE/PARTIAL/PAID
- misa_reference

### payments (thay cho `collections` và `payments` rời ở v7)
- id, code, direction IN/OUT
- partner_type CUSTOMER/SUPPLIER/EMPLOYEE, partner_id
- amount, currency, method, paid_at, reference_no
- bank_account_id nullable, misa_reference

### payment_allocations
- id, payment_id
- receivable_id nullable, payable_id nullable (đúng một trong hai)
- amount

### advances
- id, code, employee_id, amount, purpose
- status DRAFT/PENDING_APPROVAL/APPROVED/DISBURSED/SETTLEMENT_PENDING/SETTLED/REJECTED/CANCELLED
- disbursed_at, settle_due_date

### settlements
- id, advance_id
- status DRAFT/PENDING_APPROVAL/APPROVED/POSTED/REJECTED
- total_spent, refund_or_topup_amount, settled_at

### settlement_lines
- id, settlement_id, expense_category, amount
- invoice_ref, document_id

### budgets
- id, fiscal_year, department_id nullable, project_id nullable
- category, planned_amount DECIMAL(18,2)
- control_mode BLOCK/WARN, status

## 19. HCNS bổ sung
### leave_requests
- id, code, employee_id, leave_type
- from_date, to_date, days, reason
- status DRAFT/PENDING_APPROVAL/APPROVED/REJECTED/CANCELLED

### leave_balances (sổ cái phép: chỉ thêm dòng)
- id, employee_id, leave_type
- delta DECIMAL(6,2), reason
- reference_type, reference_id, effective_date

### employee_lifecycles
- id, employee_id
- lifecycle_type ONBOARDING/OFFBOARDING
- status PLANNED/IN_PROGRESS/COMPLETED/CANCELLED
- effective_date, checklist_json

### asset_assignments
- id, employee_id, asset_category, asset_code, serial_no
- assigned_at, returned_at, status

## 20. Workflow bổ sung
### workflow_run_steps (thay cho `workflow_steps` ở v7)
- id, run_id, step_key, step_type
- state PENDING/RUNNING/DONE/FAILED/SKIPPED
- started_at, finished_at, attempts, last_error

## 21. Documents và template
### documents
- id, code, title, category
- storage_key, mime_type, size_bytes, checksum
- current_version_id, uploaded_by

### document_versions
- id, document_id, version_no
- storage_key, checksum, uploaded_by, note

### document_relations (thay cho `attachments` ở v7)
- id, document_id, entity_type, entity_id, created_by

### document_templates (xem `40` §4)
- id, code, doc_type, format PDF/DOCX
- body hoặc file_id, variables_schema_json
- version_no, status, owner_department_id

### generated_documents
- id, template_id, template_version
- subject_type, subject_id, document_version_id
- data_snapshot_json, generated_by, generated_at

## 22. Integration bổ sung
### integrations
- id, provider (MISA…), name, status
- config_encrypted, created_by

### api_keys
- id, name, key_prefix, key_hash
- scopes_json, expires_at, last_used_at, revoked_at

### webhooks
- id, name, url, secret_encrypted, events_json, active

### webhook_deliveries
- id, webhook_id, event_id
- status_code, attempts, next_retry_at, response_excerpt

### sync_jobs
- id, integration_id, entity_type, direction
- schedule, status, last_cursor

### sync_logs
- id, sync_job_id, entity_type
- local_id, remote_id, action, status
- error_code, error_message, payload_hash, created_at

### sync_conflicts
- id, integration_id, entity_type, local_id, remote_id
- local_snapshot_json, remote_snapshot_json
- status OPEN/RESOLVED/IGNORED, resolved_by, resolved_at
