import { z } from 'zod';

const secret = (name: string) =>
  z.string().min(32, `${name} must be at least 32 characters`);

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

/**
 * Every environment variable the service reads. Validated once at startup, so a missing or
 * malformed value stops the app from booting (DESIGN.md §4.2, §4.5, §3.1).
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // API keys
  API_KEY_ENV: z.enum(['live', 'test']).default('test'),
  API_KEY_PEPPER: secret('API_KEY_PEPPER'),

  // Other-service JWT
  SERVICE_AUTH_HEADER: z
    .string()
    .default('authorization')
    .transform((v) => v.toLowerCase()),
  SERVICE_AUTH_JWKS_URL: z.string().url(),
  SERVICE_AUTH_ISSUER: z.string().min(1),
  SERVICE_AUTH_AUDIENCE: z.string().min(1),
  SERVICE_AUTH_ALGORITHMS: z
    .string()
    .default('RS256,ES256')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
    .refine((algs) => algs.length > 0 && algs.every((a) => !a.startsWith('HS') && a !== 'none'), {
      message: 'SERVICE_AUTH_ALGORITHMS must be asymmetric algorithms (no HS*, no none)',
    }),
  SERVICE_AUTH_CLOCK_SKEW_S: z.coerce.number().int().min(0).max(300).default(30),
  SERVICE_AUTH_TENANT_CLAIM: optionalString,
  DOWNSTREAM_ALLOWLIST: csv,

  // Contact system
  CONTACT_API_BASE_URL: z.string().url(),
  CONTACT_API_CONTACT_PATH: z.string().startsWith('/'),
  CONTACT_API_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  CONTACT_API_RETRIES: z.coerce.number().int().min(0).max(5).default(1),

  // Reservation status webhook (confirmed + failed events)
  RESERVATION_WEBHOOK_URL: z.string().url(),
  RESERVATION_WEBHOOK_SECRET: secret('RESERVATION_WEBHOOK_SECRET'),
  RESERVATION_WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  RESERVATION_WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(8),

  // Internal secrets
  SLOT_TOKEN_SECRET: secret('SLOT_TOKEN_SECRET'),
  USER_REF_SECRET: secret('USER_REF_SECRET'),
  JOB_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'JOB_ENCRYPTION_KEY must be 32 bytes, base64-encoded'),

  // Tuning
  SHIFTS_CACHE_TTL_S: z.coerce.number().int().min(0).default(120),
  SHIFTS_TIMEOUT_MS: z.coerce.number().int().positive().default(25000),
  SUBMIT_CONCURRENCY: z.coerce.number().int().positive().default(2),
  MAX_BOOKING_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),

  // Dev only
  FAKE_PROVIDER_FAIL_CODE: optionalString,
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
