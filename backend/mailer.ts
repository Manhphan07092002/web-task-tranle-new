import nodemailer from 'nodemailer';
import { decrypt, isLegacyCbcCiphertext, isVersionedCiphertext } from './utils/cryptoUtils.js';
import { mailTlsOptions } from './utils/mailTls.js';
import { assertMailEndpointsSafe } from './utils/mailHostSecurity.js';
import { TRANLE_WEBMAIL } from './utils/tranleWebmail.js';

type DbType = any; // will be passed in at runtime

export function createMailer(db: DbType) {
  const getSystemConfig = async () => {
    const rows = await db.all('SELECT `key`, `value` FROM system_config');
    const config = Object.fromEntries(rows.map((row: any) => [row.key, row.value]));
    const storedSmtpPass = config.SMTP_PASS || '';
    const smtpPass = isVersionedCiphertext(storedSmtpPass) || isLegacyCbcCiphertext(storedSmtpPass)
      ? (decrypt(storedSmtpPass) || '')
      : (storedSmtpPass || process.env.SMTP_PASS || '');
    return {
      IMAP_HOST: config.IMAP_HOST || process.env.IMAP_HOST || TRANLE_WEBMAIL.host,
      IMAP_PORT: config.IMAP_PORT || process.env.IMAP_PORT || String(TRANLE_WEBMAIL.imapPort),
      SMTP_HOST: config.SMTP_HOST || process.env.SMTP_HOST || TRANLE_WEBMAIL.host,
      SMTP_PORT: config.SMTP_PORT || process.env.SMTP_PORT || String(TRANLE_WEBMAIL.smtpPort),
      SMTP_SECURE: config.SMTP_SECURE || process.env.SMTP_SECURE || String(TRANLE_WEBMAIL.smtpSecure),
      SMTP_USER: config.SMTP_USER || process.env.SMTP_USER || '',
      SMTP_PASS: smtpPass,
      SMTP_FROM: config.SMTP_FROM || process.env.SMTP_FROM || '',
    };
  };

  const createTransporter = async () => {
    const smtp = await getSystemConfig();
    const smtpConfigured = Boolean(smtp.SMTP_HOST && smtp.SMTP_USER && smtp.SMTP_PASS && smtp.SMTP_FROM);
    if (!smtpConfigured) return { transporter: null, smtp };

    const port = Number(smtp.SMTP_PORT || 587);
    await assertMailEndpointsSafe({ smtpHost: smtp.SMTP_HOST, smtpPort: port });
    const transporter = nodemailer.createTransport({
      host: smtp.SMTP_HOST,
      port,
      secure: port === 465 || String(smtp.SMTP_SECURE || 'false') === 'true',
      auth: { user: smtp.SMTP_USER, pass: smtp.SMTP_PASS },
      tls: mailTlsOptions(),
    });

    return { transporter, smtp };
  };

  const sendResetLinkEmail = async (to: string, resetLink: string) => {
    const { transporter, smtp } = await createTransporter();
    if (!transporter) {
      console.warn('SMTP is not configured, skipping password reset email.');
      return false;
    }
    await transporter.sendMail({
      from: smtp.SMTP_FROM, replyTo: smtp.SMTP_FROM, to,
      subject: 'Tran Le Tasks - Link đặt lại mật khẩu',
      text: `Xin chào,\n\nBạn vừa yêu cầu đặt lại mật khẩu cho tài khoản Tran Le Tasks.\n\nMở link này để đặt lại mật khẩu:\n${resetLink}\n\nLink sẽ hết hạn sau 30 phút.\n\nNếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email.\n\nTrân trọng,\nTran Le Electricity`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
        <div style="max-width:560px;margin:0 auto;padding:24px">
          <div style="padding:18px 20px;border-radius:16px 16px 0 0;background:#1e3a8a;color:#fff;text-align:center;font-weight:800;font-size:20px">Tran Le Electricity</div>
          <div style="padding:24px;background:#fff;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 16px 16px">
            <p style="margin:0 0 12px">Xin chào,</p>
            <p style="margin:0 0 16px">Bạn vừa yêu cầu đặt lại mật khẩu cho tài khoản Tran Le Tasks.</p>
            <div style="text-align:center;margin:20px 0">
              <a href="${resetLink}" style="display:inline-block;padding:12px 20px;background:#f97316;color:#fff;text-decoration:none;border-radius:12px;font-weight:800">Đặt lại mật khẩu</a>
            </div>
            <div style="padding:12px 14px;background:#f9fafb;border-radius:12px;word-break:break-all;font-size:13px;color:#374151">${resetLink}</div>
            <p style="margin:16px 0 0;color:#b45309;font-weight:700">Link này sẽ hết hạn sau 30 phút.</p>
            <p style="margin:0 0 16px">Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email.</p>
            <p style="margin:24px 0 0;color:#6b7280;font-size:13px">Trân trọng,<br/>Tran Le Electricity</p>
          </div>
        </div>
      </div>`,
    });
    return true;
  };

  return { getSystemConfig, createTransporter, sendResetLinkEmail };
}
