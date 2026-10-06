import crypto from 'crypto';

const GCM_IV_LENGTH = 12;
const CBC_IV_LENGTH = 16;
// Read-only compatibility for values encrypted by the former hard-coded key.
// New data is never encrypted with this key; operators should rotate credentials.
const LEGACY_DEFAULT_CBC_KEY = 'TranLe-Task-Secure-Key-123456789';

if (!process.env.MAIL_ENCRYPTION_KEY && process.env.NODE_ENV === 'production') {
  throw new Error('[SECURITY] MAIL_ENCRYPTION_KEY is required in production.');
}

function configuredKey() {
  const secret = process.env.MAIL_ENCRYPTION_KEY?.trim();
  if (!secret) throw new Error('[SECURITY] MAIL_ENCRYPTION_KEY must be configured before mail credentials can be encrypted or decrypted.');
  return crypto.createHash('sha256').update(secret).digest();
}

function legacyCbcKeys() {
  const candidates = [process.env.MAIL_ENCRYPTION_LEGACY_KEY, process.env.MAIL_ENCRYPTION_KEY, LEGACY_DEFAULT_CBC_KEY]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return [...new Set(candidates)].map((secret) => Buffer.from(secret.padEnd(32, '0').slice(0, 32)));
}

export const isVersionedCiphertext = (value: string) => value.startsWith('v2:');
export const isLegacyCbcCiphertext = (value: string) => {
  const [ivHex, encryptedHex, ...extra] = value.split(':');
  return extra.length === 0
    && /^[a-f0-9]{32}$/i.test(ivHex || '')
    && Boolean(encryptedHex)
    && /^[a-f0-9]+$/i.test(encryptedHex)
    && encryptedHex.length % 32 === 0;
};

export function encrypt(text: string) {
  if (!text) return text;
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', configuredKey(), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v2:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(text: string) {
  if (!text) return text;
  try {
    if (text.startsWith('v2:')) {
      const [, ivHex, tagHex, encryptedHex] = text.split(':');
      if (!/^[a-f0-9]{24}$/i.test(ivHex || '') || !/^[a-f0-9]{32}$/i.test(tagHex || '') || !/^(?:[a-f0-9]{2})*$/i.test(encryptedHex || '')) return null;
      const decipher = crypto.createDecipheriv('aes-256-gcm', configuredKey(), Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      let decrypted = decipher.update(Buffer.from(encryptedHex, 'hex'));
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      return decrypted.toString();
    }

    if (!isLegacyCbcCiphertext(text)) return null;
    const [ivHex, encryptedHex] = text.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const encryptedText = Buffer.from(encryptedHex, 'hex');
    for (const key of legacyCbcKeys()) {
      try {
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv.length === CBC_IV_LENGTH ? iv : iv.subarray(0, CBC_IV_LENGTH));
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
      } catch { /* Try the remaining legacy keys without exposing credential data. */ }
    }
    return null;
  } catch (error) {
    // Silently fail or log minimally to avoid spamming the terminal
    // console.warn('Decryption failed for mail password.');
    return null;
  }
}
