import { getIO } from '../socket.js';
import { randomUUID } from 'crypto';
import { notificationDedupeKey } from './notificationDedupe.js';

export const sendNotification = async (
  db: any,
  userId: string,
  type: string,
  title: string,
  message: string,
  relatedId?: string
) => {
  try {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const dedupeKey = notificationDedupeKey(userId, type, relatedId);
    
    // 1. Insert into database
    const result = await db.run(
      'INSERT IGNORE INTO notifications (id, userId, type, title, message, relatedId, dedupeKey, isRead, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
      [id, userId, type, title, message, relatedId || null, dedupeKey, createdAt]
    );
    if (result && result.changes === 0) return;

    // 2. Emit to socket
    const io = getIO();
    io.to(userId).emit('new_notification', {
      id,
      userId,
      type,
      title,
      message,
      relatedId,
      isRead: 0,
      createdAt
    });

    // 3. Send Email Notification based on user preferences
    try {
      const user = await db.get('SELECT email, name, preferences FROM users WHERE id = ?', [userId]);
      if (user && user.email) {
        const prefs = user.preferences ? JSON.parse(user.preferences) : {};
        let shouldSendEmail = false;

        // Default is true if not explicitly set to false
        if (type.startsWith('task_') && prefs.taskNotifs !== false) shouldSendEmail = true;
        if (type.startsWith('report_') && prefs.reportNotifs !== false) shouldSendEmail = true;
        if (type.startsWith('meeting_') && prefs.meetingNotifs !== false) shouldSendEmail = true;

        if (shouldSendEmail) {
          // Fire and forget email to avoid blocking the API response
          import('../mailer.js').then(async ({ createMailer }) => {
            try {
              const mailer = createMailer(db);
              const { transporter, smtp } = await mailer.createTransporter();
              
              if (transporter && smtp.SMTP_FROM) {
                const portalUrl = process.env.VITE_API_URL || 'http://localhost:5173';
                await transporter.sendMail({
                  from: smtp.SMTP_FROM,
                  to: user.email,
                  subject: `Tran Le Tasks - ${title}`,
                  text: `Xin chào ${user.name},\n\n${message}\n\nTruy cập hệ thống: ${portalUrl}\n\nTrân trọng,\nTran Le Electricity`,
                  html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:560px;margin:0 auto;padding:24px">
                    <div style="padding:18px 20px;border-radius:16px 16px 0 0;background:#1e3a8a;color:#fff;text-align:center;font-weight:800;font-size:20px">Tran Le Electricity</div>
                    <div style="padding:24px;background:#fff;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 16px 16px">
                      <p style="margin:0 0 16px">Xin chào <strong>${user.name}</strong>,</p>
                      <p style="margin:0 0 16px">${message}</p>
                      <div style="text-align:center;margin:24px 0">
                        <a href="${portalUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Mở hệ thống</a>
                      </div>
                      <p style="margin:24px 0 0;color:#6b7280;font-size:13px;border-top:1px solid #eee;padding-top:16px">
                        Bạn nhận được email này vì bạn đang bật thông báo trong cài đặt.
                        <br/>Để tắt thông báo, hãy vào Cài đặt &gt; Thông báo.
                      </p>
                    </div>
                  </div>`
                });
                console.log(`[Notify] Sent email notification for type: ${type}`);
              }
            } catch {
              console.error('[Notify] Async email send failed.');
            }
          }).catch(() => {
            console.error('[Notify] Failed to load mailer.');
          });
        }
      }
    } catch {
      console.error('[Notify] Failed to send email notification.');
    }

  } catch {
    console.error('Failed to send notification.');
  }
};
