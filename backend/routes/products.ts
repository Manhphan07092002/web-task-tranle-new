import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';

const ProductBodySchema = z.object({
  name: z.string().trim().min(1).max(500),
  unit: z.string().max(100).optional(),
  origin: z.string().max(300).optional(),
  defaultPrice: z.coerce.number().finite().min(0).max(1_000_000_000_000).optional(),
  category: z.string().max(191).optional(),
  importQuantity: z.coerce.number().finite().min(0).max(1_000_000_000).optional(),
  remainingQuantity: z.coerce.number().finite().min(0).max(1_000_000_000).optional(),
  importPrice: z.coerce.number().finite().min(0).max(1_000_000_000_000).optional(),
  salePrice: z.coerce.number().finite().min(0).max(1_000_000_000_000).optional(),
  importCode: z.string().max(191).optional(),
  invoiceDate: z.string().max(40).nullable().optional(),
});
const ProductCreateSchema = z.union([ProductBodySchema, z.array(ProductBodySchema).min(1).max(100)]);

export const productRoutes = (db: any) => {
  const router = Router();

  const requireWarehousePerm = async (req: any, res: any, next: any) => {
    try {
      let perms: string[] = [];
      if (req.user?.role) {
        const roleRow = await db.get('SELECT permissions FROM roles WHERE name = ?', [req.user.role]);
        if (roleRow?.permissions) {
          try { perms = JSON.parse(roleRow.permissions); } catch (e) {}
        }
      }
      if (!perms.includes('manage_warehouse') && !perms.includes('admin_panel')) {
        return res.status(403).json({ error: 'Không có quyền quản lý kho' });
      }
      next();
    } catch (error) {
      res.status(500).json({ error: 'Lỗi server khi kiểm tra quyền' });
    }
  };

  // Lấy danh sách sản phẩm
  router.get('/', async (req, res) => {
    try {
      const products = await db.all('SELECT * FROM products ORDER BY name ASC');
      res.json(products);
    } catch (error) {
      res.status(500).json({ error: 'Lỗi server' });
    }
  });

  // Kiểm tra trùng mã nhập kho thời gian thực
  router.get('/check-code', async (req, res) => {
    try {
      const code = req.query.code ? String(req.query.code).trim() : '';
      const excludeId = req.query.excludeId ? String(req.query.excludeId).trim() : '';
      if (!code) {
        return res.json({ exists: false });
      }
      
      let query = "SELECT id, name, importCode FROM products WHERE importCode IS NOT NULL AND importCode != '' AND LOWER(importCode) = LOWER(?)";
      const params = [code];
      if (excludeId) {
        query += " AND id != ?";
        params.push(excludeId);
      }
      
      const existing = await db.get(query, params);
      if (existing) {
        return res.json({ exists: true, product: existing });
      }
      res.json({ exists: false });
    } catch (error) {
      res.status(500).json({ error: 'Lỗi server khi kiểm tra mã' });
    }
  });

  // Đề xuất mã nhập kho tiếp theo dựa trên tiền tố
  router.get('/suggest-code', async (req, res) => {
    try {
      let prefix = req.query.prefix ? String(req.query.prefix).trim() : 'NK-';
      if (!prefix) prefix = 'NK-';
      
      const products = await db.all(
        "SELECT importCode FROM products WHERE importCode IS NOT NULL AND importCode != '' AND importCode LIKE ?",
        [`${prefix}%`]
      );
      
      let maxNum = 0;
      const escapedPrefix = prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`^${escapedPrefix}(\\d+)$`, 'i');
      
      for (const p of products) {
        const code = p.importCode.trim();
        const match = code.match(regex);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxNum) {
            maxNum = num;
          }
        }
      }
      
      const nextNum = maxNum + 1;
      const suggestedCode = `${prefix}${String(nextNum).padStart(4, '0')}`;
      res.json({ suggestedCode });
    } catch (error) {
      res.status(500).json({ error: 'Lỗi server khi đề xuất mã' });
    }
  });

  // Thêm sản phẩm mới (hỗ trợ cả đơn lẻ và hàng loạt)
  router.post('/', requireWarehousePerm, validate(ProductCreateSchema), async (req, res) => {
    const isArray = Array.isArray(req.body);
    const payloads = isArray ? req.body : [req.body];

    try {
      // Validate all first
      const codesInRequest = new Set<string>();
      for (const item of payloads) {
        if (!item.name) {
          return res.status(400).json({ error: 'Tên sản phẩm là bắt buộc cho tất cả sản phẩm' });
        }
        const finalImportPrice = Number(item.importPrice) || 0;
        const finalSalePrice = Number(item.salePrice) || Number(item.defaultPrice) || 0;
        if (finalSalePrice <= finalImportPrice) {
          return res.status(400).json({ error: `Giá bán gợi ý của sản phẩm '${item.name}' không được bằng hoặc nhỏ hơn giá nhập (giá mua)!` });
        }

        const code = item.importCode ? String(item.importCode).trim() : '';
        if (code) {
          const lowerCode = code.toLowerCase();
          if (codesInRequest.has(lowerCode)) {
            return res.status(400).json({ error: `Mã nhập kho '${code}' bị trùng lặp trong danh sách thêm!` });
          }
          codesInRequest.add(lowerCode);
        }
      }

      // Check database duplicates for non-empty importCode
      if (codesInRequest.size > 0) {
        const placeholders = Array.from(codesInRequest).map(() => '?').join(',');
        const query = `SELECT name, importCode FROM products WHERE importCode IS NOT NULL AND importCode != '' AND LOWER(importCode) IN (${placeholders})`;
        const existing = await db.all(query, Array.from(codesInRequest));
        if (existing && existing.length > 0) {
          return res.status(400).json({ 
            error: `Mã nhập kho '${existing[0].importCode}' đã tồn tại trong hệ thống (sản phẩm '${existing[0].name}')!` 
          });
        }
      }

      await db.run('BEGIN TRANSACTION');

      const createdProducts = [];
      const createdAt = new Date().toISOString();

      for (const item of payloads) {
        const { name, unit, origin, defaultPrice, category, importQuantity, remainingQuantity, importPrice, salePrice, importCode, invoiceDate } = item;
        const finalImportPrice = Number(importPrice) || 0;
        const finalSalePrice = Number(salePrice) || Number(defaultPrice) || 0;
        
        const id = 'prod-' + Math.random().toString(36).substr(2, 9);
        
        await db.run(
          'INSERT INTO products (id, name, unit, origin, defaultPrice, category, importQuantity, remainingQuantity, importPrice, salePrice, importCode, invoiceDate, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [id, name, unit, origin, defaultPrice || 0, category || '', importQuantity || 0, remainingQuantity || 0, finalImportPrice, finalSalePrice, importCode || '', invoiceDate || null, createdAt]
        );

        const prod = await db.get('SELECT * FROM products WHERE id = ?', [id]);
        createdProducts.push(prod);
      }

      await db.run('COMMIT');

      if (isArray) {
        res.status(201).json(createdProducts);
      } else {
        res.status(201).json(createdProducts[0]);
      }
    } catch (error: any) {
      try {
        await db.run('ROLLBACK');
      } catch (_) {}
      if (error.code === 'SQLITE_CONSTRAINT' || error.code === 'ER_DUP_ENTRY' || error.message?.includes('UNIQUE')) {
        return res.status(400).json({ error: 'Tên sản phẩm đã tồn tại trong kho' });
      }
      res.status(500).json({ error: 'Lỗi server khi thêm sản phẩm' });
    }
  });

  // Sửa sản phẩm
  router.put('/:id', requireWarehousePerm, validate(ProductBodySchema), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, unit, origin, defaultPrice, category, importQuantity, remainingQuantity, importPrice, salePrice, importCode, invoiceDate } = req.body;
      
      if (!name) return res.status(400).json({ error: 'Tên sản phẩm là bắt buộc' });

      const finalImportPrice = Number(importPrice) || 0;
      const finalSalePrice = Number(salePrice) || Number(defaultPrice) || 0;
      if (finalSalePrice <= finalImportPrice) {
        return res.status(400).json({ error: 'Giá bán gợi ý không được bằng hoặc nhỏ hơn giá nhập (giá mua)!' });
      }

      // Check database duplicate for non-empty importCode
      const code = importCode ? String(importCode).trim() : '';
      if (code) {
        const existing = await db.get(
          "SELECT name FROM products WHERE importCode IS NOT NULL AND importCode != '' AND LOWER(importCode) = LOWER(?) AND id != ?",
          [code, id]
        );
        if (existing) {
          return res.status(400).json({ error: `Mã nhập kho '${code}' đã tồn tại trong hệ thống (sản phẩm '${existing.name}')!` });
        }
      }

      await db.run('BEGIN TRANSACTION');

      const oldProduct = await db.get('SELECT * FROM products WHERE id = ?', [id]);
      if (!oldProduct) {
        await db.run('ROLLBACK');
        return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
      }

      await db.run(
        'UPDATE products SET name = ?, unit = ?, origin = ?, defaultPrice = ?, category = ?, importQuantity = ?, remainingQuantity = ?, importPrice = ?, salePrice = ?, importCode = ?, invoiceDate = ? WHERE id = ?',
        [name, unit, origin, defaultPrice || 0, category || '', importQuantity || 0, remainingQuantity || 0, finalImportPrice, finalSalePrice, importCode || '', invoiceDate || null, id]
      );

      // Sync to active output contracts if salePrice, name, unit, or origin changed
      if (oldProduct.salePrice !== finalSalePrice || oldProduct.name !== name || oldProduct.unit !== (unit || '') || oldProduct.origin !== (origin || '')) {
        const activeContracts = await db.all(
          `SELECT id, products, vatRate FROM contracts 
           WHERE (contractType = 'output' OR contractType IS NULL) 
             AND status NOT IN ('completed', 'cancelled') 
             AND (isDeleted IS NULL OR isDeleted = 0)`
        );

        for (const contract of activeContracts) {
          let contractProducts: any[] = [];
          try {
            contractProducts = contract.products ? JSON.parse(contract.products) : [];
          } catch (e) {
            continue;
          }

          let isUpdated = false;
          if (Array.isArray(contractProducts)) {
            for (const cp of contractProducts) {
              const matchesId = cp.sourceProductId === id;
              const matchesName = cp.name && cp.name.trim().toLowerCase() === oldProduct.name.trim().toLowerCase();

              if (matchesId || matchesName) {
                if (oldProduct.name !== name) {
                  cp.name = name;
                  if (cp.sourceProductName) cp.sourceProductName = name;
                }
                if (oldProduct.unit !== (unit || '')) {
                  cp.unit = unit || '';
                }
                if (oldProduct.origin !== (origin || '')) {
                  cp.origin = origin || '';
                }
                cp.unitPrice = finalSalePrice;
                cp.total = cp.unitPrice * (Number(cp.quantity) || 0);
                isUpdated = true;
              }
            }
          }

          if (isUpdated) {
            const newPreTax = contractProducts.reduce((sum, cp) => sum + (Number(cp.total) || 0), 0);
            const totalTax = contractProducts.reduce((sum, cp) => {
              const cpVat = (cp.vatRate !== undefined && cp.vatRate !== null)
                ? Number(cp.vatRate)
                : ((contract.vatRate !== undefined && contract.vatRate !== null) ? Number(contract.vatRate) : 8);
              return sum + ((Number(cp.total) || 0) * cpVat / 100);
            }, 0);
            const newPostTax = newPreTax + totalTax;

            await db.run(
              'UPDATE contracts SET products = ?, preTaxValue = ?, postTaxValue = ? WHERE id = ?',
              [JSON.stringify(contractProducts), newPreTax, newPostTax, contract.id]
            );
          }
        }
      }

      // Sync category (invoice number), invoiceDate, importPrice (buying price), name, unit, và origin sang các hợp đồng đầu vào (input contracts)
      if (oldProduct.category !== (category || '') || oldProduct.invoiceDate !== (invoiceDate || '') || oldProduct.name !== name || oldProduct.importPrice !== finalImportPrice || oldProduct.unit !== (unit || '') || oldProduct.origin !== (origin || '')) {
        const inputContracts = await db.all(
          `SELECT id, products FROM contracts 
           WHERE contractType = 'input' 
             AND (isDeleted IS NULL OR isDeleted = 0)`
        );

        for (const contract of inputContracts) {
          let contractProducts: any[] = [];
          try {
            contractProducts = contract.products ? JSON.parse(contract.products) : [];
          } catch (e) {
            continue;
          }

          let isUpdated = false;
          if (Array.isArray(contractProducts)) {
            for (const cp of contractProducts) {
              const matchesId = cp.sourceProductId === id;
              const matchesName = cp.name && cp.name.trim().toLowerCase() === oldProduct.name.trim().toLowerCase();

              if (matchesId || matchesName) {
                if (oldProduct.name !== name) {
                  cp.name = name;
                  if (cp.sourceProductName) cp.sourceProductName = name;
                }
                if (oldProduct.unit !== (unit || '')) {
                  cp.unit = unit || '';
                }
                if (oldProduct.origin !== (origin || '')) {
                  cp.origin = origin || '';
                }
                if (oldProduct.importPrice !== finalImportPrice) {
                  cp.unitPrice = finalImportPrice; // unitPrice in input contracts is the buying price
                  cp.total = cp.unitPrice * (Number(cp.quantity) || 0);
                }
                isUpdated = true;
              }
            }
          }

          if (isUpdated) {
            const newPreTax = contractProducts.reduce((sum, cp) => sum + (Number(cp.total) || 0), 0);
            const totalTax = contractProducts.reduce((sum, cp) => {
              const cpVat = (cp.vatRate !== undefined && cp.vatRate !== null)
                ? Number(cp.vatRate)
                : 8; // default 8% VAT for input products
              return sum + ((Number(cp.total) || 0) * cpVat / 100);
            }, 0);
            const newPostTax = newPreTax + totalTax;

            await db.run(
              'UPDATE contracts SET invoiceNumber = ?, invoiceDate = ?, products = ?, preTaxValue = ?, postTaxValue = ? WHERE id = ?',
              [category || '', invoiceDate || null, JSON.stringify(contractProducts), newPreTax, newPostTax, contract.id]
            );
          }
        }
      }

      await db.run('COMMIT');

      const product = await db.get('SELECT * FROM products WHERE id = ?', [id]);
      if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
      
      res.json(product);
    } catch (error: any) {
      try {
        await db.run('ROLLBACK');
      } catch (rollbackErr) {}
      if (error.code === 'SQLITE_CONSTRAINT' || error.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ error: 'Tên sản phẩm đã tồn tại' });
      }
      res.status(500).json({ error: 'Lỗi server' });
    }
  });

  // Xóa sản phẩm
  router.delete('/:id', requireWarehousePerm, async (req, res) => {
    try {
      const { id } = req.params;
      const result = await db.run('DELETE FROM products WHERE id = ?', [id]);
      if (result.changes === 0) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Lỗi server' });
    }
  });

  return router;
};
