# DATA MODEL ĐỀ XUẤT (CHỈ MỤC)

> File này là **chỉ mục** được sinh từ `22_DATA_DICTIONARY.md` (định nghĩa trường nằm ở đó). Khi thêm/bớt bảng, sửa file 22 trước rồi cập nhật chỉ mục này.
> Bản v8 định nghĩa đủ mọi bảng; v7 liệt kê 73 bảng nhưng chỉ định nghĩa khoảng 31.

## 2. Core
- users
- employees
- departments

## 3. CRM
- customers
- contacts
- leads
- opportunities
- quotes
- contracts
- (định nghĩa inline) quote_lines, contract_payments

## 4. Project / Work
- projects
- tasks

## 5. Technical / Service
- technical_requests
- surveys
- boms
- bom_lines
- tickets
- customer_assets

## 6. Purchasing
- purchase_requests
- purchase_orders

## 7. Inventory
- warehouses
- locations
- stock_moves

## 8. Finance
- receivables
- payment_requests

## 9. Workflow
- workflows
- workflow_versions
- workflow_runs
- approvals

## 10. Dashboard
- dashboard_templates
- dashboard_widgets

## 11. Integration
- integration_mappings

## 12. Core bổ sung
- positions
- roles
- permissions
- user_roles
- role_permissions
- management_scopes
- approval_policies
- audit_logs
- notifications
- lookups
- custom_fields
- business_calendars
- business_holidays
- sla_policies
- saved_views
- outbox_events
- jobs

## 13. Work / Project bổ sung
- epics
- entity_relations
- comments
- milestones
- project_issues
- project_risks
- material_requests
- material_request_lines
- acceptances
- handovers
- site_diaries
- project_cost_entries

## 14. CRM bổ sung
- sales_orders
- sales_order_lines
- activities
- dealer_profiles
- price_lists
- price_list_items
- discount_policies
- vendor_targets
- partner_links
- campaigns
- campaign_spend
- content_plans
- contract_links
- contract_amendments
- contract_accounting_handoffs

## 15. Technical / Service bổ sung
- drawings
- ticket_events
- warranties
- maintenance_plans
- asset_replacements
- compliance_items

## 16. Purchasing bổ sung
- suppliers
- purchase_request_lines
- rfqs
- rfq_suppliers
- supplier_quotes
- supplier_quote_lines
- purchase_order_lines
- supplier_evaluations

## 17. Inventory bổ sung
- product_categories
- uoms
- products
- lots
- serials
- stock_documents
- stock_document_lines
- stock_balances
- stock_reservations
- stock_counts
- stock_count_lines
- landed_costs
- landed_cost_allocations
- lot_certificates

## 18. Finance bổ sung
- payables
- payments
- payment_allocations
- advances
- settlements
- settlement_lines
- budgets

## 19. HCNS bổ sung
- leave_requests
- leave_balances
- employee_lifecycles
- asset_assignments

## 20. Workflow bổ sung
- workflow_run_steps

## 21. Documents và template
- documents
- document_versions
- document_relations
- document_templates
- generated_documents

## 22. Integration bổ sung
- integrations
- api_keys
- webhooks
- webhook_deliveries
- sync_jobs
- sync_logs
- sync_conflicts

## Bảng đã đổi tên hoặc gộp so với v7

| v7 | v8 | Lý do |
|---|---|---|
| task_relations | entity_relations | Quan hệ dùng chung cho mọi thực thể, không chỉ task |
| attachments | document_relations | Một cơ chế tài liệu duy nhất, có version |
| stock_transfers | stock_documents (+ stock_document_lines) | ADR-013: một khung chứng từ kho, nhiều `doc_type` |
| collections | payments + payment_allocations | Thu và chi dùng chung một bảng, phân bổ riêng |
| workflow_steps | workflow_run_steps | Tránh nhầm với bước trong định nghĩa workflow |
| marketing_leads (nếu có) | leads (stage_owner) | ADR-012: một bảng Lead |

Tổng số bảng được định nghĩa (không tính bảng inline): **127**.
