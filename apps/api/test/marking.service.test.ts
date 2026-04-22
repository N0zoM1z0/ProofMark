import { BadRequestException } from '@nestjs/common';
import { ExamStatus, GradingTaskStatus, MarkerStatus, SubmissionPartStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { buildSignedMarkPayload } from '@proofmark/shared';
import { generateEd25519KeyPair } from '@proofmark/crypto';
import { MarkingService } from '../src/marking.service.js';

describe('MarkingService', () => {
  it('returns blinded task content without candidate identity metadata', async () => {
    const service = new MarkingService(
      {
        gradingTask: {
          findUnique: async () => ({
            exam: {
              id: 'exam-1',
              status: ExamStatus.MARKING,
              title: 'Blind Marking Demo'
            },
            marker: {
              id: 'marker-1',
              pseudonymLabel: 'marker-alpha',
              status: MarkerStatus.ACTIVE
            },
            markerId: 'marker-1',
            submissionPart: {
              id: 'part-1',
              maxScore: 10,
              prompt: 'Explain the privacy benefit of blind marking.',
              questionId: 'essay-1',
              responseText: 'The marker cannot identify the candidate.',
              rubricHash: 'sha256:rubric',
              status: SubmissionPartStatus.READY
            },
            status: GradingTaskStatus.ASSIGNED
          })
        }
      } as never,
      {} as never
    );

    const result = await service.getMarkerTask('task-1', 'marker-1');

    expect(result.task).toMatchObject({
      prompt: 'Explain the privacy benefit of blind marking.',
      questionId: 'essay-1',
      responseText: 'The marker cannot identify the candidate.'
    });
    expect(JSON.stringify(result)).not.toContain('submissionId');
    expect(JSON.stringify(result)).not.toContain('userReferenceCiphertext');
  });

  it('rejects marks when the marker signature does not verify', async () => {
    const { publicKeyPem } = generateEd25519KeyPair();
    const service = new MarkingService(
      {
        gradingTask: {
          findUnique: async () => ({
            exam: {
              gradingPolicyData: null,
              id: 'exam-1',
              status: ExamStatus.MARKING
            },
            id: 'task-1',
            marker: {
              id: 'marker-1',
              pseudonymLabel: 'marker-alpha',
              pseudonymPublicKey: publicKeyPem,
              status: MarkerStatus.ACTIVE
            },
            markerId: 'marker-1',
            status: GradingTaskStatus.ASSIGNED,
            submissionPart: {
              examId: 'exam-1',
              id: 'part-1',
              maxScore: 10,
              partCommitment: 'sha256:part',
              rubricHash: 'sha256:rubric',
              submissionId: 'submission-1'
            }
          })
        }
      } as never,
      {} as never
    );

    const invalidPayload = buildSignedMarkPayload({
      commentsHash: 'sha256:comments',
      gradingTaskId: 'task-1',
      markerId: 'marker-1',
      maxScore: 10,
      rubricHash: 'sha256:rubric',
      score: 7,
      submissionPartId: 'part-1'
    });

    await expect(
      service.submitMark({
        comments: 'Looks reasonable.',
        markerId: 'marker-1',
        score: 7,
        signature: invalidPayload.commentsHash,
        taskId: 'task-1'
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
