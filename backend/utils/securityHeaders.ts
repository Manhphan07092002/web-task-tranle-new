export function createSecurityHeaderOptions(isProduction: boolean, allowedOrigins: string[]) {
  const websocketOrigins = allowedOrigins.map((origin) => origin.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:'));
  return {
    hsts: isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    noSniff: true,
    frameguard: { action: 'sameorigin' as const },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' as const },
    contentSecurityPolicy: isProduction ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: [
          "'self'", 'data:', 'blob:', 'https://images.unsplash.com', 'https://api.dicebear.com',
          'https://ui-avatars.com', 'https://picsum.photos', 'https://via.placeholder.com',
          'https://i.pravatar.cc', 'https://www.gstatic.com',
        ],
        mediaSrc: ["'self'", 'blob:', 'https://www.soundhelix.com', 'https://actions.google.com'],
        workerSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'", ...allowedOrigins, ...websocketOrigins, 'https://cdn.jsdelivr.net'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    } : false,
    crossOriginResourcePolicy: { policy: 'same-origin' as const },
  };
}
