type RateLimitConfig = {
  maxRequests: number;
  windowMs: number;
};

export type ApiRuntimeConfig = {
  adminAllowedIds: Set<string>;
  adminMfaSecret: string;
  adminMfaSkewSteps: number;
  bodyLimitBytes: number;
  logSalt: string;
  nodeEnv: string;
  payloadLimits: {
    adminBytes: number;
    claimBytes: number;
    markerBytes: number;
    registerBytes: number;
    submissionBytes: number;
    uploadBytes: number;
    verifyReceiptBytes: number;
  };
  port: number;
  rateLimits: {
    admin: RateLimitConfig;
    marker: RateLimitConfig;
    publicSubmission: RateLimitConfig;
    studentClaim: RateLimitConfig;
    studentRegister: RateLimitConfig;
    upload: RateLimitConfig;
    verifyReceipt: RateLimitConfig;
  };
  webOrigins: string[];
};

const mib = 1024 * 1024;
let cachedConfig: ApiRuntimeConfig | null = null;

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string
) {
  const normalized = value?.trim();

  if (!normalized) {
    return fallback;
  }

  const parsed = Number.parseInt(normalized, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function parseOriginList(value: string | undefined) {
  const origins = (value ?? 'http://localhost:3000')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (!origins.length) {
    throw new Error('WEB_ORIGIN must define at least one origin');
  }

  return origins;
}

function parseIdAllowlist(value: string | undefined) {
  const ids = (value ?? 'admin-demo')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (!ids.length) {
    throw new Error('ADMIN_IDS must define at least one admin principal');
  }

  return new Set(ids);
}

export function loadApiRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): ApiRuntimeConfig {
  const port = parsePositiveInteger(env.PORT, 3001, 'PORT');
  const bodyLimitBytes = parsePositiveInteger(
    env.API_BODY_LIMIT_BYTES,
    256 * 1024,
    'API_BODY_LIMIT_BYTES'
  );

  return {
    adminAllowedIds: parseIdAllowlist(env.ADMIN_IDS),
    adminMfaSecret: env.ADMIN_MFA_SECRET?.trim() || 'proofmark-dev-admin-mfa-secret',
    adminMfaSkewSteps: parsePositiveInteger(
      env.ADMIN_MFA_SKEW_STEPS,
      1,
      'ADMIN_MFA_SKEW_STEPS'
    ),
    bodyLimitBytes,
    logSalt: env.LOG_REDACTION_SALT?.trim() || 'proofmark-dev-log-salt',
    nodeEnv: env.NODE_ENV?.trim() || 'development',
    payloadLimits: {
      adminBytes: parsePositiveInteger(
        env.API_ADMIN_PAYLOAD_LIMIT_BYTES,
        256 * 1024,
        'API_ADMIN_PAYLOAD_LIMIT_BYTES'
      ),
      claimBytes: parsePositiveInteger(
        env.API_CLAIM_PAYLOAD_LIMIT_BYTES,
        96 * 1024,
        'API_CLAIM_PAYLOAD_LIMIT_BYTES'
      ),
      markerBytes: parsePositiveInteger(
        env.API_MARKER_PAYLOAD_LIMIT_BYTES,
        64 * 1024,
        'API_MARKER_PAYLOAD_LIMIT_BYTES'
      ),
      registerBytes: parsePositiveInteger(
        env.API_REGISTER_PAYLOAD_LIMIT_BYTES,
        32 * 1024,
        'API_REGISTER_PAYLOAD_LIMIT_BYTES'
      ),
      submissionBytes: parsePositiveInteger(
        env.API_SUBMISSION_PAYLOAD_LIMIT_BYTES,
        192 * 1024,
        'API_SUBMISSION_PAYLOAD_LIMIT_BYTES'
      ),
      uploadBytes: parsePositiveInteger(
        env.API_UPLOAD_PAYLOAD_LIMIT_BYTES,
        512 * 1024,
        'API_UPLOAD_PAYLOAD_LIMIT_BYTES'
      ),
      verifyReceiptBytes: parsePositiveInteger(
        env.API_VERIFY_RECEIPT_PAYLOAD_LIMIT_BYTES,
        64 * 1024,
        'API_VERIFY_RECEIPT_PAYLOAD_LIMIT_BYTES'
      )
    },
    port,
    rateLimits: {
      admin: {
        maxRequests: parsePositiveInteger(
          env.API_RATE_LIMIT_ADMIN_MAX,
          60,
          'API_RATE_LIMIT_ADMIN_MAX'
        ),
        windowMs: parsePositiveInteger(
          env.API_RATE_LIMIT_ADMIN_WINDOW_MS,
          60_000,
          'API_RATE_LIMIT_ADMIN_WINDOW_MS'
        )
      },
      marker: {
        maxRequests: parsePositiveInteger(
          env.API_RATE_LIMIT_MARKER_MAX,
          90,
          'API_RATE_LIMIT_MARKER_MAX'
        ),
        windowMs: parsePositiveInteger(
          env.API_RATE_LIMIT_MARKER_WINDOW_MS,
          60_000,
          'API_RATE_LIMIT_MARKER_WINDOW_MS'
        )
      },
      publicSubmission: {
        maxRequests: parsePositiveInteger(
          env.API_RATE_LIMIT_SUBMISSION_MAX,
          30,
          'API_RATE_LIMIT_SUBMISSION_MAX'
        ),
        windowMs: parsePositiveInteger(
          env.API_RATE_LIMIT_SUBMISSION_WINDOW_MS,
          60_000,
          'API_RATE_LIMIT_SUBMISSION_WINDOW_MS'
        )
      },
      studentClaim: {
        maxRequests: parsePositiveInteger(
          env.API_RATE_LIMIT_CLAIM_MAX,
          20,
          'API_RATE_LIMIT_CLAIM_MAX'
        ),
        windowMs: parsePositiveInteger(
          env.API_RATE_LIMIT_CLAIM_WINDOW_MS,
          60_000,
          'API_RATE_LIMIT_CLAIM_WINDOW_MS'
        )
      },
      studentRegister: {
        maxRequests: parsePositiveInteger(
          env.API_RATE_LIMIT_REGISTER_MAX,
          30,
          'API_RATE_LIMIT_REGISTER_MAX'
        ),
        windowMs: parsePositiveInteger(
          env.API_RATE_LIMIT_REGISTER_WINDOW_MS,
          60_000,
          'API_RATE_LIMIT_REGISTER_WINDOW_MS'
        )
      },
      upload: {
        maxRequests: parsePositiveInteger(
          env.API_RATE_LIMIT_UPLOAD_MAX,
          40,
          'API_RATE_LIMIT_UPLOAD_MAX'
        ),
        windowMs: parsePositiveInteger(
          env.API_RATE_LIMIT_UPLOAD_WINDOW_MS,
          60_000,
          'API_RATE_LIMIT_UPLOAD_WINDOW_MS'
        )
      },
      verifyReceipt: {
        maxRequests: parsePositiveInteger(
          env.API_RATE_LIMIT_VERIFY_MAX,
          60,
          'API_RATE_LIMIT_VERIFY_MAX'
        ),
        windowMs: parsePositiveInteger(
          env.API_RATE_LIMIT_VERIFY_WINDOW_MS,
          60_000,
          'API_RATE_LIMIT_VERIFY_WINDOW_MS'
        )
      }
    },
    webOrigins: parseOriginList(env.WEB_ORIGIN)
  };
}

export function getApiRuntimeConfig() {
  cachedConfig ??= loadApiRuntimeConfig();
  return cachedConfig;
}

export function resetApiRuntimeConfigForTests() {
  cachedConfig = null;
}

export const DEFAULT_LOAD_TEST_MAX_BYTES = 2 * mib;
