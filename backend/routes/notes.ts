import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';

const NoteBodySchema = z.object({
  id: z.string().trim().min(1).max(191).optional(),
  title: z.string().trim().min(1).max(300),
  content: z.string().max(100_000),
  color: z.string().max(50).optional(),
  reminderAt: z.string().datetime({ offset: true }).nullable().optional(),
});
const NoteUpdateSchema = NoteBodySchema.omit({ id: true }).refine((data) => Object.keys(data).length > 0);

export function noteRoutes(db: any) {
  const router = Router();

  router.get('/', async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      // Notes are private; never trust a user id supplied in the query string.
      const notes = await db.all('SELECT * FROM notes WHERE userId = ?', [req.user.id]);
      res.json(notes);
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  router.post('/', validate(NoteBodySchema), async (req, res) => {
    const { id, title, content, color, reminderAt } = req.body;
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      await db.run('INSERT INTO notes (id, title, content, color, createdAt, reminderAt, userId) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, title, content, color, new Date().toISOString(), reminderAt, req.user.id]);
      res.json({ id });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  router.put('/:id', validate(NoteUpdateSchema), async (req, res) => {
    const { title, content, color, reminderAt } = req.body;
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const result = await db.run('UPDATE notes SET title = ?, content = ?, color = ?, reminderAt = ? WHERE id = ? AND userId = ?', [title, content, color, reminderAt, req.params.id, req.user.id]);
      if (!result.changes) return res.status(404).json({ error: 'Note not found' });
      await db.run("DELETE FROM notifications WHERE relatedId = ? AND type = 'note_reminder'", [req.params.id]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  router.delete('/:id', async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const result = await db.run('DELETE FROM notes WHERE id = ? AND userId = ?', [req.params.id, req.user.id]);
      if (!result.changes) return res.status(404).json({ error: 'Note not found' });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  return router;
}
