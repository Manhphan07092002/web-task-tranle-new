import { notificationDedupeKey } from '../utils/notificationDedupe.js';

// ===== DAILY TASK REMINDER SCHEDULER (08:00 Mon–Fri VN) =====
export function scheduleDailyTaskReminder(db: any) {
  const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

  const checkAndNotifyDailyTasks = async () => {
    const nowVN = new Date(Date.now() + VN_OFFSET_MS);
    const dayOfWeek = nowVN.getUTCDay();
    const hours = nowVN.getUTCHours();
    const minutes = nowVN.getUTCMinutes();

    if (dayOfWeek === 0 || dayOfWeek === 6) return;
    if (hours !== 8 || minutes !== 0) return;

    const todayIso = `${nowVN.getUTCFullYear()}-${String(nowVN.getUTCMonth() + 1).padStart(2, '0')}-${String(nowVN.getUTCDate()).padStart(2, '0')}`;

    try {
      const tasks = await db.all(`SELECT * FROM tasks WHERE recurrence = 'Daily' AND (status IS NULL OR status != 'Done')`);
      if (!tasks || tasks.length === 0) return;

      let totalSent = 0;
      for (const task of tasks) {
        const assignees = await db.all('SELECT userId FROM task_assignees WHERE taskId = ?', [task.id]);
        const assigneeIds = assignees.map((r: any) => r.userId);
        if (assigneeIds.length === 0) continue;

        for (const userId of assigneeIds) {
          const existing = await db.get(
            `SELECT id FROM notifications WHERE userId = ? AND type = 'daily_task_reminder' AND relatedId = ? AND createdAt >= ?`,
            [userId, task.id, `${todayIso}T00:00:00.000Z`]
          );
          if (existing) continue;

          const notifId = crypto.randomUUID();
          const dueText = task.dueDate ? ` · Hạn: ${task.dueDate}` : '';
          await db.run(
            `INSERT IGNORE INTO notifications (id, userId, type, title, message, relatedId, dedupeKey, isRead, createdAt) VALUES (?, ?, 'daily_task_reminder', ?, ?, ?, ?, 0, ?)`,
            [notifId, userId, `📋 Công việc hôm nay: ${task.title}`, `Nhắc nhở công việc lặp lại hằng ngày của bạn${dueText}. Hãy cập nhật tiến độ nhé!`, task.id, notificationDedupeKey(userId, 'daily_task_reminder', `${task.id}:${todayIso}`), new Date().toISOString()]
          );
          totalSent++;
        }
      }
      if (totalSent > 0) console.log(`[Scheduler] Sent ${totalSent} daily task reminder(s) at 08:00.`);
    } catch (err) {
      console.error('[Scheduler] Daily task reminder error:', err);
    }
  };

  setInterval(checkAndNotifyDailyTasks, 60_000);
  console.log('[Scheduler] Daily task reminder scheduler started (fires Mon–Fri 08:00 VN).');
}
