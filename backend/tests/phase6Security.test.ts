import { describe, expect, it } from 'vitest';
import { sanitizeActivityLog, sanitizeActivityValue } from '../utils/activityPrivacy.js';
import { createSecurityHeaderOptions } from '../utils/securityHeaders.js';

describe('activity log privacy', () => {
  it('redacts contact details in free text and drops sensitive structured fields', () => {
    const result = sanitizeActivityValue({
      description: 'Login attempt for alex@example.com, phone +1 (555) 123-4567',
      email: 'alex@example.com',
      nested: { password: 'secret', entityId: 'safe-id' },
    }) as any;

    expect(result.description).not.toContain('alex@example.com');
    expect(result.description).not.toContain('555');
    expect(result.email).toBeUndefined();
    expect(result.nested.password).toBeUndefined();
    expect(result.nested.entityId).toBe('safe-id');
  });

  it('sanitizes legacy JSON metadata before returning it', () => {
    const result = sanitizeActivityLog({ metadata: JSON.stringify({ email: 'legacy@example.com', action: 'ok' }) });
    expect(JSON.parse(result.metadata)).toEqual({ action: 'ok' });
  });
});

describe('production security headers', () => {
  it('enables HSTS and a restrictive CSP with configured app/socket origins', () => {
    const options = createSecurityHeaderOptions(true, ['https://app.example.com']);
    expect(options.hsts).toMatchObject({ maxAge: 31_536_000, includeSubDomains: true });
    expect(options.noSniff).toBe(true);
    expect(options.frameguard).toEqual({ action: 'sameorigin' });
    expect(options.contentSecurityPolicy.directives.defaultSrc).toEqual(["'self'"]);
    expect(options.contentSecurityPolicy.directives.connectSrc).toContain('wss://app.example.com');
    expect(options.contentSecurityPolicy.directives.objectSrc).toEqual(["'none'"]);
  });

  it('does not force production-only CSP/HSTS in development', () => {
    const options = createSecurityHeaderOptions(false, []);
    expect(options.hsts).toBe(false);
    expect(options.contentSecurityPolicy).toBe(false);
  });
});
