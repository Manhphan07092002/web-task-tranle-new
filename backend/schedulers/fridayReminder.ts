import { notificationDedupeKey } from '../utils/notificationDedupe.js';

// ===== FRIDAY 16:00 REPORT REMINDER SCHEDULER =====
export function scheduleFridayReminder(db: any) {
  const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

  const checkAndNotify = async () => {
    const nowVN = new Date(Date.now() + VN_OFFSET_MS);
    const dayOfWeek = nowVN.getUTCDay();
    const hours = nowVN.getUTCHours();
    const minutes = nowVN.getUTCMinutes();
    if (dayOfWeek !== 5 || hours !== 16 || minutes !== 0) return;

    try {
      const allUsers = await db.all('SELECT u.id, u.role FROM users u');
      const allRoles = await db.all('SELECT name, permissions FROM roles');
      if (!allUsers || allUsers.length === 0) return;

      const rolePermMap = new Map<string, string[]>();
      for (const r of allRoles) {
        try { rolePermMap.set(r.name, JSON.parse(r.permissions)); } catch { rolePermMap.set(r.name, []); }
      }

      const eligibleUsers = allUsers.filter((u: any) => {
        const perms = rolePermMap.get(u.role) || [];
        return perms.includes('create_report');
      });

      const todayIso = new Date(nowVN.getUTCFullYear(), nowVN.getUTCMonth(), nowVN.getUTCDate()).toISOString();
      let notified = 0;
      for (const u of eligibleUsers) {
        const existing = await db.get(`SELECT id FROM notifications WHERE userId = ? AND type = 'report_reminder' AND createdAt >= ?`, [u.id, todayIso]);
        if (existing) continue;
        const id = crypto.randomUUID();
        await db.run(
          `INSERT IGNORE INTO notifications (id, userId, type, title, message, relatedId, dedupeKey, isRead, createdAt) VALUES (?, ?, 'report_reminder', ?, ?, NULL, ?, 0, ?)`,
          [id, u.id, '📋 Nhắc nhở: Nộp báo cáo công việc', 'Đã 16:00 Thứ 6 — Hãy hoàn thành và nộp báo cáo công việc tuần này trước khi kết thúc ngày.', notificationDedupeKey(u.id, 'report_reminder', todayIso), new Date().toISOString()]
        );
        notified++;
      }
      console.log(`[Scheduler] Sent Friday report reminders to ${notified} eligible users.`);
    } catch (err) {
      console.error('[Scheduler] Friday reminder error:', err);
    }
  };

  setInterval(checkAndNotify, 60_000);
  console.log('[Scheduler] Friday 16:00 report reminder scheduler started.');
}
