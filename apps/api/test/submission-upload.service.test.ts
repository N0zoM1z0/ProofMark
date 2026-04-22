import { BadRequestException, ConflictException } from '@nestjs/common';
import { ExamStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { SubmissionUploadService } from '../src/submission-upload.service.js';
import { canonicalJson, sha256Hex } from '../src/submission-utils.js';

type ExamRecord = {
  id: string;
  status: ExamStatus;
  versions: Array<{
    version: number;
  }>;
};

function createService(exam: ExamRecord) {
  const prisma = {
    exam: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === exam.id ? exam : null
      )
    }
  };
  const blobStorage = {
    buildSubmissionObjectKey: vi.fn(
      ({
        examId,
        examVersion,
        encryptedBlobHash
      }: {
        examId: string;
        examVersion: number;
        encryptedBlobHash: string;
      }) =>
        `submissions/${examId}/v${examVersion}/${encryptedBlobHash.replace(
          /^sha256:/,
          ''
        )}.json`
    ),
    createBlobUri: vi.fn((objectKey: string) => `s3://proofmark-local/${objectKey}`),
    putEncryptedSubmissionBlob: vi.fn(async () => undefined)
  };

  return {
    blobStorage,
    prisma,
    service: new SubmissionUploadService(prisma as never, blobStorage as never)
  };
}

describe('SubmissionUploadService', () => {
  it('creates a deterministic upload URL for an open exam', async () => {
    const { service } = createService({
      id: 'exam-1',
      status: ExamStatus.OPEN,
      versions: [{ version: 2 }]
    });
    const result = await service.createUploadUrl({
      encryptedBlobHash: 'sha256:abcd',
      examId: 'exam-1',
      examVersion: 2
    });

    expect(result.encryptedBlobUri).toBe(
      's3://proofmark-local/submissions/exam-1/v2/abcd.json'
    );
    expect(result.uploadUrl).toContain('/api/public/uploads/');
    expect(result.method).toBe('PUT');
  });

  it('rejects presign requests for the wrong exam version', async () => {
    const { service } = createService({
      id: 'exam-1',
      status: ExamStatus.OPEN,
      versions: [{ version: 3 }]
    });

    await expect(
      service.createUploadUrl({
        encryptedBlobHash: 'sha256:abcd',
        examId: 'exam-1',
        examVersion: 2
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects presign requests while the exam is not open', async () => {
    const { service } = createService({
      id: 'exam-1',
      status: ExamStatus.PUBLISHED,
      versions: [{ version: 1 }]
    });

    await expect(
      service.createUploadUrl({
        encryptedBlobHash: 'sha256:abcd',
        examId: 'exam-1',
        examVersion: 1
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('stores encrypted blobs only when the canonical body hash matches the token', async () => {
    const { blobStorage, service } = createService({
      id: 'exam-1',
      status: ExamStatus.OPEN,
      versions: [{ version: 1 }]
    });
    const payload = {
      algorithm: 'aes-256-gcm+rsa-oaep-sha256',
      ciphertext: 'abc',
      encryptedKey: 'def',
      iv: 'ghi',
      version: 'proofmark-encrypted-answer-v1'
    };
    const upload = await service.createUploadUrl({
      encryptedBlobHash: `sha256:${sha256Hex(canonicalJson(payload))}`,
      examId: 'exam-1',
      examVersion: 1
    });
    const token = upload.uploadUrl.split('/').at(-1)!;

    await service.uploadEncryptedBlob({
      body: payload,
      token
    });

    expect(blobStorage.putEncryptedSubmissionBlob).toHaveBeenCalledOnce();
  });
});
