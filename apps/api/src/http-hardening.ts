import type { ApiRuntimeConfig } from './config.js';
import { hashPrincipal, type PrivacySafeLogger } from './privacy-logger.js';

type ResponseLike = {
  getHeader(name: string): number | string | string[] | undefined;
  on(event: 'finish', callback: () => void): void;
  setHeader(name: string, value: number | string): void;
  statusCode: number;
};

type RequestLike = {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  method?: string;
  originalUrl?: string;
  path?: string;
  socket?: {
    remoteAddress?: string;
  };
};

type NextLike = () => void;

type RateLimitBucket =
  | 'admin'
  | 'marker'
  | 'publicSubmission'
  | 'studentClaim'
  | 'studentRegister'
  | 'upload'
  | 'verifyReceipt';

const inMemoryRateLimitState = new Map<
  string,
  {
    count: number;
    resetAt: number;
  }
>();

function firstHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function resolveRequestPath(request: RequestLike) {
  return request.path ?? request.originalUrl ?? '/';
}

function resolveClientIp(request: RequestLike) {
  const forwardedFor = firstHeaderValue(request.headers['x-forwarded-for']);
  return forwardedFor?.split(',')[0]?.trim() || request.ip || request.socket?.remoteAddress || 'unknown';
}

function classifyRateLimitBucket(path: string): RateLimitBucket | null {
  if (path.startsWith('/api/admin/')) {
    return 'admin';
  }

  if (path.startsWith('/api/marker/')) {
    return 'marker';
  }

  if (path.startsWith('/api/public/uploads/')) {
    return 'upload';
  }

  if (path === '/api/public/verify-receipt') {
    return 'verifyReceipt';
  }

  if (/^\/api\/public\/exams\/[^/]+\/submissions$/.test(path)) {
    return 'publicSubmission';
  }

  if (/^\/api\/student\/exams\/[^/]+\/register-commitment$/.test(path)) {
    return 'studentRegister';
  }

  if (/^\/api\/student\/exams\/[^/]+\/recovery-package$/.test(path)) {
    return 'studentRegister';
  }

  if (/^\/api\/student\/exams\/[^/]+\/recovery-requests(?:\/[^/]+\/restore)?$/.test(path)) {
    return 'studentClaim';
  }

  if (/^\/api\/student\/exams\/[^/]+\/claims$/.test(path)) {
    return 'studentClaim';
  }

  return null;
}

function resolvePayloadLimitBytes(path: string, config: ApiRuntimeConfig) {
  const bucket = classifyRateLimitBucket(path);

  switch (bucket) {
    case 'admin':
      return config.payloadLimits.adminBytes;
    case 'marker':
      return config.payloadLimits.markerBytes;
    case 'publicSubmission':
      return config.payloadLimits.submissionBytes;
    case 'studentClaim':
      return config.payloadLimits.claimBytes;
    case 'studentRegister':
      return config.payloadLimits.registerBytes;
    case 'upload':
      return config.payloadLimits.uploadBytes;
    case 'verifyReceipt':
      return config.payloadLimits.verifyReceiptBytes;
    default:
      return null;
  }
}

function resolveActorKey(bucket: RateLimitBucket, request: RequestLike) {
  if (bucket === 'admin') {
    return firstHeaderValue(request.headers['x-admin-id']) ?? resolveClientIp(request);
  }

  if (bucket === 'marker') {
    return firstHeaderValue(request.headers['x-marker-id']) ?? resolveClientIp(request);
  }

  if (bucket === 'studentRegister' || bucket === 'studentClaim') {
    return firstHeaderValue(request.headers['x-student-id']) ?? resolveClientIp(request);
  }

  return resolveClientIp(request);
}

