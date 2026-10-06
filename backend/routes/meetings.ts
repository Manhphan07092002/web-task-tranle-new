import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';

const MeetingStatusSchema = z.enum(['scheduled', 'ongoing', 'completed', 'cancelled']);
const MeetingCreateSchema = z.object({
  id: z.string().trim().min(1).max(191).optional(),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000).nullable().optional(),
  startTime: z.string().datetime({ offset: true }),
  endTime: z.string().datetime({ offset: true }),
  meetingLink: z.string().max(2048).nullable().optional(),
  status: MeetingStatusSchema,
  participants: z.array(z.string().trim().min(1).max(191)).max(100).refine((ids) => new Set(ids).size === ids.length).optional(),
});
const MeetingUpdateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000).nullable().optional(),
  status: MeetingStatusSchema,
  startTime: z.string().datetime({ offset: true }),
  endTime: z.string().datetime({ offset: true }),
  participants: z.array(z.string().trim().min(1).max(191)).max(100).refine((ids) => new Set(ids).size === ids.length).optional(),
});
const MeetingSignalSchema = z.object({
  to: z.string().trim().min(1).max(200),
  type: z.enum(['status_update', 'webrtc_candidate', 'webrtc_offer', 'webrtc_answer', 'user_joined', 'user_left', 'force_mute', 'chat_message', 'reaction']),
  data: z.unknown().optional(),
});

