let warnedAboutInsecureTls = false;

/** Shared outbound mail TLS policy. Certificate verification is always on in production. */
export function mailTlsOptions() {
  const explicitlyInsecure = process.env.MAIL_ALLOW_INSECURE_TLS === 'true';
  if (explicitlyInsecure && process.env.NODE_ENV === 'production') {
    throw new Error('[SECURITY] MAIL_ALLOW_INSECURE_TLS is forbidden in production.');
  }

  if (explicitlyInsecure && !warnedAboutInsecureTls) {
    warnedAboutInsecureTls = true;
    console.warn('[SECURITY] Mail TLS certificate verification is disabled for this non-production process.');
  }

  return { rejectUnauthorized: !explicitlyInsecure };
}

export function isMailTlsInsecureAllowed() {
  return mailTlsOptions().rejectUnauthorized === false;
}
