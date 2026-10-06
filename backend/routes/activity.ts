import { Router } from 'express';
import { sanitizeActivityLog } from '../utils/activityPrivacy.js';

export function activityRoutes(db: any) {
  const router = Router();

  async function enrichLogs(logs: any[]) {
    const userIds = [...new Set(logs.map((l: any) => l.userId).filter((id: string) => id && id !== 'system'))];
    const userMap = new Map<string, any>();
    if (userIds.length > 0) {
      const placeholders = userIds.map((_, i) => `?`).join(', ');
      const users = await db.all(`SELECT id, name, avatar, department FROM users WHERE id IN (${placeholders})`, userIds);
      users.forEach((u: any) => userMap.set(u.id, u));
    }
    return logs.map((raw: any) => {
      const l = sanitizeActivityLog(raw);
      return ({
      ...l,
      user: l.userId === 'system'
        ? { name: 'Hệ thống', avatar: '', department: 'System' }
        : userMap.get(l.userId) || null,
      });
    });
  }

  router.get('/', async (req, res) => {
    try {
      const canViewAll = req.user?.role === 'Admin' || req.user?.permissions?.includes('admin_panel') || req.user?.permissions?.includes('view_activity_logs');
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
      const logs = canViewAll
        ? await db.all('SELECT * FROM activity_logs ORDER BY createdAt DESC LIMIT ?', [limit])
        : await db.all('SELECT * FROM activity_logs WHERE userId = ? ORDER BY createdAt DESC LIMIT ?', [req.user?.id, limit]);
      res.json(await enrichLogs(logs));
    } catch (e) { res.status(500).json({ error: 'Failed to fetch activity logs' }); }
  });

  router.get('/user/:userId', async (req, res) => {
    try {
      const canViewAll = req.user?.role === 'Admin' || req.user?.permissions?.includes('admin_panel') || req.user?.permissions?.includes('view_activity_logs');
      if (!canViewAll && req.user?.id !== req.params.userId) return res.status(403).json({ error: 'Forbidden' });
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
      const logs = await db.all(
        'SELECT * FROM activity_logs WHERE userId = ? ORDER BY createdAt DESC LIMIT ?',
        [req.params.userId, limit],
      );
      res.json(await enrichLogs(logs));
    } catch (e) { res.status(500).json({ error: 'Failed to fetch user activity logs' }); }
  });

  return router;
}
