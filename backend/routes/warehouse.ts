import { Router } from 'express';
import { randomUUID } from 'crypto';
import { requireDepartmentScope, requireApprovalAuthority, requireManagementLevel } from '../middleware/rbac.js';

/**
 * Shared warehouse data-scope resolution.
 * - Admin (99): none. Director (40+): all.
 * - Employee (10): own (requested/assigned) + own department for stock.
 * - Manager/Deputy: accessible departments via RBAC.
 * deptIds null = all departments.
 */
async function getWarehouseAccess(req: any): Promise<{
  scope: 'none' | 'own' | 'department' | 'all';
  level: number;
  userId: string;
  deptIds: string[] | null;
  ownOnly: boolean;
}> {
  const user = req.user || {};
  const level = user.managementLevel ?? 10;
  if (level === 99 || !user.id) return { scope: 'none', level, userId: user.id, deptIds: [], ownOnly: false };
  if (level >= 40) return { scope: 'all', level, userId: user.id, deptIds: null, ownOnly: false };
  if (level === 10) {
    return {
      scope: 'own', level, userId: user.id,
      deptIds: user.primaryDepartmentId ? [user.primaryDepartmentId] : [],
      ownOnly: true,
    };
  }
  const rbac = req.rbacService;
  const ctx = req.rbacContext;
  const depts = rbac && ctx
    ? await rbac.getAccessibleDepartments(ctx)
    : (user.primaryDepartmentId ? [user.primaryDepartmentId] : []);
  return { scope: 'department', level, userId: user.id, deptIds: depts, ownOnly: false };
}

function inPlaceholders(ids: string[]): string {
  return ids.map(() => '?').join(',');
}

