import { notificationDedupeKey } from '../utils/notificationDedupe.js';

// ===== NOTE REMINDER SCHEDULER =====
export function scheduleNoteReminders(db: any) {
  const checkAndNotifyNotes = async () => {
    try {
      const now = new Date();
      const notes = await db.all('SELECT * FROM notes WHERE reminderAt IS NOT NULL AND userId IS NOT NULL');
      if (!notes || notes.length === 0) return;

      for (const note of notes) {
        const remTime = new Date(note.reminderAt);
        if (remTime > now) continue;

        const existing = await db.get(`SELECT id FROM notifications WHERE relatedId = ? AND type = 'note_reminder'`, [note.id]);
        if (existing) continue;

        const notifId = crypto.randomUUID();
        await db.run(
          `INSERT IGNORE INTO notifications (id, userId, type, title, message, relatedId, dedupeKey, isRead, createdAt) VALUES (?, ?, 'note_reminder', ?, ?, ?, ?, 0, ?)`,
          [notifId, note.userId, `📌 ${note.title || 'Ghi chú'}`, note.content ? note.content.slice(0, 100) + (note.content.length > 100 ? '...' : '') : 'Đã đến giờ nhắc nhở!', note.id, notificationDedupeKey(note.userId, 'note_reminder', note.id), new Date().toISOString()]
        );
      }
    } catch (err) {
      console.error('[Scheduler] Note reminder error:', err);
    }
  };

  setInterval(checkAndNotifyNotes, 30_000);
  checkAndNotifyNotes();
  console.log('[Scheduler] Note reminder scheduler started.');
}
