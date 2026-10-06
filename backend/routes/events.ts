import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const EventSchema = z.object({
  id: z.string().trim().min(1).max(191).optional(),
  title: z.string().trim().min(1).max(300),
  date: z.string().min(1).max(40).refine((value) => Number.isFinite(Date.parse(value))),
  endDate: z.string().max(40).nullable().optional().refine((value) => value == null || Number.isFinite(Date.parse(value))),
  type: z.string().trim().min(1).max(64).optional(),
  color: z.string().max(32).optional(),
  description: z.string().max(5000).optional(),
  isRecurringYearly: z.boolean().optional(),
});
const EventUpdateSchema = EventSchema.omit({ id: true });

export function eventRoutes(db: any) {
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      const events = await db.all('SELECT * FROM events ORDER BY date ASC');
      res.json(events);
    } catch (e) { res.status(500).json({ error: 'Failed to fetch events' }); }
  });

  router.post('/', requireAdmin, validate(EventSchema), async (req, res) => {
    const { id, title, date, endDate, type, color, description, isRecurringYearly } = req.body;
    if (!title?.trim() || !date) return res.status(400).json({ error: 'Tiêu đề và ngày không được trống' });
    try {
      await db.run(
        'INSERT INTO events (id, title, date, endDate, type, color, description, isRecurringYearly) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id || `evt-${Date.now()}`, title.trim(), date, endDate || null, type || 'holiday', color || '#ef4444', description || '', isRecurringYearly ? 1 : 0]
      );
      res.status(201).json({ success: true });
    } catch (e: any) { res.status(500).json({ error: 'Failed to create event' }); }
  });

  router.put('/:id', requireAdmin, validate(EventUpdateSchema), async (req, res) => {
    const { title, date, endDate, type, color, description, isRecurringYearly } = req.body;
    try {
      const existing = await db.get('SELECT id FROM events WHERE id = ?', [req.params.id]);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      await db.run(
        'UPDATE events SET title=?, date=?, endDate=?, type=?, color=?, description=?, isRecurringYearly=? WHERE id=?',
        [title, date, endDate || null, type, color, description || '', isRecurringYearly ? 1 : 0, req.params.id]
      );
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed to update event' }); }
  });

  router.delete('/:id', requireAdmin, async (req, res) => {
    try {
      await db.run('DELETE FROM events WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed to delete event' }); }
  });

  return router;
}