export function createSecurityHeadersMiddleware(config: ApiRuntimeConfig) {
  const connectSources = Array.from(new Set(['self', ...config.webOrigins])).map(
    (value) => (value === 'self' ? "'self'" : value)
  );
  const contentSecurityPolicy = [
    "default-src 'none'",
    `connect-src ${connectSources.join(' ')}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "img-src 'self' data:",
    "object-src 'none'",
    "script-src 'none'",
    "style-src 'self' 'unsafe-inline'"
  ].join('; ');

  return (request: RequestLike, response: ResponseLike, next: NextLike) => {
    void request;
    response.setHeader('Content-Security-Policy', contentSecurityPolicy);
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    response.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    next();
  };
}

export function createPayloadSizeMiddleware(config: ApiRuntimeConfig) {
  return (request: RequestLike, response: ResponseLike, next: NextLike) => {
    const path = resolveRequestPath(request);
    const limitBytes = resolvePayloadLimitBytes(path, config);

    if (!limitBytes) {
      next();
      return;
    }

    const contentLengthValue = firstHeaderValue(request.headers['content-length']);
    const contentLength = contentLengthValue ? Number.parseInt(contentLengthValue, 10) : 0;

    if (Number.isFinite(contentLength) && contentLength > limitBytes) {
      response.statusCode = 413;
      response.setHeader('content-type', 'application/json');
      response.setHeader('x-proofmark-payload-limit', String(limitBytes));
      (response as unknown as { end: (body: string) => void }).end(
        JSON.stringify({
          error: 'PAYLOAD_TOO_LARGE',
          limitBytes
        })
      );
      return;
    }

    next();
  };
}

export function createRateLimitMiddleware(config: ApiRuntimeConfig) {
  return (request: RequestLike, response: ResponseLike, next: NextLike) => {
    const path = resolveRequestPath(request);
    const bucket = classifyRateLimitBucket(path);

    if (!bucket) {
      next();
      return;
    }

    const policy = config.rateLimits[bucket];
    const now = Date.now();
    const actorKey = resolveActorKey(bucket, request);
    const cacheKey = `${bucket}:${actorKey}`;
    const current = inMemoryRateLimitState.get(cacheKey);

    if (!current || current.resetAt <= now) {
      inMemoryRateLimitState.set(cacheKey, {
        count: 1,
        resetAt: now + policy.windowMs
      });
      response.setHeader('x-ratelimit-limit', String(policy.maxRequests));
      response.setHeader('x-ratelimit-remaining', String(policy.maxRequests - 1));
      response.setHeader('x-ratelimit-reset', String(now + policy.windowMs));
      next();
      return;
    }

    if (current.count >= policy.maxRequests) {
      response.statusCode = 429;
      response.setHeader('content-type', 'application/json');
      response.setHeader('x-ratelimit-limit', String(policy.maxRequests));
      response.setHeader('x-ratelimit-remaining', '0');
      response.setHeader('x-ratelimit-reset', String(current.resetAt));
      (response as unknown as { end: (body: string) => void }).end(
        JSON.stringify({
          error: 'RATE_LIMIT_EXCEEDED',
          resetAt: current.resetAt
        })
      );
      return;
    }

    current.count += 1;
    response.setHeader('x-ratelimit-limit', String(policy.maxRequests));
    response.setHeader(
      'x-ratelimit-remaining',
      String(Math.max(policy.maxRequests - current.count, 0))
    );
    response.setHeader('x-ratelimit-reset', String(current.resetAt));
    next();
  };
}

export function createRequestLoggingMiddleware(
  logger: PrivacySafeLogger,
  config: ApiRuntimeConfig
) {
  return (request: RequestLike, response: ResponseLike, next: NextLike) => {
    const startedAt = Date.now();
    const requestId =
      firstHeaderValue(request.headers['x-request-id']) || crypto.randomUUID();

    response.setHeader('x-request-id', requestId);
    response.on('finish', () => {
      const path = resolveRequestPath(request);
      logger.write('info', 'http_request', 'HttpAccess', {
        actorHashes: {
          adminId: hashPrincipal(
            firstHeaderValue(request.headers['x-admin-id']),
            config.logSalt
          ),
          markerId: hashPrincipal(
            firstHeaderValue(request.headers['x-marker-id']),
            config.logSalt
          ),
          studentId: hashPrincipal(
            firstHeaderValue(request.headers['x-student-id']),
            config.logSalt
          )
        },
        contentLength: response.getHeader('content-length') ?? null,
        durationMs: Date.now() - startedAt,
        ipHash: hashPrincipal(resolveClientIp(request), config.logSalt),
        method: request.method ?? 'GET',
        path,
        requestId,
        statusCode: response.statusCode
      });
    });
    next();
  };
}

export function resetRateLimitStateForTests() {
  inMemoryRateLimitState.clear();
}