export function warehouseRoutes(db: any) {
  const router = Router();

  // ============================================================
  // GET /api/warehouse/inventory - List inventory with department scope
  // ============================================================
  // ============================================================
  // GET /api/warehouse/inventory - List inventory with department scope
  // Filters: ?search=&location=&category=&unit= ; pagination: ?page=&pageSize=
  // returns { rows, total } when paged, otherwise a plain array (backward compat).
  // ============================================================
  router.get('/inventory',
    requireDepartmentScope('inventory'),
    async (req, res) => {
      try {
        const access = await getWarehouseAccess(req);
        if (access.scope === 'none') {
          return res.json(req.query.page || req.query.pageSize ? { rows: [], total: 0 } : []);
        }

        const conditions: string[] = [];
        const params: any[] = [];
        if (access.deptIds !== null) {
          if (access.deptIds.length === 0) {
            return res.json(req.query.page || req.query.pageSize ? { rows: [], total: 0 } : []);
          }
          conditions.push(`departmentId IN (${inPlaceholders(access.deptIds)})`);
          params.push(...access.deptIds);
        }
        const search = String(req.query.search || '').trim();
        if (search) {
          conditions.push('(productCode LIKE ? OR productName LIKE ?)');
          params.push(`%${search}%`, `%${search}%`);
        }
        const location = String(req.query.location || '').trim();
        if (location) {
          conditions.push('warehouseLocation = ?');
          params.push(location);
        }
        const category = String(req.query.category || '').trim();
        if (category) {
          conditions.push('category = ?');
          params.push(category);
        }
        const unit = String(req.query.unit || '').trim();
        if (unit) {
          conditions.push('unit = ?');
          params.push(unit);
        }
        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const pageSizeRaw = parseInt(String(req.query.pageSize || ''), 10);
        if (Number.isFinite(pageSizeRaw) && pageSizeRaw > 0) {
          const pageSize = Math.min(pageSizeRaw, 500);
          const page = Math.max(parseInt(String(req.query.page || '1'), 10) || 1, 1);
          const totalRow = await db.get(`SELECT COUNT(*) AS c FROM inventory ${where}`, params);
          const rows = await db.all(
            `SELECT * FROM inventory ${where} ORDER BY productName ASC LIMIT ? OFFSET ?`,
            [...params, pageSize, (page - 1) * pageSize]
          );
          return res.json({ rows, total: Number(totalRow?.c || 0), page, pageSize });
        }

        const inventory = await db.all(
          `SELECT * FROM inventory ${where} ORDER BY productName ASC`,
          params
        );
        res.json(inventory);
      } catch (error) {
        console.error('Error fetching inventory:', error);
        res.status(500).json({ error: 'Failed to fetch inventory' });
      }
    }
  );

  // GET /api/warehouse/inventory-meta - distinct filter values (category/unit)
  router.get('/inventory-meta',
    requireDepartmentScope('inventory'),
    async (req, res) => {
      try {
        const access = await getWarehouseAccess(req);
        if (access.scope === 'none') return res.json({ categories: [], units: [] });
        let condition = '1=1';
        let params: any[] = [];
        if (access.deptIds !== null) {
          if (access.deptIds.length === 0) return res.json({ categories: [], units: [] });
          condition = `departmentId IN (${inPlaceholders(access.deptIds)})`;
          params = access.deptIds;
        }
        const categories = await db.all(
          `SELECT DISTINCT category AS value FROM inventory WHERE ${condition} AND category IS NOT NULL AND category != '' ORDER BY category ASC`,
          params
        );
        const units = await db.all(
          `SELECT DISTINCT unit AS value FROM inventory WHERE ${condition} AND unit IS NOT NULL AND unit != '' ORDER BY unit ASC`,
          params
        );
        res.json({
          categories: categories.map((r: any) => r.value),
          units: units.map((r: any) => r.value),
        });
      } catch (error) {
        console.error('Error fetching inventory meta:', error);
        res.status(500).json({ error: 'Failed to fetch inventory meta' });
      }
    }
  );

  // ============================================================
  // GET /api/warehouse/inventory/:id - Get single inventory item
  // ============================================================
  router.get('/inventory/:id',
    requireDepartmentScope('inventory'),
    async (req, res) => {
      try {
        const { id } = req.params;
        const user = (req as any).user;
        const managementLevel = user?.managementLevel ?? 10;

        const item = await db.get('SELECT * FROM inventory WHERE id = ?', [id]);

        if (!item) {
          return res.status(404).json({ error: 'Inventory item not found' });
        }

        // Admin cannot access business data
        if (managementLevel === 99) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        // Director bypasses department check
        if (managementLevel < 40) {
          const rbacService = (req as any).rbacService;
          const rbacContext = (req as any).rbacContext;
          const accessibleDepts = rbacService && rbacContext
            ? await rbacService.getAccessibleDepartments(rbacContext)
            : (user?.primaryDepartmentId ? [user.primaryDepartmentId] : []);
          if (!accessibleDepts.includes(item.departmentId)) {
            return res.status(403).json({ error: 'Forbidden' });
          }
        }

        res.json(item);
      } catch (error) {
        console.error('Error fetching inventory item:', error);
        res.status(500).json({ error: 'Failed to fetch inventory item' });
      }
    });

  // ============================================================
  // POST /api/warehouse/inventory - Add new inventory item
  // ============================================================
  router.post('/inventory', requireManagementLevel(20), async (req, res) => {
    try {
      const {
        productCode,
        productName,
        quantity = 0,
        unit = 'pcs',
        warehouseLocation,
        minStockLevel = 0,
        maxStockLevel = 0,
        category,
        specCode
      } = req.body;

      if (!productCode || !productName) {
        return res.status(400).json({ error: 'Product code and name are required' });
      }

      const id = randomUUID();
      const departmentId = (req as any).user?.primaryDepartmentId || 'dept-kho';

      await db.run(
        `INSERT INTO inventory
         (id, productCode, productName, quantity, unit, warehouseLocation, minStockLevel, maxStockLevel, departmentId, category, specCode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, productCode, productName, quantity, unit, warehouseLocation, minStockLevel, maxStockLevel, departmentId, category ?? null, specCode ?? null]
      );

      res.json({ id, success: true });
    } catch (error) {
      console.error('Error creating inventory item:', error);
      res.status(500).json({ error: 'Failed to create inventory item' });
    }
  });

  // ============================================================
  // PUT /api/warehouse/inventory/:id - Update inventory item
  // ============================================================
  router.put('/inventory/:id', requireManagementLevel(20), async (req, res) => {
    try {
      const { id } = req.params;
      const {
        productCode,
        productName,
        quantity,
        unit,
        warehouseLocation,
        minStockLevel,
        maxStockLevel,
        category,
        specCode
      } = req.body;

      await db.run(
        `UPDATE inventory
         SET productCode = ?, productName = ?, quantity = ?, unit = ?,
             warehouseLocation = ?, minStockLevel = ?, maxStockLevel = ?,
             category = ?, specCode = ?,
             updatedAt = ?
         WHERE id = ?`,
        [productCode, productName, quantity, unit, warehouseLocation,
         minStockLevel, maxStockLevel, category ?? null, specCode ?? null,
         new Date().toISOString(), id]
      );

      res.json({ success: true });
    } catch (error) {
      console.error('Error updating inventory item:', error);
      res.status(500).json({ error: 'Failed to update inventory item' });
    }
  });

  // ============================================================
  // GET /api/warehouse/transactions - List warehouse transactions
  // ============================================================
  router.get('/transactions',
    requireDepartmentScope('warehouse_transaction'),
    async (req, res) => {
      try {
        // NOTE: the generic applyDepartmentFilter() targets createdBy/task tables,
        // but warehouse_transactions uses requestedBy/assignedTo, so scope is built here.
        const user = (req as any).user;
        const rbacService = (req as any).rbacService;
        const rbacContext = (req as any).rbacContext;
        const managementLevel = user?.managementLevel ?? 10;

        let condition: string;
        let params: any[];
        if (managementLevel >= 40) {
          condition = '1=1';
          params = [];
        } else if (managementLevel === 99) {
          condition = '0=1';
          params = [];
        } else if (managementLevel === 10) {
          condition = '(wt.requestedBy = ? OR wt.assignedTo = ?)';
          params = [user.id, user.id];
        } else {
          const accessibleDepts = rbacService && rbacContext
            ? await rbacService.getAccessibleDepartments(rbacContext)
            : (user?.primaryDepartmentId ? [user.primaryDepartmentId] : []);
          if (accessibleDepts.length === 0) {
            return res.json([]);
          }
          const placeholders = accessibleDepts.map(() => '?').join(',');
          condition = `wt.departmentId IN (${placeholders})`;
          params = accessibleDepts;
        }

        // Optional filters: ?type=IN|OUT|ADJUST|TRANSFER|RETURN & ?status=pending|approved|completed|rejected
        // & ?scope=internal|site (TRANSFER only)
        const VALID_TX_TYPES = ['IN', 'OUT', 'ADJUST', 'TRANSFER', 'RETURN'];
        const VALID_TX_STATUS = ['pending', 'approved', 'completed', 'rejected'];
        const VALID_TRANSFER_SCOPES = ['internal', 'site'];
        const filterType = String(req.query.type || '');
        const filterStatus = String(req.query.status || '');
        const filterScope = String(req.query.scope || '');
        if (filterType && VALID_TX_TYPES.includes(filterType)) {
          condition += ' AND wt.type = ?';
          params.push(filterType);
        }
        if (filterStatus && VALID_TX_STATUS.includes(filterStatus)) {
          condition += ' AND wt.status = ?';
          params.push(filterStatus);
        }
        if (filterScope && VALID_TRANSFER_SCOPES.includes(filterScope)) {
          condition += ' AND wt.transferScope = ?';
          params.push(filterScope);
        }

        const transactions = await db.all(
          `SELECT wt.*,
                  u1.name as requestedByName,
                  u2.name as approvedByName,
                  u3.name as assignedToName
           FROM warehouse_transactions wt
           LEFT JOIN users u1 ON wt.requestedBy = u1.id
           LEFT JOIN users u2 ON wt.approvedBy = u2.id
           LEFT JOIN users u3 ON wt.assignedTo = u3.id
           WHERE ${condition}
           ORDER BY wt.createdAt DESC`,
          params
        );

        res.json(transactions);
      } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({ error: 'Failed to fetch transactions' });
      }
    }
  );

  // ============================================================
  // GET /api/warehouse/dashboard - RBAC-scoped dashboard stats
  // Scope: Employee = own/requested/assigned, Manager/Deputy = accessible
  // departments, Director = all, Admin = none.
  // ============================================================
  router.get('/dashboard',
    requireDepartmentScope('warehouse'),
    async (req, res) => {
      try {
        const user = (req as any).user;
        const rbacService = (req as any).rbacService;
        const rbacContext = (req as any).rbacContext;
        const managementLevel = user?.managementLevel ?? 10;
        const userId = user?.id;

        const emptyDashboard = {
          scope: 'none' as const,
          kpis: {
            pendingDocuments: 0, pendingDeltaPct: null,
            receiptsToday: 0, receiptsDeltaPct: null,
            issuesToday: 0, issuesDeltaPct: null,
            transfersInProgress: 0,
            pendingStockCounts: 0,
            inventoryAlerts: 0,
          },
          teamActivity: [],
          myTasks: [],
          inventoryAlerts: [],
          docTypeRatio: [],
          pendingApprovals: [],
        };

        if (managementLevel === 99 || !userId) {
          return res.json(emptyDashboard);
        }

        const top = Math.min(Math.max(parseInt(String(req.query.top || '5'), 10) || 5, 1), 20);
        const dayMs = 24 * 60 * 60 * 1000;
        const toDay = (d: Date) => d.toISOString().slice(0, 10);
        const todayStr = toDay(new Date());
        const monthParam = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : todayStr.slice(0, 7);
        const yesterdayStr = toDay(new Date(Date.now() - dayMs));
        const monthStart = `${monthParam}-01`;
        const [mYear, mMonth] = monthParam.split('-').map(Number);
        const monthEnd = toDay(new Date(Date.UTC(mYear, mMonth, 1)));
        const weekAgo = toDay(new Date(Date.now() - 7 * dayMs));
        const twoWeeksAgo = toDay(new Date(Date.now() - 14 * dayMs));

        // ---- scope filters (tx table aliased wt, inventory aliased i) ----
        let scope: 'own' | 'department' | 'all' = 'own';
        let txCondition = '(wt.requestedBy = ? OR wt.assignedTo = ?)';
        let txParams: any[] = [userId, userId];
        let invCondition = 'i.departmentId = ?';
        let invParams: any[] = [user?.primaryDepartmentId || ''];

        if (managementLevel >= 40) {
          scope = 'all';
          txCondition = '1=1';
          txParams = [];
          invCondition = '1=1';
          invParams = [];
        } else if (managementLevel >= 20) {
          scope = 'department';
          const accessibleDepts = rbacService && rbacContext
            ? await rbacService.getAccessibleDepartments(rbacContext)
            : (user?.primaryDepartmentId ? [user.primaryDepartmentId] : []);
          if (accessibleDepts.length === 0) {
            return res.json({ ...emptyDashboard, scope });
          }
          const placeholders = accessibleDepts.map(() => '?').join(',');
          txCondition = `wt.departmentId IN (${placeholders})`;
          txParams = accessibleDepts;
          invCondition = `i.departmentId IN (${placeholders})`;
          invParams = accessibleDepts;
        }

        const countTx = async (extra: string, params: any[]) => {
          const row = await db.get(
            `SELECT COUNT(*) AS c FROM warehouse_transactions wt WHERE ${txCondition} AND (${extra})`,
            [...txParams, ...params]
          );
          return Number(row?.c || 0);
        };

        const pendingDocuments = await countTx(`wt.status = 'pending'`, []);
        const receiptsToday = await countTx(`wt.type = 'IN' AND DATE(wt.createdAt) = ?`, [todayStr]);
        const receiptsYesterday = await countTx(`wt.type = 'IN' AND DATE(wt.createdAt) = ?`, [yesterdayStr]);
        const issuesToday = await countTx(`wt.type = 'OUT' AND DATE(wt.createdAt) = ?`, [todayStr]);
        const issuesYesterday = await countTx(`wt.type = 'OUT' AND DATE(wt.createdAt) = ?`, [yesterdayStr]);
        const transfersInProgress = await countTx(`wt.type = 'TRANSFER' AND wt.status = 'pending'`, []);
        const pendingStockCounts = await countTx(`wt.type = 'ADJUST' AND wt.status = 'pending'`, []);
        const pendingLast7d = await countTx(`wt.status = 'pending' AND wt.createdAt >= ?`, [weekAgo]);
        const pendingPrev7d = await countTx(`wt.status = 'pending' AND wt.createdAt >= ? AND wt.createdAt < ?`, [twoWeeksAgo, weekAgo]);

        const pctChange = (cur: number, prev: number): number | null => {
          if (prev <= 0) return cur > 0 ? 100 : null;
          return Math.round(((cur - prev) / prev) * 100);
        };

        const alertRows = await db.all(
          `SELECT i.id, i.productCode, i.productName, i.quantity, i.unit,
                  i.warehouseLocation, i.minStockLevel,
                  (i.minStockLevel - i.quantity) AS shortage
           FROM inventory i
           WHERE ${invCondition} AND i.minStockLevel > 0 AND i.quantity < i.minStockLevel
           ORDER BY shortage DESC
           LIMIT ${top}`,
          invParams
        );

        const ratioRows = await db.all(
          `SELECT wt.type, COUNT(*) AS count
           FROM warehouse_transactions wt
           WHERE ${txCondition} AND wt.createdAt >= ? AND wt.createdAt < ?
           GROUP BY wt.type`,
          [...txParams, monthStart, monthEnd]
        );

        const withNames = `
          SELECT wt.*,
                 u1.name AS requestedByName,
                 u2.name AS approvedByName,
                 u3.name AS assignedToName
          FROM warehouse_transactions wt
          LEFT JOIN users u1 ON wt.requestedBy = u1.id
          LEFT JOIN users u2 ON wt.approvedBy = u2.id
          LEFT JOIN users u3 ON wt.assignedTo = u3.id`;

        const teamActivity = await db.all(
          `${withNames} WHERE ${txCondition} ORDER BY wt.createdAt DESC LIMIT 8`,
          txParams
        );

        const myTasks = await db.all(
          `${withNames} WHERE (wt.requestedBy = ? OR wt.assignedTo = ?) ORDER BY wt.createdAt DESC LIMIT 10`,
          [userId, userId]
        );

        const pendingApprovals = await db.all(
          `${withNames} WHERE ${txCondition} AND wt.status = 'pending' ORDER BY wt.createdAt ASC LIMIT 6`,
          txParams
        );

        res.json({
          scope,
          month: monthParam,
          kpis: {
            pendingDocuments,
            pendingDeltaPct: pctChange(pendingLast7d, pendingPrev7d),
            receiptsToday,
            receiptsDeltaPct: pctChange(receiptsToday, receiptsYesterday),
            issuesToday,
            issuesDeltaPct: pctChange(issuesToday, issuesYesterday),
            transfersInProgress,
            pendingStockCounts,
            inventoryAlerts: alertRows.length,
          },
          teamActivity,
          myTasks,
          inventoryAlerts: alertRows,
          docTypeRatio: ratioRows,
          pendingApprovals,
        });
      } catch (error) {
        console.error('Error fetching warehouse dashboard:', error);
        res.status(500).json({ error: 'Failed to fetch warehouse dashboard' });
      }
    }
  );

  // ============================================================
  // POST /api/warehouse/transactions - Create warehouse transaction
  // ============================================================
  const VALID_TX_TYPES = ['IN', 'OUT', 'ADJUST', 'TRANSFER', 'RETURN'];
  const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
  const VALID_TRANSFER_SCOPES = ['internal', 'site'];

  router.post('/transactions', async (req, res) => {
    try {
      const {
        type,
        productCode,
        productName,
        quantity,
        unit = 'pcs',
        fromLocation,
        toLocation,
        notes,
        referenceDoc,
        assignedTo,
        dueDate,
        priority = 'normal',
        transferScope,
        category,
        specCode
      } = req.body;

      if (!type || !productCode || !productName || !quantity) {
        return res.status(400).json({
          error: 'Type, product code, product name, and quantity are required'
        });
      }

      if (!VALID_TX_TYPES.includes(type)) {
        return res.status(400).json({
          error: `Invalid transaction type. Must be one of: ${VALID_TX_TYPES.join(', ')}`
        });
      }

      if (!VALID_PRIORITIES.includes(priority)) {
        return res.status(400).json({
          error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}`
        });
      }

      if (transferScope !== undefined && transferScope !== null && !VALID_TRANSFER_SCOPES.includes(transferScope)) {
        return res.status(400).json({
          error: `Invalid transferScope. Must be one of: ${VALID_TRANSFER_SCOPES.join(', ')}`
        });
      }

      if (assignedTo) {
        const assignee = await db.get('SELECT id FROM users WHERE id = ?', [assignedTo]);
        if (!assignee) {
          return res.status(400).json({ error: 'Assigned user not found' });
        }
      }

      const id = randomUUID();
      const transactionCode = `WH-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const departmentId = (req as any).user?.primaryDepartmentId || 'dept-kho';
      const scope = type === 'TRANSFER' ? (transferScope || 'internal') : null;

      await db.run(
        `INSERT INTO warehouse_transactions
         (id, transactionCode, type, productCode, productName, quantity, unit,
          fromLocation, toLocation, requestedBy, departmentId, notes, referenceDoc,
          status, assignedTo, dueDate, priority, transferScope, category, specCode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
        [id, transactionCode, type, productCode, productName, quantity, unit,
         fromLocation, toLocation, (req as any).user.id, departmentId, notes, referenceDoc,
         assignedTo || null, dueDate || null, priority, scope, category ?? null, specCode ?? null]
      );

      res.json({ id, transactionCode, success: true });
    } catch (error) {
      console.error('Error creating transaction:', error);
      res.status(500).json({ error: 'Failed to create transaction' });
    }
  });

  // ============================================================
  // POST /api/warehouse/transactions/:id/approve - Approve transaction
  // ============================================================
  router.post('/transactions/:id/approve',
    requireApprovalAuthority('warehouse'),
    async (req, res) => {
      try {
        const { id } = req.params;
        const user = (req as any).user;

        if (!user) {
          return res.status(401).json({ error: 'User not authenticated' });
        }

        // Get transaction
        const trans = await db.get(
          'SELECT * FROM warehouse_transactions WHERE id = ?',
          [id]
        );

        if (!trans) {
          return res.status(404).json({ error: 'Transaction not found' });
        }

        if (trans.status !== 'pending') {
          return res.status(400).json({
            error: `Cannot approve transaction with status: ${trans.status}`
          });
        }

        // Update transaction status
        await db.run(
          `UPDATE warehouse_transactions
           SET status = 'approved', approvedBy = ?, updatedAt = ?
           WHERE id = ?`,
          [user.id, new Date().toISOString(), id]
        );

        // Update inventory based on transaction type
        // IN + RETURN add stock, OUT removes, ADJUST sets exact quantity
        if (trans.type === 'IN' || trans.type === 'RETURN') {
          // Check if product exists in inventory
          const existing = await db.get(
            'SELECT id FROM inventory WHERE productCode = ?',
            [trans.productCode]
          );

          if (existing) {
            // Update existing
            await db.run(
              `UPDATE inventory
               SET quantity = quantity + ?, updatedAt = ?
               WHERE productCode = ?`,
              [trans.quantity, new Date().toISOString(), trans.productCode]
            );
          } else {
            // Create new inventory item (carry category/specCode from the receipt)
            const newId = randomUUID();
            await db.run(
              `INSERT INTO inventory
               (id, productCode, productName, quantity, unit, warehouseLocation, departmentId, category, specCode)
               VALUES (?, ?, ?, ?, ?, ?, 'dept-kho', ?, ?)`,
              [newId, trans.productCode, trans.productName, trans.quantity, trans.unit, trans.toLocation, trans.category ?? null, trans.specCode ?? null]
            );
          }
        } else if (trans.type === 'OUT') {
          // Decrease inventory
          await db.run(
            `UPDATE inventory
             SET quantity = quantity - ?, updatedAt = ?
             WHERE productCode = ?`,
            [trans.quantity, new Date().toISOString(), trans.productCode]
          );
        } else if (trans.type === 'ADJUST') {
          // Set inventory to exact quantity
          await db.run(
            `UPDATE inventory
             SET quantity = ?, updatedAt = ?
             WHERE productCode = ?`,
            [trans.quantity, new Date().toISOString(), trans.productCode]
          );
        } else if (trans.type === 'TRANSFER') {
          // Update location
          await db.run(
            `UPDATE inventory
             SET warehouseLocation = ?, updatedAt = ?
             WHERE productCode = ?`,
            [trans.toLocation, new Date().toISOString(), trans.productCode]
          );
        }

        res.json({ success: true });
      } catch (error) {
        console.error('Error approving transaction:', error);
        res.status(500).json({ error: 'Failed to approve transaction' });
      }
    }
  );

  // ============================================================
  // POST /api/warehouse/transactions/:id/reject - Reject transaction
  // ============================================================
  router.post('/transactions/:id/reject',
    requireApprovalAuthority('warehouse'),
    async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const trans = await db.get(
        'SELECT * FROM warehouse_transactions WHERE id = ?',
        [id]
      );

      if (!trans) {
        return res.status(404).json({ error: 'Transaction not found' });
      }

      if (trans.status !== 'pending') {
        return res.status(400).json({
          error: `Cannot reject transaction with status: ${trans.status}`
        });
      }

      await db.run(
        `UPDATE warehouse_transactions
         SET status = 'rejected', approvedBy = ?, notes = ?, updatedAt = ?
         WHERE id = ?`,
        [(req as any).user.id, reason || trans.notes, new Date().toISOString(), id]
      );

      res.json({ success: true });
    } catch (error) {
      console.error('Error rejecting transaction:', error);
      res.status(500).json({ error: 'Failed to reject transaction' });
    }
  });

  // ============================================================
  // POST /api/warehouse/transactions/:id/complete - Finish picking/handling
  // approved -> completed. Allowed for requester/assignee or level 20+ in scope.
  // ============================================================
  router.post('/transactions/:id/complete',
    requireDepartmentScope('warehouse_transaction'),
    async (req, res) => {
      try {
        const { id } = req.params;
        const access = await getWarehouseAccess(req);
        if (access.scope === 'none') {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const trans = await db.get(
          'SELECT * FROM warehouse_transactions WHERE id = ?',
          [id]
        );
        if (!trans) {
          return res.status(404).json({ error: 'Transaction not found' });
        }
        if (trans.status !== 'approved') {
          return res.status(400).json({ error: `Only approved transactions can be completed (current: ${trans.status})` });
        }

        const isOwner = trans.requestedBy === access.userId || trans.assignedTo === access.userId;
        const isManager = access.level >= 20;
        const inDeptScope = access.deptIds === null || (trans.departmentId && access.deptIds.includes(trans.departmentId));
        if (!isOwner && !(isManager && inDeptScope)) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        await db.run(
          `UPDATE warehouse_transactions SET status = 'completed', updatedAt = ? WHERE id = ?`,
          [new Date().toISOString(), id]
        );
        res.json({ success: true });
      } catch (error) {
        console.error('Error completing transaction:', error);
        res.status(500).json({ error: 'Failed to complete transaction' });
      }
    }
  );

  // ============================================================
  // Stock count periods (Kỳ kiểm kê)
  // ============================================================
  router.get('/stock-counts',
    requireDepartmentScope('warehouse'),
    async (req, res) => {
      try {
        const access = await getWarehouseAccess(req);
        if (access.scope === 'none') return res.json([]);

        let condition = '1=1';
        let params: any[] = [];
        if (access.deptIds !== null) {
          if (access.ownOnly) {
            condition = '(p.createdBy = ? OR p.assignedTo = ?)';
            params = [access.userId, access.userId];
          } else {
            if (access.deptIds.length === 0) return res.json([]);
            condition = `p.departmentId IN (${inPlaceholders(access.deptIds)})`;
            params = access.deptIds;
          }
        }
        const month = String(req.query.month || '');
        if (/^\d{4}-\d{2}$/.test(month)) {
          condition += ' AND p.month = ?';
          params.push(month);
        }

        const periods = await db.all(
          `SELECT p.*, u1.name AS assignedToName, u2.name AS createdByName,
                  (SELECT COUNT(*) FROM stock_count_items i WHERE i.periodId = p.id) AS itemCount,
                  (SELECT COUNT(*) FROM stock_count_items i WHERE i.periodId = p.id AND i.status = 'counted') AS countedCount,
                  (SELECT COUNT(*) FROM stock_count_items i WHERE i.periodId = p.id AND i.countedQty IS NOT NULL AND i.countedQty != i.systemQty AND i.status != 'resolved') AS varianceCount
           FROM stock_count_periods p
           LEFT JOIN users u1 ON p.assignedTo = u1.id
           LEFT JOIN users u2 ON p.createdBy = u2.id
           WHERE ${condition}
           ORDER BY p.month DESC, p.createdAt DESC`,
          params
        );
        res.json(periods);
      } catch (error) {
        console.error('Error fetching stock count periods:', error);
        res.status(500).json({ error: 'Failed to fetch stock count periods' });
      }
    }
  );

  router.post('/stock-counts',
    requireDepartmentScope('warehouse'),
    requireManagementLevel(20),
    async (req, res) => {
      try {
        const access = await getWarehouseAccess(req);
        if (access.scope === 'none') return res.status(403).json({ error: 'Forbidden' });
        const { month, location, assignedTo, notes } = req.body;
        if (!month || !/^\d{4}-\d{2}$/.test(month)) {
          return res.status(400).json({ error: 'month (YYYY-MM) is required' });
        }
        if (assignedTo) {
          const assignee = await db.get('SELECT id FROM users WHERE id = ?', [assignedTo]);
          if (!assignee) return res.status(400).json({ error: 'Assigned user not found' });
        }
        const departmentId = req.user?.primaryDepartmentId || 'dept-kho';
        if (access.deptIds !== null && !access.deptIds.includes(departmentId) && !access.ownOnly) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        const id = randomUUID();
        const code = `KK-${month.replace('-', '')}-${Date.now().toString().slice(-6)}`;
        await db.run(
          `INSERT INTO stock_count_periods
           (id, code, month, location, status, assignedTo, departmentId, notes, createdBy)
           VALUES (?, ?, ?, ?, 'planned', ?, ?, ?, ?)`,
          [id, code, month, location || null, assignedTo || null, departmentId, notes || null, access.userId]
        );
        res.json({ id, code, success: true });
      } catch (error) {
        console.error('Error creating stock count period:', error);
        res.status(500).json({ error: 'Failed to create stock count period' });
      }
    }
  );

  const VALID_PERIOD_STATUS = ['planned', 'in_progress', 'completed', 'cancelled'];

  router.patch('/stock-counts/:id',
    requireDepartmentScope('warehouse'),
    requireManagementLevel(20),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body;
        if (!VALID_PERIOD_STATUS.includes(status)) {
          return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_PERIOD_STATUS.join(', ')}` });
        }
        const period = await db.get('SELECT * FROM stock_count_periods WHERE id = ?', [id]);
        if (!period) return res.status(404).json({ error: 'Stock count period not found' });
        const access = await getWarehouseAccess(req);
        if (access.deptIds !== null && !access.deptIds.includes(period.departmentId)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        await db.run(
          `UPDATE stock_count_periods SET status = ?, updatedAt = ? WHERE id = ?`,
          [status, new Date().toISOString(), id]
        );
        res.json({ success: true });
      } catch (error) {
        console.error('Error updating stock count period:', error);
        res.status(500).json({ error: 'Failed to update stock count period' });
      }
    }
  );

  // Snapshot current inventory into a period (creates count items with systemQty)
  router.post('/stock-counts/:id/snapshot',
    requireDepartmentScope('warehouse'),
    requireManagementLevel(20),
    async (req, res) => {
      try {
        const { id } = req.params;
        const period = await db.get('SELECT * FROM stock_count_periods WHERE id = ?', [id]);
        if (!period) return res.status(404).json({ error: 'Stock count period not found' });
        if (period.status === 'completed' || period.status === 'cancelled') {
          return res.status(400).json({ error: `Cannot snapshot a ${period.status} period` });
        }
        const access = await getWarehouseAccess(req);
        if (access.deptIds !== null && !access.deptIds.includes(period.departmentId)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        const items = await db.all(
          `SELECT productCode, productName, quantity, unit, warehouseLocation
           FROM inventory WHERE departmentId = ?
           ${period.location ? 'AND warehouseLocation LIKE ?' : ''}
           ORDER BY productName ASC`,
          period.location ? [period.departmentId, `%${period.location}%`] : [period.departmentId]
        );
        let added = 0;
        for (const item of items) {
          const exists = await db.get(
            'SELECT id FROM stock_count_items WHERE periodId = ? AND productCode = ?',
            [id, item.productCode]
          );
          if (exists) continue;
          await db.run(
            `INSERT INTO stock_count_items
             (id, periodId, productCode, productName, systemQty, unit, status)
             VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
            [randomUUID(), id, item.productCode, item.productName, item.quantity, item.unit || 'pcs']
          );
          added++;
        }
        res.json({ success: true, added, total: items.length });
      } catch (error) {
        console.error('Error snapshotting stock count:', error);
        res.status(500).json({ error: 'Failed to snapshot stock count' });
      }
    }
  );

  router.get('/stock-counts/:id/items',
    requireDepartmentScope('warehouse'),
    async (req, res) => {
      try {
        const { id } = req.params;
        const period = await db.get('SELECT * FROM stock_count_periods WHERE id = ?', [id]);
        if (!period) return res.status(404).json({ error: 'Stock count period not found' });
        const access = await getWarehouseAccess(req);
        const allowed = access.deptIds === null
          || access.deptIds.includes(period.departmentId)
          || period.createdBy === access.userId
          || period.assignedTo === access.userId;
        if (!allowed) return res.status(403).json({ error: 'Forbidden' });
        const items = await db.all(
          `SELECT i.*, u.name AS resolvedByName
           FROM stock_count_items i
           LEFT JOIN users u ON i.resolvedBy = u.id
           WHERE i.periodId = ?
           ORDER BY i.productName ASC`,
          [id]
        );
        res.json({ period, items });
      } catch (error) {
        console.error('Error fetching stock count items:', error);
        res.status(500).json({ error: 'Failed to fetch stock count items' });
      }
    }
  );

  // Staff records counted quantity
  router.patch('/stock-counts/:periodId/items/:itemId/count',
    requireDepartmentScope('warehouse'),
    async (req, res) => {
      try {
        const { periodId, itemId } = req.params;
        const { countedQty } = req.body;
        if (countedQty === undefined || countedQty === null || Number.isNaN(Number(countedQty)) || Number(countedQty) < 0) {
          return res.status(400).json({ error: 'countedQty must be a number >= 0' });
        }
        const period = await db.get('SELECT * FROM stock_count_periods WHERE id = ?', [periodId]);
        if (!period) return res.status(404).json({ error: 'Stock count period not found' });
        if (period.status === 'completed' || period.status === 'cancelled') {
          return res.status(400).json({ error: `Cannot count items in a ${period.status} period` });
        }
        const access = await getWarehouseAccess(req);
        const allowed = access.deptIds === null
          || access.deptIds.includes(period.departmentId)
          || period.createdBy === access.userId
          || period.assignedTo === access.userId;
        if (!allowed) return res.status(403).json({ error: 'Forbidden' });
        const item = await db.get('SELECT * FROM stock_count_items WHERE id = ? AND periodId = ?', [itemId, periodId]);
        if (!item) return res.status(404).json({ error: 'Stock count item not found' });
        if (item.status === 'resolved') {
          return res.status(400).json({ error: 'Item already resolved' });
        }
        await db.run(
          `UPDATE stock_count_items SET countedQty = ?, status = 'counted', updatedAt = ? WHERE id = ?`,
          [Number(countedQty), new Date().toISOString(), itemId]
        );
        res.json({ success: true });
      } catch (error) {
        console.error('Error recording counted quantity:', error);
        res.status(500).json({ error: 'Failed to record counted quantity' });
      }
    }
  );

  // Manager resolves a variance (Biên bản xử lý thừa/thiếu)
  router.patch('/stock-counts/:periodId/items/:itemId/resolve',
    requireDepartmentScope('warehouse'),
    requireManagementLevel(20),
    async (req, res) => {
      try {
        const { periodId, itemId } = req.params;
        const { resolution } = req.body;
        if (!resolution || !String(resolution).trim()) {
          return res.status(400).json({ error: 'resolution is required' });
        }
        const period = await db.get('SELECT * FROM stock_count_periods WHERE id = ?', [periodId]);
        if (!period) return res.status(404).json({ error: 'Stock count period not found' });
        const access = await getWarehouseAccess(req);
        if (access.deptIds !== null && !access.deptIds.includes(period.departmentId)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        const item = await db.get('SELECT * FROM stock_count_items WHERE id = ? AND periodId = ?', [itemId, periodId]);
        if (!item) return res.status(404).json({ error: 'Stock count item not found' });
        await db.run(
          `UPDATE stock_count_items SET status = 'resolved', resolution = ?, resolvedBy = ?, updatedAt = ? WHERE id = ?`,
          [String(resolution).trim(), access.userId, new Date().toISOString(), itemId]
        );
        res.json({ success: true });
      } catch (error) {
        console.error('Error resolving variance:', error);
        res.status(500).json({ error: 'Failed to resolve variance' });
      }
    }
  );

  // ============================================================
  // GET /api/warehouse/variances - Biên bản thừa/thiếu (counted != system)
  // ============================================================
  router.get('/variances',
    requireDepartmentScope('warehouse'),
    async (req, res) => {
      try {
        const access = await getWarehouseAccess(req);
        if (access.scope === 'none') return res.json([]);

        let condition = '1=1';
        let params: any[] = [];
        if (access.deptIds !== null) {
          if (access.ownOnly) {
            condition = '(p.createdBy = ? OR p.assignedTo = ?)';
            params = [access.userId, access.userId];
          } else {
            if (access.deptIds.length === 0) return res.json([]);
            condition = `p.departmentId IN (${inPlaceholders(access.deptIds)})`;
            params = access.deptIds;
          }
        }
        const month = String(req.query.month || '');
        if (/^\d{4}-\d{2}$/.test(month)) {
          condition += ' AND p.month = ?';
          params.push(month);
        }
        const unresolvedOnly = String(req.query.unresolved || '') === '1';
        const rows = await db.all(
          `SELECT i.*, p.code AS periodCode, p.month, p.location AS periodLocation,
                  p.status AS periodStatus, u.name AS resolvedByName,
                  (COALESCE(i.countedQty, 0) - i.systemQty) AS variance
           FROM stock_count_items i
           JOIN stock_count_periods p ON i.periodId = p.id
           LEFT JOIN users u ON i.resolvedBy = u.id
           WHERE ${condition}
             AND i.countedQty IS NOT NULL
             AND i.countedQty != i.systemQty
             ${unresolvedOnly ? "AND i.status != 'resolved'" : ''}
           ORDER BY ABS(COALESCE(i.countedQty, 0) - i.systemQty) DESC`,
          params
        );
        res.json(rows);
      } catch (error) {
        console.error('Error fetching variances:', error);
        res.status(500).json({ error: 'Failed to fetch variances' });
      }
    }
  );

  // ============================================================
  // GET /api/warehouse/locations - Vị trí kho (occupancy by location)
  // ============================================================
  // ============================================================
  // GET /api/warehouse/locations - Vị trí kho (master + occupancy)
  // Returns master locations (even empty ones) plus legacy free-text buckets.
  // ============================================================
  router.get('/locations',
    requireDepartmentScope('warehouse'),
    async (req, res) => {
      try {
        const access = await getWarehouseAccess(req);
        if (access.scope === 'none') return res.json([]);

        let deptCondition = '1=1';
        let deptParams: any[] = [];
        if (access.deptIds !== null) {
          if (access.deptIds.length === 0) return res.json([]);
          deptCondition = `departmentId IN (${inPlaceholders(access.deptIds)})`;
          deptParams = access.deptIds;
        }
        // Master locations with occupancy (inventory matched by location code)
        const master = await db.all(
          `SELECT l.id, l.code, l.name, l.type, l.parentId, p.code AS parentCode,
                  COUNT(i.id) AS itemCount,
                  COALESCE(SUM(i.quantity), 0) AS totalQuantity,
                  SUM(CASE WHEN i.minStockLevel > 0 AND i.quantity < i.minStockLevel THEN 1 ELSE 0 END) AS alertCount
           FROM warehouse_locations l
           LEFT JOIN warehouse_locations p ON l.parentId = p.id
           LEFT JOIN inventory i ON i.warehouseLocation = l.code
             AND (${deptCondition.replace(/departmentId/g, 'i.departmentId')})
           WHERE ${deptCondition.replace(/departmentId/g, 'l.departmentId')}
           GROUP BY l.id
           ORDER BY l.code ASC`,
          [...deptParams, ...deptParams]
        );
        // Legacy free-text locations not present in master (gradual migration, no data loss)
        const masterCodes = master.map((m: any) => m.code);
        let legacyCondition = `i.warehouseLocation IS NOT NULL AND i.warehouseLocation != ''`;
        let legacyParams: any[] = [];
        if (masterCodes.length > 0) {
          legacyCondition += ` AND i.warehouseLocation NOT IN (${inPlaceholders(masterCodes)})`;
          legacyParams.push(...masterCodes);
        }
        if (access.deptIds !== null) {
          legacyCondition += ` AND i.departmentId IN (${inPlaceholders(access.deptIds)})`;
          legacyParams.push(...access.deptIds);
        }
        const legacy = await db.all(
          `SELECT NULL AS id, i.warehouseLocation AS code,
                  i.warehouseLocation AS name, 'legacy' AS type, NULL AS parentId, NULL AS parentCode,
                  COUNT(*) AS itemCount,
                  SUM(i.quantity) AS totalQuantity,
                  SUM(CASE WHEN i.minStockLevel > 0 AND i.quantity < i.minStockLevel THEN 1 ELSE 0 END) AS alertCount
           FROM inventory i
           WHERE ${legacyCondition}
           GROUP BY i.warehouseLocation
           ORDER BY itemCount DESC`,
          legacyParams
        );
        // Unassigned bucket
        let unassignedCondition = `(i.warehouseLocation IS NULL OR i.warehouseLocation = '')`;
        let unassignedParams: any[] = [];
        if (access.deptIds !== null) {
          unassignedCondition += ` AND i.departmentId IN (${inPlaceholders(access.deptIds)})`;
          unassignedParams.push(...access.deptIds);
        }
        const unassigned = await db.all(
          `SELECT COUNT(*) AS itemCount, COALESCE(SUM(i.quantity), 0) AS totalQuantity,
                  SUM(CASE WHEN i.minStockLevel > 0 AND i.quantity < i.minStockLevel THEN 1 ELSE 0 END) AS alertCount
           FROM inventory i
           WHERE ${unassignedCondition}`,
          unassignedParams
        );
        res.json({ locations: [...master, ...legacy], unassigned: unassigned[0] || { itemCount: 0, totalQuantity: 0, alertCount: 0 } });
      } catch (error) {
        console.error('Error fetching locations:', error);
        res.status(500).json({ error: 'Failed to fetch locations' });
      }
    }
  );

  const VALID_LOCATION_TYPES = ['warehouse', 'zone', 'rack', 'bin'];

  // POST /api/warehouse/locations - Thêm kho / vị trí (level 20+)
  router.post('/locations',
    requireDepartmentScope('warehouse'),
    requireManagementLevel(20),
    async (req, res) => {
      try {
        const access = await getWarehouseAccess(req);
        if (access.scope === 'none') return res.status(403).json({ error: 'Forbidden' });
        const { code, name, type = 'zone', parentId, notes } = req.body;
        if (!code || !String(code).trim() || !name || !String(name).trim()) {
          return res.status(400).json({ error: 'code and name are required' });
        }
        if (!VALID_LOCATION_TYPES.includes(type)) {
          return res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_LOCATION_TYPES.join(', ')}` });
        }
        const cleanCode = String(code).trim();
        const existing = await db.get('SELECT id FROM warehouse_locations WHERE code = ?', [cleanCode]);
        if (existing) {
          return res.status(400).json({ error: `Mã vị trí '${cleanCode}' đã tồn tại` });
        }
        if (parentId) {
          const parent = await db.get('SELECT id FROM warehouse_locations WHERE id = ?', [parentId]);
          if (!parent) return res.status(400).json({ error: 'Parent location not found' });
        }
        const departmentId = req.user?.primaryDepartmentId || 'dept-kho';
        if (access.deptIds !== null && !access.deptIds.includes(departmentId)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        const id = randomUUID();
        await db.run(
          `INSERT INTO warehouse_locations
           (id, code, name, type, parentId, departmentId, notes, createdBy)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, cleanCode, String(name).trim(), type, parentId || null, departmentId, notes || null, access.userId]
        );
        res.json({ id, code: cleanCode, success: true });
      } catch (error) {
        console.error('Error creating location:', error);
        res.status(500).json({ error: 'Failed to create location' });
      }
    }
  );

  // PATCH /api/warehouse/locations/:id - Sửa kho / vị trí (level 20+)
  router.patch('/locations/:id',
    requireDepartmentScope('warehouse'),
    requireManagementLevel(20),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { name, type, parentId, notes, isActive } = req.body;
        const loc = await db.get('SELECT * FROM warehouse_locations WHERE id = ?', [id]);
        if (!loc) return res.status(404).json({ error: 'Location not found' });
        const access = await getWarehouseAccess(req);
        if (access.deptIds !== null && !access.deptIds.includes(loc.departmentId)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        if (type !== undefined && !VALID_LOCATION_TYPES.includes(type)) {
          return res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_LOCATION_TYPES.join(', ')}` });
        }
        if (parentId !== undefined && parentId !== null) {
          if (parentId === id) return res.status(400).json({ error: 'Location cannot be its own parent' });
          const parent = await db.get('SELECT id FROM warehouse_locations WHERE id = ?', [parentId]);
          if (!parent) return res.status(400).json({ error: 'Parent location not found' });
        }
        await db.run(
          `UPDATE warehouse_locations
           SET name = ?, type = ?, parentId = ?, notes = ?,
               isActive = ?, updatedAt = ?
           WHERE id = ?`,
          [
            name !== undefined ? String(name).trim() : loc.name,
            type !== undefined ? type : loc.type,
            parentId !== undefined ? parentId : loc.parentId,
            notes !== undefined ? notes : loc.notes,
            isActive !== undefined ? (isActive ? 1 : 0) : loc.isActive,
            new Date().toISOString(), id,
          ]
        );
        res.json({ success: true });
      } catch (error) {
        console.error('Error updating location:', error);
        res.status(500).json({ error: 'Failed to update location' });
      }
    }
  );

  // DELETE /api/warehouse/locations/:id - Xóa vị trí trống (level 20+)
  router.delete('/locations/:id',
    requireDepartmentScope('warehouse'),
    requireManagementLevel(20),
    async (req, res) => {
      try {
        const { id } = req.params;
        const loc = await db.get('SELECT * FROM warehouse_locations WHERE id = ?', [id]);
        if (!loc) return res.status(404).json({ error: 'Location not found' });
        const access = await getWarehouseAccess(req);
        if (access.deptIds !== null && !access.deptIds.includes(loc.departmentId)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        const used = await db.get(
          'SELECT COUNT(*) AS c FROM inventory WHERE warehouseLocation = ?',
          [loc.code]
        );
        if (used && Number(used.c) > 0) {
          return res.status(400).json({ error: `Vị trí '${loc.code}' còn ${used.c} mặt hàng, hãy chuyển hàng đi trước khi xóa` });
        }
        const hasChildren = await db.get(
          'SELECT COUNT(*) AS c FROM warehouse_locations WHERE parentId = ?',
          [id]
        );
        if (hasChildren && Number(hasChildren.c) > 0) {
          return res.status(400).json({ error: `Vị trí '${loc.code}' còn ${hasChildren.c} vị trí con` });
        }
        await db.run('DELETE FROM warehouse_locations WHERE id = ?', [id]);
        res.json({ success: true });
      } catch (error) {
        console.error('Error deleting location:', error);
        res.status(500).json({ error: 'Failed to delete location' });
      }
    }
  );

  // PATCH /api/warehouse/inventory/:id/location - Xếp hàng vào vị trí (in-scope staff+)
  router.patch('/inventory/:id/location',
    requireDepartmentScope('warehouse'),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { warehouseLocation } = req.body;
        const item = await db.get('SELECT * FROM inventory WHERE id = ?', [id]);
        if (!item) return res.status(404).json({ error: 'Inventory item not found' });
        const access = await getWarehouseAccess(req);
        const inScope = access.deptIds === null
          || (item.departmentId && access.deptIds.includes(item.departmentId));
        if (!inScope) return res.status(403).json({ error: 'Forbidden' });
        const code = warehouseLocation === null || warehouseLocation === undefined
          ? null
          : String(warehouseLocation).trim() || null;
        if (code) {
          const loc = await db.get('SELECT id, departmentId FROM warehouse_locations WHERE code = ?', [code]);
          if (!loc) {
            return res.status(400).json({ error: `Vị trí '${code}' không tồn tại trong danh mục` });
          }
          if (access.deptIds !== null && !access.deptIds.includes(loc.departmentId)) {
            return res.status(403).json({ error: 'Forbidden' });
          }
        }
        await db.run(
          `UPDATE inventory SET warehouseLocation = ?, updatedAt = ? WHERE id = ?`,
          [code, new Date().toISOString(), id]
        );
        res.json({ success: true });
      } catch (error) {
        console.error('Error assigning location:', error);
        res.status(500).json({ error: 'Failed to assign location' });
      }
    }
  );

  // ============================================================
  // GET /api/warehouse/report - Báo cáo phòng (?month=YYYY-MM)
  // ============================================================
  router.get('/report',
    requireDepartmentScope('warehouse'),
    async (req, res) => {
      try {
        const access = await getWarehouseAccess(req);
        if (access.scope === 'none') {
          return res.json({ scope: 'none', byType: [], topIn: [], topOut: [], byStatus: [], month: null });
        }
        const monthParam = /^\d{4}-\d{2}$/.test(String(req.query.month || ''))
          ? String(req.query.month)
          : new Date().toISOString().slice(0, 7);
        const [mYear, mMonth] = monthParam.split('-').map(Number);
        const monthStart = `${monthParam}-01`;
        const monthEnd = new Date(Date.UTC(mYear, mMonth, 1)).toISOString().slice(0, 10);

        let condition = '1=1';
        let params: any[] = [];
        if (access.deptIds !== null) {
          if (access.ownOnly) {
            condition = '(wt.requestedBy = ? OR wt.assignedTo = ?)';
            params = [access.userId, access.userId];
          } else {
            if (access.deptIds.length === 0) {
              return res.json({ scope: access.scope, byType: [], topIn: [], topOut: [], byStatus: [], month: monthParam });
            }
            condition = `wt.departmentId IN (${inPlaceholders(access.deptIds)})`;
            params = access.deptIds;
          }
        }

        const byType = await db.all(
          `SELECT wt.type, COUNT(*) AS count, SUM(wt.quantity) AS totalQty
           FROM warehouse_transactions wt
           WHERE ${condition} AND wt.createdAt >= ? AND wt.createdAt < ?
           GROUP BY wt.type`,
          [...params, monthStart, monthEnd]
        );
        const byStatus = await db.all(
          `SELECT wt.status, COUNT(*) AS count
           FROM warehouse_transactions wt
           WHERE ${condition} AND wt.createdAt >= ? AND wt.createdAt < ?
           GROUP BY wt.status`,
          [...params, monthStart, monthEnd]
        );
        const topIn = await db.all(
          `SELECT wt.productCode, wt.productName, SUM(wt.quantity) AS totalQty, COUNT(*) AS count
           FROM warehouse_transactions wt
           WHERE ${condition} AND wt.type = 'IN' AND wt.createdAt >= ? AND wt.createdAt < ?
           GROUP BY wt.productCode, wt.productName
           ORDER BY totalQty DESC LIMIT 10`,
          [...params, monthStart, monthEnd]
        );
        const topOut = await db.all(
          `SELECT wt.productCode, wt.productName, SUM(wt.quantity) AS totalQty, COUNT(*) AS count
           FROM warehouse_transactions wt
           WHERE ${condition} AND wt.type = 'OUT' AND wt.createdAt >= ? AND wt.createdAt < ?
           GROUP BY wt.productCode, wt.productName
           ORDER BY totalQty DESC LIMIT 10`,
          [...params, monthStart, monthEnd]
        );
        res.json({ scope: access.scope, month: monthParam, byType, byStatus, topIn, topOut });
      } catch (error) {
        console.error('Error fetching warehouse report:', error);
        res.status(500).json({ error: 'Failed to fetch warehouse report' });
      }
    }
  );

  // ============================================================
  // Inventory lots (Tra cứu tồn kho theo lô: Số lô, Hạn sử dụng)
  // ============================================================
  router.get('/lots',
    requireDepartmentScope('warehouse'),
    async (req, res) => {
      try {
        const access = await getWarehouseAccess(req);
        if (access.scope === 'none') return res.json([]);

        const conditions: string[] = [];
        const params: any[] = [];
        if (access.deptIds !== null) {
          if (access.ownOnly) {
            conditions.push('(l.createdBy = ?)');
            params.push(access.userId);
          } else {
            if (access.deptIds.length === 0) return res.json([]);
            conditions.push(`l.departmentId IN (${inPlaceholders(access.deptIds)})`);
            params.push(...access.deptIds);
          }
        }
        const search = String(req.query.search || '').trim();
        if (search) {
          conditions.push('(l.productCode LIKE ? OR l.productName LIKE ? OR l.lotCode LIKE ?)');
          params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        const location = String(req.query.location || '').trim();
        if (location) {
          conditions.push('l.locationCode = ?');
          params.push(location);
        }
        const expiring = String(req.query.expiring || '');
        if (expiring === 'expired') {
          conditions.push('l.expiryDate IS NOT NULL AND l.expiryDate < CURDATE()');
        } else if (expiring === 'soon') {
          conditions.push('l.expiryDate IS NOT NULL AND l.expiryDate >= CURDATE() AND l.expiryDate <= DATE_ADD(CURDATE(), INTERVAL 90 DAY)');
        }
        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const rows = await db.all(
          `SELECT l.*, u.name AS createdByName,
                  CASE WHEN l.expiryDate IS NULL THEN 'none'
                       WHEN l.expiryDate < CURDATE() THEN 'expired'
                       WHEN l.expiryDate <= DATE_ADD(CURDATE(), INTERVAL 90 DAY) THEN 'soon'
                       ELSE 'ok' END AS expiryStatus
           FROM inventory_lots l
           LEFT JOIN users u ON l.createdBy = u.id
           ${where}
           ORDER BY l.expiryDate IS NULL, l.expiryDate ASC, l.createdAt DESC`,
          params
        );
        res.json(rows);
      } catch (error) {
        console.error('Error fetching lots:', error);
        res.status(500).json({ error: 'Failed to fetch lots' });
      }
    }
  );

  router.post('/lots',
    requireDepartmentScope('warehouse'),
    async (req, res) => {
      try {
        const access = await getWarehouseAccess(req);
        if (access.scope === 'none') return res.status(403).json({ error: 'Forbidden' });
        const { productCode, productName, lotCode, expiryDate, quantity, unit = 'pcs', locationCode, notes } = req.body;
        if (!productCode || !productName || !lotCode || quantity === undefined) {
          return res.status(400).json({ error: 'productCode, productName, lotCode and quantity are required' });
        }
        if (Number.isNaN(Number(quantity)) || Number(quantity) < 0) {
          return res.status(400).json({ error: 'quantity must be a number >= 0' });
        }
        if (expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
          return res.status(400).json({ error: 'expiryDate must be YYYY-MM-DD' });
        }
        const departmentId = req.user?.primaryDepartmentId || 'dept-kho';
        if (access.deptIds !== null && !access.ownOnly && !access.deptIds.includes(departmentId)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        if (locationCode) {
          const loc = await db.get('SELECT id FROM warehouse_locations WHERE code = ?', [locationCode]);
          if (!loc) return res.status(400).json({ error: `Vị trí '${locationCode}' không tồn tại` });
        }
        const id = randomUUID();
        await db.run(
          `INSERT INTO inventory_lots
           (id, productCode, productName, lotCode, expiryDate, quantity, unit, locationCode, departmentId, notes, createdBy)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, productCode, productName, lotCode, expiryDate || null, Number(quantity), unit, locationCode || null, departmentId, notes || null, access.userId]
        );
        res.json({ id, success: true });
      } catch (error) {
        console.error('Error creating lot:', error);
        res.status(500).json({ error: 'Failed to create lot' });
      }
    }
  );

  router.patch('/lots/:id',
    requireDepartmentScope('warehouse'),
    async (req, res) => {
      try {
        const { id } = req.params;
        const lot = await db.get('SELECT * FROM inventory_lots WHERE id = ?', [id]);
        if (!lot) return res.status(404).json({ error: 'Lot not found' });
        const access = await getWarehouseAccess(req);
        const allowed = access.deptIds === null
          || access.deptIds.includes(lot.departmentId)
          || lot.createdBy === access.userId;
        if (!allowed) return res.status(403).json({ error: 'Forbidden' });
        const { quantity, expiryDate, locationCode, notes } = req.body;
        if (quantity !== undefined && (Number.isNaN(Number(quantity)) || Number(quantity) < 0)) {
          return res.status(400).json({ error: 'quantity must be a number >= 0' });
        }
        if (expiryDate !== undefined && expiryDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
          return res.status(400).json({ error: 'expiryDate must be YYYY-MM-DD' });
        }
        await db.run(
          `UPDATE inventory_lots
           SET quantity = ?, expiryDate = ?, locationCode = ?, notes = ?, updatedAt = ?
           WHERE id = ?`,
          [
            quantity !== undefined ? Number(quantity) : lot.quantity,
            expiryDate !== undefined ? expiryDate : lot.expiryDate,
            locationCode !== undefined ? (locationCode || null) : lot.locationCode,
            notes !== undefined ? notes : lot.notes,
            new Date().toISOString(), id,
          ]
        );
        res.json({ success: true });
      } catch (error) {
        console.error('Error updating lot:', error);
        res.status(500).json({ error: 'Failed to update lot' });
      }
    }
  );

  router.delete('/lots/:id',
    requireDepartmentScope('warehouse'),
    requireManagementLevel(20),
    async (req, res) => {
      try {
        const { id } = req.params;
        const lot = await db.get('SELECT * FROM inventory_lots WHERE id = ?', [id]);
        if (!lot) return res.status(404).json({ error: 'Lot not found' });
        const access = await getWarehouseAccess(req);
        if (access.deptIds !== null && !access.deptIds.includes(lot.departmentId)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        await db.run('DELETE FROM inventory_lots WHERE id = ?', [id]);
        res.json({ success: true });
      } catch (error) {
        console.error('Error deleting lot:', error);
        res.status(500).json({ error: 'Failed to delete lot' });
      }
    }
  );

  // ============================================================
  // Product combos (Tra cứu tồn kho combo hàng hóa)
  // ============================================================
  router.get('/combos',
    requireDepartmentScope('warehouse'),
    async (req, res) => {
      try {
        const access = await getWarehouseAccess(req);
        if (access.scope === 'none') return res.json([]);

        let condition = '1=1';
        let params: any[] = [];
        if (access.deptIds !== null) {
          if (access.deptIds.length === 0) return res.json([]);
          condition = `c.departmentId IN (${inPlaceholders(access.deptIds)})`;
          params = access.deptIds;
        }
        const search = String(req.query.search || '').trim();
        if (search) {
          condition += ' AND (c.code LIKE ? OR c.name LIKE ?)';
          params.push(`%${search}%`, `%${search}%`);
        }
        const combos = await db.all(
          `SELECT c.*, u.name AS createdByName,
                  (SELECT COUNT(*) FROM product_combo_items i WHERE i.comboId = c.id) AS componentCount
           FROM product_combos c
           LEFT JOIN users u ON c.createdBy = u.id
           WHERE ${condition}
           ORDER BY c.code ASC`,
          params
        );
        // Stock on hand per product (scoped) to compute assemblable sets
        const stockRows = await db.all(
          `SELECT productCode, SUM(quantity) AS qty FROM inventory
           WHERE ${access.deptIds !== null ? `departmentId IN (${inPlaceholders(access.deptIds)})` : '1=1'}
           GROUP BY productCode`,
          access.deptIds !== null ? access.deptIds : []
        );
        const stock = new Map(stockRows.map((r: any) => [r.productCode, Number(r.qty || 0)]));
        for (const combo of combos) {
          const items = await db.all(
            'SELECT * FROM product_combo_items WHERE comboId = ? ORDER BY productName ASC',
            [combo.id]
          );
          combo.items = items;
          combo.assemblable = items.length === 0 ? 0 : Math.min(
            ...items.map((it: any) => Math.floor((stock.get(it.productCode) || 0) / Math.max(Number(it.quantity) || 1, 0.000001)))
          );
        }
        res.json(combos);
      } catch (error) {
        console.error('Error fetching combos:', error);
        res.status(500).json({ error: 'Failed to fetch combos' });
      }
    }
  );

  router.post('/combos',
    requireDepartmentScope('warehouse'),
    requireManagementLevel(20),
    async (req, res) => {
      try {
        const access = await getWarehouseAccess(req);
        if (access.scope === 'none') return res.status(403).json({ error: 'Forbidden' });
        const { code, name, unit = 'set', notes, items = [] } = req.body;
        if (!code || !String(code).trim() || !name || !String(name).trim()) {
          return res.status(400).json({ error: 'code and name are required' });
        }
        if (!Array.isArray(items) || items.length === 0) {
          return res.status(400).json({ error: 'at least one component item is required' });
        }
        for (const it of items) {
          if (!it.productCode || !it.productName || it.quantity === undefined || Number(it.quantity) <= 0) {
            return res.status(400).json({ error: 'each item needs productCode, productName and quantity > 0' });
          }
        }
        const cleanCode = String(code).trim();
        const existing = await db.get('SELECT id FROM product_combos WHERE code = ?', [cleanCode]);
        if (existing) return res.status(400).json({ error: `Mã combo '${cleanCode}' đã tồn tại` });
        const departmentId = req.user?.primaryDepartmentId || 'dept-kho';
        if (access.deptIds !== null && !access.deptIds.includes(departmentId)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        const id = randomUUID();
        await db.run(
          `INSERT INTO product_combos (id, code, name, unit, departmentId, notes, createdBy)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, cleanCode, String(name).trim(), unit, departmentId, notes || null, access.userId]
        );
        for (const it of items) {
          await db.run(
            `INSERT INTO product_combo_items (id, comboId, productCode, productName, quantity, unit)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [randomUUID(), id, it.productCode, it.productName, Number(it.quantity), it.unit || 'pcs']
          );
        }
        res.json({ id, code: cleanCode, success: true });
      } catch (error) {
        console.error('Error creating combo:', error);
        res.status(500).json({ error: 'Failed to create combo' });
      }
    }
  );

  router.delete('/combos/:id',
    requireDepartmentScope('warehouse'),
    requireManagementLevel(20),
    async (req, res) => {
      try {
        const { id } = req.params;
        const combo = await db.get('SELECT * FROM product_combos WHERE id = ?', [id]);
        if (!combo) return res.status(404).json({ error: 'Combo not found' });
        const access = await getWarehouseAccess(req);
        if (access.deptIds !== null && !access.deptIds.includes(combo.departmentId)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        await db.run('DELETE FROM product_combos WHERE id = ?', [id]);
        res.json({ success: true });
      } catch (error) {
        console.error('Error deleting combo:', error);
        res.status(500).json({ error: 'Failed to delete combo' });
      }
    }
  );

  return router;
}
