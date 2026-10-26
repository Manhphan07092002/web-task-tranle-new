import { Router } from 'express';
import { createDocumentContext } from './documentContext.js';
import { documentsCoreRoutes } from './documentsCore.js';
import { documentsCreateRoutes } from './documentsCreate.js';
import { documentsPostingRoutes } from './documentsPosting.js';
import { documentsSerialScanRoutes } from './documentsSerialScan.js';
import { documentsLotsRoutes } from './documentsLots.js';
import type { StockContext } from './context.js';

// 29 endpoint chứng từ, tách theo workflow. Thứ tự use bên dưới CHÍNH LÀ thứ tự
// đăng ký route trước khi tách: /documents/processing-summary phải đứng trước
// /documents/:id, nên stockRouteSurface chốt cả thứ tự chứ không chỉ path.
export function documentsRoutes(ctx: StockContext) {
  const docs = { ...ctx, ...createDocumentContext(ctx) };
  const router = Router();
  router.use(documentsCoreRoutes(docs));
  router.use(documentsCreateRoutes(docs));
  router.use(documentsPostingRoutes(docs));
  router.use(documentsSerialScanRoutes(docs));
  router.use(documentsLotsRoutes(docs));
  return router;
}
