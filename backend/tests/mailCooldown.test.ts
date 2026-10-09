import { describe, expect, it } from 'vitest';
import { mailRetryDeadline } from '../../frontend/hooks/useMailConnectionCooldown.js';

describe('mail login retry deadline', () => {
  const now = Date.parse('2026-10-09T00:00:00Z');

  it('uses the structured server retry duration', () => {
    expect(mailRetryDeadline(123, '900', now)).toBe(now + 123000);
  });

  it('accepts a Retry-After duration when the body is unavailable', () => {
    expect(mailRetryDeadline(undefined, '60', now)).toBe(now + 60000);
  });

  it('accepts a Retry-After HTTP date', () => {
    expect(mailRetryDeadline(undefined, 'Fri, 09 Oct 2026 00:01:00 GMT', now)).toBe(now + 60000);
  });

  it.each([undefined, 'invalid', -1, Infinity])('uses the limiter window for invalid metadata %s', (value) => {
    expect(mailRetryDeadline(value, null, now)).toBe(now + 900000);
  });
});
