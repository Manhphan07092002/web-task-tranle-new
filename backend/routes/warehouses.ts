import { Router } from 'express';

/** Danh mục kho (đọc cho UI gán scope, dashboard kho sau này). */
export function warehouseRoutes(db: any) {
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      const rows = await db.all(
        'SELECT id, code, name, region, address, isActive FROM warehouses ORDER BY name ASC'
      );
      res.json(rows.map((w: any) => ({ ...w, isActive: Boolean(w.isActive) })));
    } catch (e) { res.status(500).json({ error: 'Failed to fetch warehouses' }); }
  });

  return router;
}
