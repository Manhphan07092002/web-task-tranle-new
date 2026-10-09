import { z } from 'zod';

/**
 * Environment variable validation schema
 */
const envSchema = z.object({
  // Node environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3500'),

  // Database
  DATABASE_URL: z.string().url().default('mysql://root:@127.0.0.1:3306/Tranle_task_new'),

  // Security
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  MAIL_ENCRYPTION_KEY: z.string().min(32, 'MAIL_ENCRYPTION_KEY must be at least 32 characters'),
  ADMIN_DEFAULT_PASSWORD: z.string().min(16, 'ADMIN_DEFAULT_PASSWORD must be at least 16 characters'),

  // CORS & URLs
  APP_BASE_URL: z.string().url().optional(),
  ALLOWED_ORIGIN: z.string().optional(),

  // SMTP Configuration
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_SECURE: z.enum(['true', 'false']).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().email().optional(),

  // Google Gemini AI
  GEMINI_API_KEY: z.string().optional(),

  // Optional Features
  ENABLE_AI_FEATURES: z.enum(['true', 'false']).default('false'),
  ENABLE_MAIL_FEATURES: z.enum(['true', 'false']).default('false'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validate environment variables
 * @throws {Error} if validation fails
 */
export function validateEnv(): Env {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((issue) => {
        const path = issue.path.join('.');
        return `  - ${path}: ${issue.message}`;
      });
      throw new Error(
        `Environment variable validation failed:\n${issues.join('\n')}`
      );
    }
    throw error;
  }
}

/**
 * Validate production-specific requirements
 */
export function validateProductionEnv(env: Env): void {
  if (env.NODE_ENV !== 'production') return;

  const errors: string[] = [];

  // Check for placeholder values
  const requiredSecrets = ['JWT_SECRET', 'MAIL_ENCRYPTION_KEY', 'APP_BASE_URL', 'ALLOWED_ORIGIN', 'ADMIN_DEFAULT_PASSWORD'];
  const placeholderPattern = /change[-_ ]?me|your_|example|placeholder|replace_with/i;

  for (const key of requiredSecrets) {
    const value = (env as any)[key]?.trim() || '';
    if (!value) {
      errors.push(`${key} is required in production`);
    } else if (placeholderPattern.test(value)) {
      errors.push(`${key} contains a placeholder value`);
    }
  }

  // Check secret lengths
  if ((env.JWT_SECRET?.length || 0) < 32) {
    errors.push('JWT_SECRET must be at least 32 characters in production');
  }
  if ((env.MAIL_ENCRYPTION_KEY?.length || 0) < 32) {
    errors.push('MAIL_ENCRYPTION_KEY must be at least 32 characters in production');
  }
  if ((env.ADMIN_DEFAULT_PASSWORD?.length || 0) < 16) {
    errors.push('ADMIN_DEFAULT_PASSWORD must be at least 16 characters in production');
  }

  // Validate URLs
  if (env.APP_BASE_URL) {
    try {
      const appUrl = new URL(env.APP_BASE_URL);
      if (appUrl.protocol !== 'https:') {
        errors.push('APP_BASE_URL must use HTTPS in production');
      }
    } catch {
      errors.push('APP_BASE_URL is not a valid URL');
    }
  } else {
    errors.push('APP_BASE_URL is required in production');
  }

  // Validate CORS origins
  if (env.ALLOWED_ORIGIN) {
    const origins = env.ALLOWED_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
    if (origins.length === 0) {
      errors.push('ALLOWED_ORIGIN must contain at least one origin in production');
    }
    for (const origin of origins) {
      try {
        const parsedOrigin = new URL(origin);
        if (parsedOrigin.origin !== origin) {
          errors.push(`ALLOWED_ORIGIN entry "${origin}" must not contain a path`);
        }
        if (parsedOrigin.protocol !== 'https:') {
          errors.push(`ALLOWED_ORIGIN entry "${origin}" must use HTTPS in production`);
        }
      } catch {
        errors.push(`ALLOWED_ORIGIN entry "${origin}" is not a valid URL`);
      }
    }
  } else {
    errors.push('ALLOWED_ORIGIN is required in production');
  }

  if (errors.length > 0) {
    throw new Error(
      `Production environment validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`
    );
  }
}

/**
 * Get validated environment configuration
 */
export function getEnv(): Env {
  const env = validateEnv();
  validateProductionEnv(env);
  return env;
}
