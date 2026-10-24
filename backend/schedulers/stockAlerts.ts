import { MANAGEMENT_LEVELS } from '../middleware/auth.js';
import { listStockAlerts, classifyStockAlert, type StockAlertRow, type StockAlertType } from '../services/stockAlerts.js';
import { sendNotification } from '../utils/notify.js';
import { notificationDedupeKey } from '../utils/notificationDedupe.js';

interface AlertStateRow {
  productId: string;
  warehouseId: string;
  alertType: string;
  isActive: number | string;
  stateVersion: number | string;
}

interface ChangedAlert extends StockAlertRow {
  alertType: StockAlertType;
  stateVersion: number;
}

function stateKey(productId: string, warehouseId: string): string {
  return `${productId}|${warehouseId}`;
}

/**
 * Quét cảnh báo tồn và chỉ gửi notification khi cảnh báo mới xuất hiện hoặc
 * đổi mức (ví dụ LOW → OUT). State được cập nhật trong transaction để hai
 * instance scheduler không gửi trùng.
 */
export async function checkStockAlerts(db: any, now = new Date()): Promise<number> {
  if (process.env.STOCK_ALERT_NOTIFY_ENABLED === 'false') return 0;
  const alerts = await listStockAlerts(db, {});
  const alertMap = new Map<string, StockAlertRow & { alertType: StockAlertType }>();
  for (const row of alerts || []) {
    const alertType = classifyStockAlert(row);
    if (alertType) alertMap.set(stateKey(row.productId, row.warehouseId), { ...row, alertType });
  }

  const nowIso = now.toISOString();
  const changed: ChangedAlert[] = [];
  await db.run('START TRANSACTION');
  try {
    const states: AlertStateRow[] = await db.all(
      'SELECT productId, warehouseId, alertType, isActive, stateVersion FROM stock_alert_state FOR UPDATE'
    );
    const stateMap = new Map((states || []).map((row) => [stateKey(row.productId, row.warehouseId), row]));

    for (const [key, alert] of alertMap) {
      const current = stateMap.get(key);
      const currentActive = Boolean(Number(current?.isActive ?? 0));
      if (currentActive && current?.alertType === alert.alertType) continue;
      const stateVersion = Number(current?.stateVersion || 0) + 1;
      await db.run(
        `INSERT INTO stock_alert_state
           (productId, warehouseId, alertType, isActive, stateVersion, lastChangedAt)
         VALUES (?, ?, ?, 1, ?, ?)
         ON DUPLICATE KEY UPDATE alertType = VALUES(alertType), isActive = 1,
           stateVersion = VALUES(stateVersion), lastChangedAt = VALUES(lastChangedAt)`,
        [alert.productId, alert.warehouseId, alert.alertType, stateVersion, nowIso]
      );
      changed.push({ ...alert, stateVersion });
    }

    for (const state of states || []) {
      if (!Number(state.isActive)) continue;
      if (alertMap.has(stateKey(state.productId, state.warehouseId))) continue;
      await db.run(
        'UPDATE stock_alert_state SET isActive = 0, lastChangedAt = ? WHERE productId = ? AND warehouseId = ?',
        [nowIso, state.productId, state.warehouseId]
      );
    }
    await db.run('COMMIT');
  } catch (error) {
    await db.run('ROLLBACK').catch(() => undefined);
    throw error;
  }

  if (changed.length === 0) return 0;

  const byWarehouse = new Map<string, ChangedAlert[]>();
  for (const alert of changed) {
    const list = byWarehouse.get(alert.warehouseId) || [];
    list.push(alert);
    byWarehouse.set(alert.warehouseId, list);
  }

  let notified = 0;
  for (const [warehouseId, group] of byWarehouse) {
    const recipients = await db.all(
      `SELECT DISTINCT u.id
       FROM users u
       INNER JOIN user_warehouse_scopes s ON s.userId = u.id
       WHERE s.warehouseId = ? AND u.managementLevel >= ? AND u.managementLevel <> ?
         AND (u.isLocked IS NULL OR u.isLocked = 0)`,
      [warehouseId, MANAGEMENT_LEVELS.MANAGER, MANAGEMENT_LEVELS.ADMIN]
    ).catch(() => []);
    if (!recipients || recipients.length === 0) continue;

    const outCount = group.filter((row) => row.alertType === 'OUT').length;
    const lowCount = group.filter((row) => row.alertType === 'LOW').length;
    const maxCount = group.filter((row) => row.alertType === 'MAX').length;
    const names = group.slice(0, 3).map((row) => row.productName || row.productId).join(', ');
    const warehouseName = group[0].warehouseName || group[0].warehouseCode || warehouseId;
    const message = `${outCount} hết hàng, ${lowCount} dưới ngưỡng, ${maxCount} vượt Max. Ưu tiên: ${names}.`;
    const title = `⚠️ Cảnh báo tồn kho — ${warehouseName}`;
    const relatedId = `stock-alert:${warehouseId}`;
    const version = Math.max(...group.map((row) => row.stateVersion));

    for (const recipient of recipients) {
      const dedupeKey = notificationDedupeKey(recipient.id, 'stock_alert', `${relatedId}:${version}`) || undefined;
      const sent = await sendNotification(db, recipient.id, 'stock_alert', title, message, relatedId, dedupeKey);
      if (sent) notified++;
    }
  }
  return notified;
}

export function scheduleStockAlerts(db: any) {
  if (process.env.STOCK_ALERT_NOTIFY_ENABLED === 'false') return;
  const interval = Math.max(60_000, Number(process.env.STOCK_ALERT_INTERVAL_MS) || 15 * 60_000);
  const tick = async () => {
    try {
      const n = await checkStockAlerts(db);
      if (n > 0) console.info(`[Scheduler] Sent ${n} stock alert notifications.`);
    } catch (error) {
      console.error('[Scheduler] Stock alert notification error:', error);
    }
  };
  setTimeout(tick, 60_000);
  setInterval(tick, interval);
}
