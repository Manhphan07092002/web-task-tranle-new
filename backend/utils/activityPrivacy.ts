const sensitiveKeys = new Set([
  'email', 'phone', 'mobile', 'mobilenumber', 'cccd', 'idnumber', 'dob', 'dateofbirth',
  'address', 'hometown', 'bio', 'password', 'token', 'secret', 'feedback', 'content',
  'filename', 'ip', 'ipaddress', 'message', 'recipient', 'to', 'cc', 'bcc',
]);

function redactText(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted]')
    .replace(/\bBearer\s+[A-Z0-9._~+/-]+=*/gi, 'Bearer [redacted]');
}

export function sanitizeActivityValue(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(sanitizeActivityValue);
  if (value && typeof value === 'object') {
    const safe: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (sensitiveKeys.has(normalizedKey)) continue;
      safe[key] = sanitizeActivityValue(child);
    }
    return safe;
  }
  return value;
}

export function sanitizeActivityLog<T extends Record<string, any>>(log: T): T {
  let metadata: unknown = log.metadata;
  if (typeof metadata === 'string') {
    try { metadata = JSON.parse(metadata); } catch { /* Keep legacy text metadata, but redact identifiable values. */ }
  }
  const sanitized = sanitizeActivityValue(metadata);
  return { ...log, metadata: typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized) };
}
