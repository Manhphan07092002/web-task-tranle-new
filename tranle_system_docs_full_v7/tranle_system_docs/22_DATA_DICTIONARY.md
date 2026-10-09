# DATA DICTIONARY TOÀN HỆ THỐNG

> Kiểu dữ liệu đề xuất theo MySQL 8. ORM có thể khác, nhưng ý nghĩa nghiệp vụ và rule phải giữ thống nhất.

## 1. Quy ước
- PK: BIGINT hoặc UUID, chốt một kiểu.
- Money: `DECIMAL(18,2)`.
- Datetime lưu UTC.
- Audit: `created_by`, `created_at`, `updated_by`, `updated_at`.
- Soft delete nếu phù hợp: `deleted_at`.

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
- management_level INT
- join_date
- status

### departments
- id
- code UNIQUE
- name UNIQUE
- parent_id nullable
- manager_id nullable
- active

## 3. CRM
### customers
- id
- code UNIQUE
- type COMPANY/INDIVIDUAL
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
- source
- owner_id
- status
- qualification_status
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
- id, code, customer_id, opportunity_id, quote_id
- owner_id, status
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
- id, transfer_id nullable
- product_id, lot_id nullable, serial_id nullable
- from_location_id, to_location_id
- qty DECIMAL
- unit_cost DECIMAL(18,2)
- reference_type, reference_id
- done_at, created_by

`DONE` stock move bất biến.

## 8. Finance
### receivables
- id, customer_id, contract_id, payment_milestone_id
- expected_amount, official_amount
- due_date, paid_amount, outstanding_amount
- status, misa_reference

### payment_requests
- id, code, requester_id, department_id
- beneficiary, project_id, purpose
- amount DECIMAL(18,2)
- requested_date, status, paid_at, payment_reference

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
- id, run_id, step_key, approver_id
- state, comment, decided_at

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