export function meetingRoutes(db: any) {
  const router = Router();

  const canManage = (user: any) => user?.role === 'Admin' || user?.permissions?.includes('admin_panel');
  async function canAccessMeeting(id: string, user: any) {
    if (!user) return false;
    if (canManage(user)) return true;
    const meeting = await db.get('SELECT hostId FROM meetings WHERE id = ?', [id]);
    if (!meeting) return false;
    if (meeting.hostId === user.id) return true;
    const participant = await db.get('SELECT userId FROM meeting_participants WHERE meetingId = ? AND userId = ?', [id, user.id]);
    return Boolean(participant);
  }

  async function buildMeeting(m: any) {
    const parts = await db.all('SELECT userId FROM meeting_participants WHERE meetingId = ?', [m.id]);
    return { ...m, participants: parts.map((p: any) => p.userId) };
  }

  async function saveParticipants(meetingId: string, participants: string[]) {
    await db.run('DELETE FROM meeting_participants WHERE meetingId = ?', [meetingId]);
    for (const userId of participants) {
      await db.run('INSERT INTO meeting_participants (meetingId, userId) VALUES (?, ?)', [meetingId, userId]);
    }
  }

  async function areActiveUsers(userIds: string[]) {
    if (!userIds.length) return true;
    const placeholders = userIds.map(() => '?').join(', ');
    const activeUsers = await db.all(
      `SELECT id FROM users WHERE id IN (${placeholders}) AND (isLocked IS NULL OR isLocked = 0)`,
      userIds,
    );
    return activeUsers.length === userIds.length;
  }

  router.get('/', async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const meetings = canManage(req.user)
        ? await db.all('SELECT * FROM meetings')
        : await db.all('SELECT DISTINCT m.* FROM meetings m LEFT JOIN meeting_participants p ON p.meetingId = m.id WHERE m.hostId = ? OR p.userId = ?', [req.user.id, req.user.id]);
      res.json(await Promise.all(meetings.map(buildMeeting)));
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  router.get('/:id', async (req, res) => {
    try {
      const m = await db.get('SELECT * FROM meetings WHERE id = ?', [req.params.id]);
      if (!m) return res.status(404).json({ error: 'Not found' });
      if (!(await canAccessMeeting(String(req.params.id), req.user))) return res.status(403).json({ error: 'Forbidden' });
      res.json(await buildMeeting(m));
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  router.post('/', validate(MeetingCreateSchema), async (req, res) => {
    const { id, title, description, startTime, endTime, meetingLink, status, participants } = req.body;
    const meetingId = id || randomUUID();
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const invitees: string[] = [...new Set([...(participants || []), req.user.id])];
      if (!(await areActiveUsers(invitees))) return res.status(400).json({ error: 'One or more participants are unavailable' });
      await db.run(
        'INSERT INTO meetings (id, title, description, hostId, startTime, endTime, meetingLink, status, participants) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [meetingId, title, description ?? null, req.user.id, startTime, endTime, meetingLink, status, '[]'],
      );
      await saveParticipants(meetingId, invitees);
      res.status(201).json({ id: meetingId });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  router.put('/:id', validate(MeetingUpdateSchema), async (req, res) => {
    const { title, description, status, participants, startTime, endTime } = req.body;
    try {
      if (!(await canAccessMeeting(String(req.params.id), req.user))) return res.status(403).json({ error: 'Forbidden' });
      if (!canManage(req.user)) {
         const meeting = await db.get('SELECT hostId FROM meetings WHERE id = ?', [String(req.params.id)]);
        if (!meeting || meeting.hostId !== req.user?.id) return res.status(403).json({ error: 'Forbidden' });
      }
      const existingMeeting = await db.get('SELECT hostId FROM meetings WHERE id = ?', [String(req.params.id)]);
      if (!existingMeeting) return res.status(404).json({ error: 'Not found' });
      const invitees = Array.isArray(participants) ? [...new Set([...participants, existingMeeting.hostId])] : undefined;
      if (invitees && !(await areActiveUsers(invitees))) return res.status(400).json({ error: 'One or more participants are unavailable' });
      await db.run(
        'UPDATE meetings SET title=?, description=?, status=?, startTime=?, endTime=? WHERE id=?',
        [title, description ?? null, status, startTime, endTime, String(req.params.id)],
      );
      if (invitees) {
         await saveParticipants(String(req.params.id), invitees);
      }
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  // Atomic join — no more read-modify-write on JSON
  router.put('/:id/join', async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const meeting = await db.get('SELECT id, hostId FROM meetings WHERE id = ?', [req.params.id]);
      if (!meeting) return res.status(404).json({ error: 'Not found' });
      const invitation = await db.get('SELECT userId FROM meeting_participants WHERE meetingId = ? AND userId = ?', [req.params.id, req.user.id]);
      if (!invitation && meeting.hostId !== req.user.id && !canManage(req.user)) return res.status(403).json({ error: 'Meeting invitation required' });
      await db.run('INSERT OR IGNORE INTO meeting_participants (meetingId, userId) VALUES (?, ?)', [req.params.id, req.user.id]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  // Atomic leave
  router.put('/:id/leave', async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      await db.run('DELETE FROM meeting_participants WHERE meetingId = ? AND userId = ?', [req.params.id, req.user.id]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  router.delete('/:id', async (req, res) => {
    try {
      if (!(await canAccessMeeting(req.params.id, req.user))) return res.status(403).json({ error: 'Forbidden' });
      if (!canManage(req.user)) {
        const meeting = await db.get('SELECT hostId FROM meetings WHERE id = ?', [req.params.id]);
        if (!meeting || meeting.hostId !== req.user?.id) return res.status(403).json({ error: 'Forbidden' });
      }
      await db.run('DELETE FROM meeting_participants WHERE meetingId = ?', [req.params.id]);
      await db.run('DELETE FROM signals WHERE meetingId = ?', [req.params.id]);
      await db.run('DELETE FROM meetings WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  // Signals
  router.get('/:meetingId/signals', async (req, res) => {
    const { since } = req.query;
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      if (!(await canAccessMeeting(String(req.params.meetingId), req.user))) return res.status(403).json({ error: 'Forbidden' });
      const sinceValue = Number(since || 0);
      if (!Number.isFinite(sinceValue) || sinceValue < 0) return res.status(400).json({ error: 'Invalid since value' });
      const signals = await db.all(
        'SELECT * FROM signals WHERE meetingId = ? AND timestamp > ? AND (`to` = ? OR `to` = \'all\') ORDER BY timestamp ASC',
        [req.params.meetingId, sinceValue, req.user.id],
      );
      res.json(signals.map((s: any) => ({ ...s, data: JSON.parse(s.data) })));
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  router.post('/:meetingId/signals', validate(MeetingSignalSchema), async (req, res) => {
    const { to, type, data } = req.body;
    try {
      if (!(await canAccessMeeting(String(req.params.meetingId), req.user))) return res.status(403).json({ error: 'Forbidden' });
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const supportedTypes = new Set([
        'status_update', 'webrtc_candidate', 'webrtc_offer', 'webrtc_answer', 'user_joined', 'user_left',
        'force_mute', 'chat_message', 'reaction',
      ]);
      if (typeof type !== 'string' || !supportedTypes.has(type)) return res.status(400).json({ error: 'Invalid signal type' });
      if (typeof to !== 'string' || !to || to.length > 200) return res.status(400).json({ error: 'Invalid recipient' });
      let serializedData: string;
      try { serializedData = JSON.stringify(data); } catch { return res.status(400).json({ error: 'Invalid signal data' }); }
      if (serializedData === undefined || serializedData.length > 16_384) return res.status(400).json({ error: 'Invalid signal data' });

      const meeting = await db.get('SELECT hostId FROM meetings WHERE id = ?', [req.params.meetingId]);
      if (!meeting) return res.status(404).json({ error: 'Not found' });
      if (to !== 'all') {
        const recipient = await db.get('SELECT userId FROM meeting_participants WHERE meetingId = ? AND userId = ?', [req.params.meetingId, to]);
        if (!recipient && meeting.hostId !== to) return res.status(400).json({ error: 'Recipient is not a meeting participant' });
      }
      if (type === 'force_mute') {
        if (!canManage(req.user) && meeting.hostId !== req.user.id) return res.status(403).json({ error: 'Only the meeting host can moderate participants' });
        if (to === 'all' || !['mic', 'cam', 'kick'].includes(data)) return res.status(400).json({ error: 'Invalid moderation signal' });
      }
      const timestamp = Date.now();
      const id = randomUUID();
      await db.run(
        'INSERT INTO signals (id, meetingId, `from`, `to`, type, data, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, req.params.meetingId, req.user.id, to, type, serializedData, timestamp],
      );
      res.status(201).json({ id, timestamp });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
  });

  return router;
}
