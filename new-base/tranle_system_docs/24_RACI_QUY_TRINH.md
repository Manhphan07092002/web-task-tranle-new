# RACI QUY TRÌNH XUYÊN PHÒNG BAN

R = Responsible; A = Accountable; C = Consulted; I = Informed.

## Lead → Contract → Project → Payment → Warranty
| Hoạt động | Sales | Kỹ thuật | Dự án | Mua hàng | Kho | Kế toán | BGĐ |
|---|---|---|---|---|---|---|---|
| Tạo Lead | R | | | | | | |
| Qualify Lead | R/A | | | | | | |
| Tạo Opportunity | R | | | | | | |
| Yêu cầu khảo sát | R | C | | | | | |
| Khảo sát | C | R/A | | | | | |
| Technical Solution | C | R/A | | | | | |
| BOM | C | R/A | C | | | | |
| Báo giá | R | C | | C | | C | A theo ngưỡng |
| Hợp đồng | R | C | C | | | C | A |
| Tạo Project | C | C | R/A | | | I | I |
| Kế hoạch dự án | I | C | R/A | C | C | I | I |
| Yêu cầu vật tư | I | C | R/A | C | C | | |
| Mua hàng | | C | C | R/A | C | C | A theo ngưỡng |
| Nhập kho | | | I | C | R/A | I | |
| Xuất kho dự án | | C | R | | R/A | | |
| Thi công | I | R | R/A | | C | | |
| Nghiệm thu | C | R | R/A | | | C | I |
| Bàn giao | C | R | R/A | | | I | I |
| Công nợ | I | | C | | | R/A | I |
| Thu tiền | C | | I | | | R/A | I |
| Bảo hành | C | R/A | C | | C | I | I |

## Purchase to Pay
| Hoạt động | Phòng yêu cầu | Mua hàng | Kho | Kế toán | BGĐ |
|---|---|---|---|---|---|
| Tạo PR | R | C | C | I | |
| Duyệt nhu cầu | A theo cấp | C | | C | A theo ngưỡng |
| RFQ | I | R/A | | | |
| So sánh NCC | C | R | | C | A nếu cần |
| PO | I | R | C | C | A theo ngưỡng |
| Nhận hàng | I | C | R/A | I | |
| Hóa đơn NCC | I | C | C | R/A | |
| Payment Request | I | C | I | R | A theo ngưỡng |
| Thanh toán | I | I | | R/A | I |

## Ownership
| Object | Owner chính |
|---|---|
| Lead | Sales |
| Opportunity | Sales |
| Customer | Shared master |
| Technical Request | Technical sau khi assign |
| Survey | Technical |
| BOM kỹ thuật | Technical |
| Quote | Sales |
| Contract | Sales |
| Project | Project Department |
| Purchase Order | Purchasing |
| Stock Move | Warehouse |
| Ticket | Technical/Service |
| Customer Asset | Technical/Service |
| Receivable/Payable | Finance |
| Workflow Definition | Platform/Admin |

## Bổ sung V8: các hạng mục còn thiếu

| Hạng mục | R | A | C | I |
|---|---|---|---|---|
| Rà soát pháp lý hợp đồng (ADR-017) | `legal_reviewer` (người được chỉ định) | BGĐ | Kinh doanh, Kế toán | Dự án |
| Theo dõi hạn chứng nhận/giấy phép/hiệu chuẩn | Phòng sở hữu từng mục | Trưởng phòng sở hữu | Marketing, Kinh doanh, Kỹ thuật | BGĐ |
| Duyệt ngoại lệ hạn mức công nợ đại lý | Kế toán | Giám đốc | Kinh doanh | |
| Chính sách giá/chiết khấu theo cấp đại lý | Kinh doanh | BGĐ | Kế toán | Marketing |
| Phân bổ chi phí nhập khẩu (landed cost) | Kế toán | Kế toán trưởng | Kho, Mua hàng | BGĐ |
| Chi phí dự án và biên lợi nhuận | Dự án + Kế toán | Giám đốc | Kinh doanh | |

Các cột R/A/C/I ở trên là đề xuất, **cần phòng liên quan xác nhận**.
