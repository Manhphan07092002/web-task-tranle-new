import nodemailer from 'nodemailer';
import { decrypt } from '../utils/cryptoUtils.js';
import { mailTlsOptions } from '../utils/mailTls.js';
import { createMailer } from '../mailer.js';
import { assertMailEndpointsSafe } from '../utils/mailHostSecurity.js';
import { TRANLE_WEBMAIL } from '../utils/tranleWebmail.js';

export function initMailScheduler(db: any) {
  const mailer = createMailer(db);

  // Check every 1 minute
  setInterval(async () => {
    try {
      const config = await mailer.getSystemConfig();
      const smtpHost = config.SMTP_HOST || TRANLE_WEBMAIL.host;
      const smtpPort = Number(config.SMTP_PORT || TRANLE_WEBMAIL.smtpPort);
      const smtpSecure = smtpPort === 465 || String(config.SMTP_SECURE || 'false') === 'true';

      const now = new Date().toISOString();
      const pendingEmails = await db.all(
        'SELECT * FROM scheduled_emails WHERE status = ? AND scheduledAt <= ?',
        ['pending', now]
      );

      if (!pendingEmails || pendingEmails.length === 0) return;

      for (const email of pendingEmails) {
        try {
          // MySQL wrapRow supports case-insensitive column access.
          const userId = email.userid || email.userId;
          const user = await db.get('SELECT id, name, email, mailPassword FROM users WHERE id = ?', [userId]);
          
          const mailPassRaw = user.mailPassword || user.mailpassword;
          if (!user || !mailPassRaw) {
            await db.run('UPDATE scheduled_emails SET status = ? WHERE id = ?', ['failed', email.id]);
            continue;
          }

          let mailEmail = user.email;
          let mailPass = decrypt(mailPassRaw as string);
          let targetSmtpHost = smtpHost;
          let targetSmtpPort = smtpPort;
          let targetSmtpSecure = smtpSecure;

          try {
            if (mailPass) {
              const parsed = JSON.parse(mailPass);
              if (parsed.email) mailEmail = parsed.email;
              if (parsed.password) mailPass = parsed.password;
              if (parsed.smtpHost) targetSmtpHost = parsed.smtpHost;
              if (parsed.smtpPort) {
                targetSmtpPort = Number(parsed.smtpPort);
                // User connections carry their own port, so use its TLS convention.
                targetSmtpSecure = targetSmtpPort === 465;
              }
            }
          } catch (_) { }

          await assertMailEndpointsSafe({ smtpHost: targetSmtpHost, smtpPort: targetSmtpPort });

          const transporter = nodemailer.createTransport({
            host: targetSmtpHost,
            port: targetSmtpPort,
            secure: targetSmtpSecure,
            auth: { user: mailEmail, pass: mailPass },
            tls: mailTlsOptions()
          } as any);

          const fromLabel = user.name ? `"${user.name}" <${mailEmail}>` : mailEmail;
          
          let parsedAttachments = [];
          try {
            if (email.attachments) {
              const atts = JSON.parse(email.attachments);
              parsedAttachments = atts.map((a: any) => ({
                filename: a.filename,
                content: Buffer.from(a.content, 'base64'),
                contentType: a.contentType
              }));
            }
          } catch (e) {
            console.error('Failed to parse attachments', e);
          }

          const mailOptions: any = {
            from: fromLabel,
            to: email.to,
            subject: email.subject,
            html: email.body,
            text: email.body.replace(/<[^>]*>/g, ''),
            attachments: parsedAttachments
          };
          if (email.cc) mailOptions.cc = email.cc;
          if (email.bcc) mailOptions.bcc = email.bcc;

          await transporter.sendMail(mailOptions);

          await db.run('UPDATE scheduled_emails SET status = ? WHERE id = ?', ['sent', email.id]);
          console.log(`[MailScheduler] Sent scheduled email ${email.id}.`);
        } catch (err) {
          console.error(`[MailScheduler] Failed to send scheduled email ${email.id}.`);
          await db.run('UPDATE scheduled_emails SET status = ? WHERE id = ?', ['failed', email.id]);
        }
      }
    } catch (err) {
      console.error('[MailScheduler] Error processing scheduled emails:', err);
    }
  }, 60 * 1000); // 1 minute
}
