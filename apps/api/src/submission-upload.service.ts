import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { ExamStatus } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { PrismaService } from './prisma.service.js';
import { BlobStorageService } from './blob-storage.service.js';
import { canonicalJson, sha256Hex } from './submission-utils.js';

type UploadTokenPayload = {
  encryptedBlobHash: string;
  examId: string;
  examVersion: number;
  expiresAt: string;
  objectKey: string;
};

function normalizeHash(value: string) {
  return value.startsWith('sha256:') ? value : `sha256:${value}`;
}

function getUploadTokenSecret() {
  return process.env.UPLOAD_TOKEN_SECRET ?? 'proofmark-dev-upload-secret';
}

function signTokenPayload(payload: UploadTokenPayload) {
  return createHmac('sha256', getUploadTokenSecret())
    .update(canonicalJson(payload))
    .digest('base64url');
}

function encodeToken(payload: UploadTokenPayload) {
  return `${Buffer.from(canonicalJson(payload)).toString('base64url')}.${signTokenPayload(
    payload
  )}`;
}

function decodeToken(token: string): UploadTokenPayload {
  const [encodedPayload, signature] = token.split('.');

  if (!encodedPayload || !signature) {
    throw new BadRequestException('UPLOAD_TOKEN_INVALID');
  }

  const payload = JSON.parse(
    Buffer.from(encodedPayload, 'base64url').toString('utf8')
  ) as UploadTokenPayload;

  if (signTokenPayload(payload) !== signature) {
    throw new BadRequestException('UPLOAD_TOKEN_INVALID');
  }

  if (new Date(payload.expiresAt).getTime() <= Date.now()) {
    throw new BadRequestException('UPLOAD_TOKEN_EXPIRED');
  }

  return payload;
}

@Injectable()
export class SubmissionUploadService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BlobStorageService)
    private readonly blobStorage: BlobStorageService
  ) {}

  async createUploadUrl(params: {
    examId: string;
    examVersion: number;
    encryptedBlobHash: string;
  }) {
    const exam = await this.prisma.exam.findUnique({
      where: {
        id: params.examId
      },
      select: {
        id: true,
        status: true,
        versions: {
          orderBy: {
            version: 'desc'
          },
          select: {
            version: true
          },
          take: 1
        }
      }
    });

    if (!exam) {
      throw new NotFoundException('Exam not found');
    }

    if (exam.status !== ExamStatus.OPEN) {
      throw new ConflictException('EXAM_NOT_OPEN');
    }

    const currentExamVersion = exam.versions[0]?.version ?? 1;

    if (params.examVersion !== currentExamVersion) {
      throw new BadRequestException('EXAM_VERSION_MISMATCH');
    }

    const encryptedBlobHash = normalizeHash(params.encryptedBlobHash);
    const objectKey = this.blobStorage.buildSubmissionObjectKey({
      encryptedBlobHash,
      examId: exam.id,
      examVersion: currentExamVersion
    });
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const token = encodeToken({
      encryptedBlobHash,
      examId: exam.id,
      examVersion: currentExamVersion,
      expiresAt,
      objectKey
    });
    const publicApiBaseUrl =
      process.env.PUBLIC_API_BASE_URL ??
      `http://localhost:${Number(process.env.PORT ?? 3001)}`;

    return {
      encryptedBlobUri: this.blobStorage.createBlobUri(objectKey),
      expiresAt,
      method: 'PUT',
      uploadHeaders: {
        'content-type': 'application/json'
      },
      uploadUrl: `${publicApiBaseUrl}/api/public/uploads/${token}`
    };
  }

  async uploadEncryptedBlob(params: { token: string; body: unknown }) {
    const payload = decodeToken(params.token);
    const content = canonicalJson(params.body);
    const computedHash = `sha256:${sha256Hex(content)}`;

    if (computedHash !== normalizeHash(payload.encryptedBlobHash)) {
      throw new BadRequestException('ENCRYPTED_BLOB_HASH_MISMATCH');
    }

    await this.blobStorage.putEncryptedSubmissionBlob({
      content,
      encryptedBlobHash: computedHash,
      objectKey: payload.objectKey
    });

    return {
      encryptedBlobHash: computedHash,
      encryptedBlobUri: this.blobStorage.createBlobUri(payload.objectKey),
      stored: true
    };
  }
}
