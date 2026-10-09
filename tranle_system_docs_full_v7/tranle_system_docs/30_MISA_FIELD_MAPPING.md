# MISA FIELD MAPPING – CHỜ CHỐT THEO API THỰC TẾ

> Không tự bịa field/endpoint MISA.
> Trước khi code phải đối chiếu đúng sản phẩm MISA, phiên bản API và quyền tài khoản công ty.

## 1. Source of Truth đề xuất
| Entity | Master |
|---|---|
| Lead | Tran Le |
| Opportunity | Tran Le |
| Quote | Tran Le |
| Contract | Tran Le |
| Project | Tran Le |
| Ticket | Tran Le |
| Customer | Cần chốt |
| Product | Cần chốt |
| Invoice | MISA nếu MISA phát hành/ghi nhận |
| Official Receivable | MISA |
| Payment | MISA |
| Expected Receivable | Tran Le |

## 2. Customer Mapping
| Tran Le Field | MISA Field | Direction | Required | Transform |
|---|---|---|---|---|
| customer.code | TODO | TODO | ✓ | trim |
| customer.name | TODO | TODO | ✓ | trim |
| tax_code | TODO | TODO | | normalize |
| phone | TODO | TODO | | normalize |
| email | TODO | TODO | | lowercase |
| address | TODO | TODO | | |
| type | TODO | TODO | ✓ | enum map |

## 3. Product Mapping
| Tran Le Field | MISA Field | Direction |
|---|---|---|
| product.sku | TODO | TODO |
| product.name | TODO | TODO |
| uom | TODO | TODO |
| sale_price | TODO | TODO |
| vat_rate | TODO | TODO |

## 4. Sales Order Mapping
| Tran Le Field | MISA Field | Direction |
|---|---|---|
| sales_order.code | TODO | TL→MISA? |
| customer | TODO | TL→MISA? |
| order_date | TODO | |
| lines | TODO | |
| total | TODO | |

## 5. Invoice Mapping
Dự kiến MISA → Tran Le mirror/reference.

| MISA Field | Tran Le Field |
|---|---|
| TODO remote id | misa_remote_id |
| TODO invoice no | invoice_no |
| TODO customer | customer mapping |
| TODO amount | official_amount |
| TODO date | invoice_date |
| TODO status | invoice_status |

## 6. Receivable / Payment Mapping
Các field remote phải xác minh tài liệu API trước khi điền.

## 7. Endpoint Register
| Function | HTTP | Endpoint | Auth | Verified |
|---|---|---|---|---|
| Authenticate | TODO | TODO | TODO | ☐ |
| Customer list | TODO | TODO | TODO | ☐ |
| Customer create | TODO | TODO | TODO | ☐ |
| Product list | TODO | TODO | TODO | ☐ |
| Sales Order create | TODO | TODO | TODO | ☐ |
| Invoice list | TODO | TODO | TODO | ☐ |
| Receivable list | TODO | TODO | TODO | ☐ |
| Payment list | TODO | TODO | TODO | ☐ |

## 8. Checklist trước code
- Xác định sản phẩm MISA cụ thể.
- API version.
- Auth/token lifetime.
- Rate limit.
- Webhook có/không.
- Pagination.
- Remote unique ID.
- Required fields.
- Error schema.
- Sandbox.
- Kế toán xác nhận mapping.
