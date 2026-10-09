import { Router } from 'express';
import { randomUUID } from 'crypto';
import { requireDepartmentScope, applyDepartmentFilter, requireApprovalAuthority, requireManagementLevel } from '../middleware/rbac.js';

export function warehouseRoutes(db: any) {
  const router = Router();

  // ============================================================
  // GET /api/warehouse/inventory - List inventory with department scope
  // ============================================================
  router.get('/inventory',
    requireDepartmentScope('inventory'),
    async (req, res) => {
      try {
        const user = (req as any).user;
        const rbacService = (req as any).rbacService;
        const rbacContext = (req as any).rbacContext;
        const managementLevel = user?.managementLevel ?? 10;

        // Director sees all
        if (managementLevel >= 40) {
          const inventory = await db.all(
            `SELECT * FROM inventory ORDER BY productName ASC`
          );
          return res.json(inventory);
        }
        // Admin sees nothing (business data restriction)
        if (managementLevel === 99) {
          return res.json([]);
        }
        // Manager / Deputy / Employee: filter by accessible departments
        const accessibleDepts = rbacService && rbacContext
          ? await rbacService.getAccessibleDepartments(rbacContext)
          : (user?.primaryDepartmentId ? [user.primaryDepartmentId] : []);
        if (accessibleDepts.length === 0) {
          return res.json([]);
        }
        const placeholders = accessibleDepts.map(() => '?').join(',');
        const inventory = await db.all(
          `SELECT * FROM inventory WHERE departmentId IN (${placeholders}) ORDER BY productName ASC`,
          accessibleDepts
        );

        res.json(inventory);
      } catch (error) {
        console.error('Error fetching inventory:', error);
        res.status(500).json({ error: 'Failed to fetch inventory' });
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
        maxStockLevel = 0
      } = req.body;

      if (!productCode || !productName) {
        return res.status(400).json({ error: 'Product code and name are required' });
      }

      const id = randomUUID();
      const departmentId = (req as any).user?.primaryDepartmentId || 'dept-kho';

      await db.run(
        `INSERT INTO inventory
         (id, productCode, productName, quantity, unit, warehouseLocation, minStockLevel, maxStockLevel, departmentId)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, productCode, productName, quantity, unit, warehouseLocation, minStockLevel, maxStockLevel, departmentId]
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
        maxStockLevel
      } = req.body;

      await db.run(
        `UPDATE inventory
         SET productCode = ?, productName = ?, quantity = ?, unit = ?,
             warehouseLocation = ?, minStockLevel = ?, maxStockLevel = ?,
             updatedAt = ?
         WHERE id = ?`,
        [productCode, productName, quantity, unit, warehouseLocation,
         minStockLevel, maxStockLevel, new Date().toISOString(), id]
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
        const { condition, params } = await applyDepartmentFilter(req);

        const transactions = await db.all(
          `SELECT wt.*,
                  u1.fullName as requestedByName,
                  u2.fullName as approvedByName
           FROM warehouse_transactions wt
           LEFT JOIN users u1 ON wt.requestedBy = u1.id
           LEFT JOIN users u2 ON wt.approvedBy = u2.id
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
  // POST /api/warehouse/transactions - Create warehouse transaction
  // ============================================================
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
        referenceDoc
      } = req.body;

      if (!type || !productCode || !productName || !quantity) {
        return res.status(400).json({
          error: 'Type, product code, product name, and quantity are required'
        });
      }

      const id = randomUUID();
      const transactionCode = `WH-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const departmentId = (req as any).user?.primaryDepartmentId || 'dept-kho';

      await db.run(
        `INSERT INTO warehouse_transactions
         (id, transactionCode, type, productCode, productName, quantity, unit,
          fromLocation, toLocation, requestedBy, departmentId, notes, referenceDoc, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [id, transactionCode, type, productCode, productName, quantity, unit,
         fromLocation, toLocation, (req as any).user.id, departmentId, notes, referenceDoc]
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
        if (trans.type === 'IN') {
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
            // Create new inventory item
            const newId = randomUUID();
            await db.run(
              `INSERT INTO inventory
               (id, productCode, productName, quantity, unit, warehouseLocation, departmentId)
               VALUES (?, ?, ?, ?, ?, ?, 'dept-kho')`,
              [newId, trans.productCode, trans.productName, trans.quantity, trans.unit, trans.toLocation]
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

  return router;
}
