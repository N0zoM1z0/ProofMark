import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { getApiRuntimeConfig, type ApiRuntimeConfig } from './config.js';

function encodeCounter(counter: number) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  return buffer;
}

export function generateTotpCode(secret: string, now = Date.now(), stepMs = 30_000) {
  const counter = Math.floor(now / stepMs);
  const digest = createHmac('sha1', Buffer.from(secret, 'utf8'))
    .update(encodeCounter(counter))
    .digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return String(binary % 1_000_000).padStart(6, '0');
}

export function verifyTotpCode(params: {
  code: string;
  config: Pick<ApiRuntimeConfig, 'adminMfaSecret' | 'adminMfaSkewSteps'>;
  now?: number;
}) {
  const normalizedCode = params.code.trim();

  if (!/^\d{6}$/.test(normalizedCode)) {
    return false;
  }

  const now = params.now ?? Date.now();

  for (
    let offset = -params.config.adminMfaSkewSteps;
    offset <= params.config.adminMfaSkewSteps;
    offset += 1
  ) {
    if (
      generateTotpCode(
        params.config.adminMfaSecret,
        now + offset * 30_000
      ) === normalizedCode
    ) {
      return true;
    }
  }

  return false;
}

@Injectable()
export class AdminAuthService {
  private readonly config: ApiRuntimeConfig;

  constructor() {
    this.config = getApiRuntimeConfig();
  }

  authorize(params: { adminId?: string; mfaCode?: string }) {
    const adminId = params.adminId?.trim();

    if (!adminId) {
      throw new BadRequestException('Missing x-admin-id header');
    }

    if (!this.config.adminAllowedIds.has(adminId)) {
      throw new ForbiddenException('ADMIN_ROLE_REQUIRED');
    }

    if (!params.mfaCode?.trim()) {
      throw new UnauthorizedException('Missing x-admin-mfa-code header');
    }

    if (
      !verifyTotpCode({
        code: params.mfaCode,
        config: this.config
      })
    ) {
      throw new UnauthorizedException('ADMIN_MFA_INVALID');
    }

    return adminId;
  }
}
