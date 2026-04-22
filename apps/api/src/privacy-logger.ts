import type { LoggerService } from '@nestjs/common';
import { sha256Hex } from '@proofmark/crypto';

const redactedKeys = new Set([
  'answerKey',
  'answerKeyData',
  'answerSalt',
  'body',
  'ciphertext',
  'comments',
  'content',
  'encryptedBlob',
  'encryptedKey',
  'identityCommitment',
  'message',
  'nullifierHash',
  'passphrase',
  'privateInputs',
  'proof',
  'questionSetData',
  'realUserRefCiphertext',
  'responseText',
  'responses',
  'secret',
  'signature',
  'studentId',
  'subjectiveResponses',
  'userReferenceCiphertext'
]);

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, currentValue]) => [
      key,
      redactedKeys.has(key) ? '[REDACTED]' : redactValue(currentValue)
    ])
  );
}

export function hashPrincipal(value: string | undefined, salt: string) {
  if (!value?.trim()) {
    return null;
  }

  return sha256Hex(`${salt}:${value.trim()}`).slice(0, 16);
}

export function redactLogValue(value: unknown) {
  return redactValue(value);
}

export class PrivacySafeLogger implements LoggerService {
  constructor(private readonly salt: string) {}

  log(message: unknown, context?: string) {
    this.write('info', message, context);
  }

  error(message: unknown, trace?: string, context?: string) {
    this.write('error', message, context, trace ? { trace } : undefined);
  }

  warn(message: unknown, context?: string) {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string) {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string) {
    this.write('verbose', message, context);
  }

  write(
    level: 'debug' | 'error' | 'info' | 'verbose' | 'warn',
    message: unknown,
    context?: string,
    extra?: Record<string, unknown>
  ) {
    const redactedExtra = extra
      ? (redactValue(extra) as Record<string, unknown>)
      : undefined;
    const normalizedMessage =
      message instanceof Error
        ? {
            message: message.message,
            name: message.name
          }
        : typeof message === 'string'
          ? message
          : redactValue(message);
    const entry = {
      context: context ?? null,
      level,
      message: normalizedMessage,
      saltFingerprint: sha256Hex(this.salt).slice(0, 8),
      timestamp: new Date().toISOString(),
      ...(redactedExtra ?? {})
    };

    const serialized = JSON.stringify(entry);

    if (level === 'error') {
      console.error(serialized);
      return;
    }

    if (level === 'warn') {
      console.warn(serialized);
      return;
    }

    console.log(serialized);
  }
}
