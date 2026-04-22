import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AdminAuthService,
  generateTotpCode
} from '../src/admin-auth.service.js';
import { loadApiRuntimeConfig } from '../src/config.js';
import {
  createPayloadSizeMiddleware,
  createRateLimitMiddleware,
  resetRateLimitStateForTests
} from '../src/http-hardening.js';
import { redactLogValue } from '../src/privacy-logger.js';

function createResponseMock() {
  const headers = new Map<string, string | number>();
  let endBody = '';
  let onFinish: (() => void) | null = null;

  return {
    endBodyRef: () => endBody,
    getHeader(name: string) {
      return headers.get(name);
    },
    headers,
    on(event: 'finish', callback: () => void) {
      if (event === 'finish') {
        onFinish = callback;
      }
    },
    setHeader(name: string, value: number | string) {
      headers.set(name, value);
    },
    statusCode: 200,
    triggerFinish() {
      onFinish?.();
    },
    end(body: string) {
      endBody = body;
    }
  };
}

describe('phase 12 hardening', () => {
  const config = loadApiRuntimeConfig({
    ADMIN_IDS: 'admin-a,admin-b',
    ADMIN_MFA_SECRET: 'test-admin-secret',
    LOG_REDACTION_SALT: 'test-log-salt',
    PORT: '3001',
    WEB_ORIGIN: 'http://localhost:3000'
  });

  beforeEach(() => {
    resetRateLimitStateForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('requires both allowlisted admin identity and a valid MFA code', () => {
    const service = new AdminAuthService();
    (service as unknown as { config: typeof config }).config = config;
    const now = new Date('2026-04-23T12:00:00.000Z').valueOf();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const validCode = generateTotpCode(config.adminMfaSecret, now);

    expect(
      service.authorize({
        adminId: 'admin-a',
        mfaCode: validCode
      })
    ).toBe('admin-a');
    expect(() =>
      service.authorize({
        adminId: 'not-allowed',
        mfaCode: validCode
      })
    ).toThrow(ForbiddenException);
    expect(() =>
      service.authorize({
        adminId: 'admin-a',
        mfaCode: '000000'
      })
    ).toThrow(UnauthorizedException);
  });

  it('redacts private payloads before logs are serialized', () => {
    const value = redactLogValue({
      answerKey: ['a'],
      body: {
        proof: {
          points: ['1', '2']
        },
        studentId: 'student-1'
      },
      status: 'ok'
    });

    expect(value).toEqual({
      answerKey: '[REDACTED]',
      body: '[REDACTED]',
      status: 'ok'
    });
  });

  it('enforces payload size limits before parsing large bodies', () => {
    const middleware = createPayloadSizeMiddleware(config);
    const response = createResponseMock();
    let nextCalled = false;

    middleware(
      {
        headers: {
          'content-length': String(config.payloadLimits.verifyReceiptBytes + 1)
        },
        path: '/api/public/verify-receipt'
      },
      response,
      () => {
        nextCalled = true;
      }
    );

    expect(nextCalled).toBe(false);
    expect(response.statusCode).toBe(413);
    expect(response.endBodyRef()).toContain('PAYLOAD_TOO_LARGE');
  });

  it('rate limits repeated anonymous submission attempts per client bucket', () => {
    const middleware = createRateLimitMiddleware(
      loadApiRuntimeConfig({
        API_RATE_LIMIT_SUBMISSION_MAX: '2',
        API_RATE_LIMIT_SUBMISSION_WINDOW_MS: '60000',
        PORT: '3001',
        WEB_ORIGIN: 'http://localhost:3000'
      })
    );
    const nextCalls: string[] = [];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = createResponseMock();
      middleware(
        {
          headers: {
            'x-forwarded-for': '203.0.113.10'
          },
          path: '/api/public/exams/exam-1/submissions'
        },
        response,
        () => {
          nextCalls.push(`attempt-${attempt}`);
        }
      );

      if (attempt === 2) {
        expect(response.statusCode).toBe(429);
        expect(response.endBodyRef()).toContain('RATE_LIMIT_EXCEEDED');
      }
    }

    expect(nextCalls).toEqual(['attempt-0', 'attempt-1']);
  });
});
