import { describe, expect, it } from 'vitest';
import { resolveMailProvider } from '../routes/mail.js';

describe('mail provider resolution', () => {
  it('upgrades the Nhan Hoa endpoint from a legacy custom selection', () => {
    expect(resolveMailProvider({
      provider: 'custom',
      imapHost: 'share-mail05.nhanhoa.com',
      imapPort: '993',
      smtpHost: 'share-mail05.nhanhoa.com',
      smtpPort: 465,
    }, '')).toBe('webmail');
  });

  it('keeps unrelated custom email providers unchanged', () => {
    expect(resolveMailProvider({ provider: 'custom', imapHost: 'imap.example.com', imapPort: 993 }, '')).toBe('custom');
  });
});
