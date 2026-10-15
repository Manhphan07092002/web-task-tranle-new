import { Router } from 'express';
import { stockReportRoutes } from './stockReports.js';
import { createStockContext } from './stock/context.js';
import { balancesRoutes } from './stock/balances.js';
import { documentsRoutes } from './stock/documents.js';
import { reservationsRoutes } from './stock/reservations.js';
import { catalogRoutes } from './stock/catalog.js';
import { countsRoutes } from './stock/counts.js';
import { misaRoutes } from './stock/misa.js';

// Phase A backend kho (09_KHO_VAN §3, §13–18 + D10).
// - Mọi biến động tồn sinh stock_move + cập nhật balances TRONG transaction.
// - Không bao giờ UPDATE số tồn trực tiếp. Serial/lot + kiểm kê ở Phase B.
// File này chỉ ghép các sub-router trong ./stock (tách nhỏ từ stock.ts 2164 dòng).
export function stockRoutes(db: any) {
  const router = Router();
  router.use(stockReportRoutes(db));
  const ctx = createStockContext(db);
  router.use(balancesRoutes(ctx));
  router.use(documentsRoutes(ctx));
  router.use(reservationsRoutes(ctx));
  router.use(catalogRoutes(ctx));
  router.use(countsRoutes(ctx));
  router.use(misaRoutes(ctx));
  return router;
}
