import { describe, expect, it, vi } from 'vitest';
import { assertMailEndpointSafe, assertPublicMailHost, isBlockedMailHost } from '../utils/mailHostSecurity.js';
import { isSafeMailHeaders } from '../routes/mail.js';

describe('custom mail host SSRF checks', () => {
  it('blocks local, private, link-local, and IPv4-mapped private addresses', () => {
    expect(isBlockedMailHost('localhost')).toBe(true);
    expect(isBlockedMailHost('10.0.0.8')).toBe(true);
    expect(isBlockedMailHost('fe80::1')).toBe(true);
    expect(isBlockedMailHost('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedMailHost('2001:db8::1')).toBe(true);
    expect(isBlockedMailHost('2001:4860:4860::8888')).toBe(false);
    expect(isBlockedMailHost('2606:4700:4700::1111')).toBe(false);
    expect(isBlockedMailHost('mail.example.com')).toBe(false);
  });

  it('rejects a DNS name if any returned address is private', async () => {
    const lookup = vi.fn().mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '192.168.1.20', family: 4 },
    ]);
    await expect(assertPublicMailHost('mail.example.com', new Set(), lookup as any))
      .rejects.toThrow('private or reserved');
    expect(lookup).toHaveBeenCalledWith('mail.example.com', { all: true, verbatim: true });
  });

  it('allows an operator-allowlisted internal mail host', async () => {
    const lookup = vi.fn();
    await expect(assertPublicMailHost('tranle_mailserver', new Set(['tranle_mailserver']), lookup as any)).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects malformed hostnames before performing DNS lookup', async () => {
    const lookup = vi.fn();
    await expect(assertPublicMailHost('mail.example.com/path', new Set(), lookup as any)).rejects.toThrow('Invalid mail host');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects unsupported service ports in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(assertMailEndpointSafe('smtp', 'mail.example.com', 3306, new Set(['mail.example.com'])))
      .rejects.toThrow('Unsupported SMTP port');
    vi.unstubAllEnvs();
  });
});

describe('mail header validation', () => {
  it('accepts ordinary bounded recipients, subjects, and bodies', () => {
    expect(isSafeMailHeaders('person@example.com', 'Hello', ['copy@example.com'], undefined, '<p>Hi</p>')).toBe(true);
  });

  it('rejects CRLF hidden in recipient arrays and structured header values', () => {
    expect(isSafeMailHeaders(['person@example.com\r\nBcc: attacker@example.com'], 'Hello', undefined, undefined, '')).toBe(false);
    expect(isSafeMailHeaders({ name: 'Person\nBcc: attacker', address: 'person@example.com' }, 'Hello', undefined, undefined, '')).toBe(false);
  });

  it('bounds header and body sizes and rejects non-string subjects', () => {
    expect(isSafeMailHeaders('person@example.com', 'x'.repeat(999), undefined, undefined, '')).toBe(false);
    expect(isSafeMailHeaders('person@example.com', {}, undefined, undefined, '')).toBe(false);
    expect(isSafeMailHeaders('person@example.com', 'Hello', undefined, undefined, 'x'.repeat(5 * 1024 * 1024 + 1))).toBe(false);
  });
});
