import { Router } from 'express';

export function notificationRoutes(db: any) {
  const router = Router();

  router.get('/:userId', async (req, res) => {
    try {
      if (req.params.userId !== req.user?.id && req.user?.role !== 'Admin' && !req.user?.permissions?.includes('admin_panel')) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const notifications = await db.all('SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT 50', [req.params.userId]);
      res.json(notifications);
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  router.patch('/:id/read', async (req, res) => {
    try {
      const result = await db.run('UPDATE notifications SET isRead = 1 WHERE id = ? AND userId = ?', [req.params.id, req.user?.id]);
      if (!result.changes) return res.status(404).json({ error: 'Not found' });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  router.patch('/read-all/:userId', async (req, res) => {
    try {
      if (req.params.userId !== req.user?.id && req.user?.role !== 'Admin' && !req.user?.permissions?.includes('admin_panel')) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      await db.run('UPDATE notifications SET isRead = 1 WHERE userId = ? AND isRead = 0', [req.params.userId]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const result = await db.run('DELETE FROM notifications WHERE id = ? AND userId = ?', [req.params.id, req.user?.id]);
      if (!result.changes) return res.status(404).json({ error: 'Not found' });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  return router;
}
