import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import {
  ExamStatus,
  GradeStatus,
  GradingTaskStatus,
  MarkerStatus,
  Prisma,
  SubmissionPartStatus,
  SubmissionStatus
} from '@prisma/client';
import {
  buildSignedMarkPayload,
  evaluateBlindMarkingScores,
  generateBlindMarkingAssignments,
  normalizeBlindMarkingPolicy,
  normalizeFixedMcqQuestionSet
} from '@proofmark/shared';
import {
  generateEd25519KeyPair,
  verifyCanonicalSignature
} from '@proofmark/crypto';
import { decryptSubmissionBlobPayload } from './blob-encryption.js';
import { BlobStorageService } from './blob-storage.service.js';
import { PrismaService } from './prisma.service.js';
import { canonicalJson, sha256Hex } from './submission-utils.js';

function normalizeOptionalDate(value: string | Date | null | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const normalizedValue = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(normalizedValue.getTime())) {
    throw new BadRequestException('Invalid ISO date');
  }

  return normalizedValue;
}

function actorPseudonym(value: string) {
  return sha256Hex(value).slice(0, 16);
}

function toNumber(value: Prisma.Decimal | number | string | null | undefined) {
  return value === null || value === undefined ? 0 : Number(value);
}

function buildCommentsHash(comments: string) {
  return `sha256:${sha256Hex(
    canonicalJson({
      comments: comments.trim(),
      version: 'proofmark-marker-comments-v1'
    })
  )}`;
}

function buildPartCommitment(params: {
  questionId: string;
  responseText: string;
  submissionId: string;
}) {
  return `sha256:${sha256Hex(
    canonicalJson({
      questionId: params.questionId,
      responseText: params.responseText,
      submissionId: params.submissionId,
      version: 'proofmark-submission-part-v1'
    })
  )}`;
}

function buildAdjudicationAssignmentCommitment(params: {
  markerId: string;
  partCommitment: string;
  submissionPartId: string;
}) {
  return `sha256:${sha256Hex(
    canonicalJson({
      markerId: params.markerId,
      partCommitment: params.partCommitment,
      submissionPartId: params.submissionPartId,
      version: 'proofmark-adjudication-assignment-v1'
    })
  )}`;
}

async function appendAuditEvent(
  tx: Prisma.TransactionClient,
  params: {
    actorPseudonym?: string | null;
    actorRole: string;
    createdAt?: Date;
    eventType: string;
    examId: string;
    payload: Record<string, unknown>;
  }
) {
  const createdAt = params.createdAt ?? new Date();
  const seq =
    (await tx.auditEvent.count({
      where: {
        examId: params.examId
      }
    })) + 1;
  const previousAuditEvent = await tx.auditEvent.findFirst({
    where: {
      examId: params.examId
    },
    orderBy: {
      seq: 'desc'
    }
  });
  const payloadHash = sha256Hex(canonicalJson(params.payload));
  const eventHash = sha256Hex(
    canonicalJson({
      actorPseudonym: params.actorPseudonym ?? null,
      actorRole: params.actorRole,
      createdAt: createdAt.toISOString(),
      eventType: params.eventType,
      examId: params.examId,
      payloadHash,
      prevEventHash: previousAuditEvent?.eventHash ?? null,
      seq
    })
  );

  return tx.auditEvent.create({
    data: {
      actorPseudonym: params.actorPseudonym ?? null,
      actorRole: params.actorRole,
      createdAt,
      eventHash,
      eventType: params.eventType,
      examId: params.examId,
      payloadHash,
      prevEventHash: previousAuditEvent?.eventHash ?? null,
      seq
    }
  });
}

@Injectable()
export class MarkingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blobStorage: BlobStorageService
  ) {}

  async enrollMarker(params: {
    adminId: string;
    examId: string;
    markerLabel: string;
    markerRef?: string | null;
  }) {
    const exam = await this.prisma.exam.findUnique({
      where: {
        id: params.examId
      },
      select: {
        id: true,
        status: true
      }
    });

    if (!exam) {
      throw new NotFoundException('Exam not found');
    }

    if (exam.status === ExamStatus.ARCHIVED) {
      throw new ConflictException('Archived exams cannot enroll new markers');
    }

    const trimmedLabel = params.markerLabel.trim();

    if (!trimmedLabel) {
      throw new BadRequestException('markerLabel is required');
    }

    const keys = generateEd25519KeyPair();

    return this.prisma.$transaction(async (tx) => {
      const marker = await tx.marker.create({
        data: {
          examId: params.examId,
          markerRef: params.markerRef ?? null,
          pseudonymLabel: trimmedLabel,
          pseudonymPrivateKey: keys.privateKeyPem,
          pseudonymPublicKey: keys.publicKeyPem,
          status: MarkerStatus.ACTIVE
        }
      });
      const auditEvent = await appendAuditEvent(tx, {
        actorPseudonym: actorPseudonym(`admin:${params.adminId}`),
        actorRole: 'ADMIN',
        eventType: 'MarkerEnrolled',
        examId: params.examId,
        payload: {
          markerId: marker.id,
          pseudonymLabel: marker.pseudonymLabel
        }
      });

      return {
        auditEventId: auditEvent.id,
        markerId: marker.id,
        markerPrivateKey: keys.privateKeyPem,
        markerPublicKey: keys.publicKeyPem,
        pseudonymLabel: marker.pseudonymLabel
      };
    });
  }

  async generateAssignments(params: {
    adminId: string;
    dueAt?: string | Date | null;
    examId: string;
    seed: string;
  }) {
    if (!params.seed.trim()) {
      throw new BadRequestException('seed is required');
    }

    const dueAt = normalizeOptionalDate(params.dueAt) ?? null;
    const exam = await this.prisma.exam.findUnique({
      where: {
        id: params.examId
      },
      select: {
        gradingPolicyData: true,
        id: true,
        questionSetData: true,
        status: true
      }
    });

    if (!exam) {
      throw new NotFoundException('Exam not found');
    }

    if (exam.status !== ExamStatus.CLOSED) {
      throw new ConflictException('Assignments can only be generated from CLOSED exams');
    }

    if (!exam.questionSetData) {
      throw new ConflictException('questionSet must be configured before assignment generation');
    }

    const questionSet = normalizeFixedMcqQuestionSet(exam.questionSetData);
    const subjectiveQuestions = questionSet.subjectiveQuestions ?? [];

    if (subjectiveQuestions.length === 0) {
      throw new ConflictException('This exam has no subjective questions to assign');
    }

    const existingTasks = await this.prisma.gradingTask.count({
      where: {
        examId: params.examId
      }
    });

    if (existingTasks > 0) {
      throw new ConflictException('Assignments already exist for this exam');
    }

    const markers = await this.prisma.marker.findMany({
      where: {
        examId: params.examId,
        status: MarkerStatus.ACTIVE
      },
      orderBy: {
        addedAt: 'asc'
      }
    });
    const policy = normalizeBlindMarkingPolicy(
      Object.prototype.toString.call(exam.gradingPolicyData) === '[object Object]'
        ? (exam.gradingPolicyData as Record<string, unknown>).subjectiveMarking as
            | Partial<{
                adjudicationDelta: number;
                markersPerPart: number;
              }>
            | undefined
        : undefined
    );

    if (markers.length < policy.markersPerPart) {
      throw new ConflictException('Not enough active markers for the configured policy');
    }

    const submissions = await this.prisma.submission.findMany({
      where: {
        examId: params.examId,
        status: SubmissionStatus.ACCEPTED
      },
      orderBy: {
        submissionIndex: 'asc'
      },
      select: {
        encryptedBlobUri: true,
        id: true
      }
    });

    if (submissions.length === 0) {
      throw new ConflictException('No accepted submissions are available for marking');
    }

    const submissionPartsToCreate: Array<{
      examId: string;
      maxScore: number;
      partCommitment: string;
      partIndex: number;
      prompt: string;
      questionId: string;
      responseText: string;
      rubricHash: string;
      submissionId: string;
    }> = [];

    for (const submission of submissions) {
      const serializedBlob = await this.blobStorage.getEncryptedSubmissionBlob(
        submission.encryptedBlobUri
      );
      const decryptedBlob = decryptSubmissionBlobPayload(serializedBlob);
      const subjectiveResponseMap = new Map(
        (decryptedBlob.answerSheet.subjectiveResponses ?? []).map((response) => [
          response.questionId,
          response.responseText
        ])
      );

      for (const [partIndex, question] of subjectiveQuestions.entries()) {
        const responseText = subjectiveResponseMap.get(question.id)?.trim() ?? '';

        submissionPartsToCreate.push({
          examId: params.examId,
          maxScore: question.maxScore,
          partCommitment: buildPartCommitment({
            questionId: question.id,
            responseText,
            submissionId: submission.id
          }),
          partIndex,
          prompt: question.prompt,
          questionId: question.id,
          responseText,
          rubricHash: question.rubricHash,
          submissionId: submission.id
        });
      }
    }

    const assignmentPlan = await generateBlindMarkingAssignments({
      markerIds: markers.map((marker) => marker.id),
      policy,
      seed: params.seed,
      submissionPartIds: submissionPartsToCreate.map((part) => part.partCommitment)
    });

    return this.prisma.$transaction(async (tx) => {
      const seedEvent = await appendAuditEvent(tx, {
        actorPseudonym: actorPseudonym(`admin:${params.adminId}`),
        actorRole: 'ADMIN',
        eventType: 'AssignmentSeedCommitted',
        examId: params.examId,
        payload: {
          markerRoot: assignmentPlan.markerRoot,
          policy,
          seed: params.seed,
          submissionRoot: assignmentPlan.submissionRoot
        }
      });

      const createdParts = [];

      for (const part of submissionPartsToCreate) {
        createdParts.push(
          await tx.submissionPart.create({
            data: {
              examId: part.examId,
              maxScore: part.maxScore,
              partCommitment: part.partCommitment,
              partIndex: part.partIndex,
              prompt: part.prompt,
              questionId: part.questionId,
              responseText: part.responseText,
              rubricHash: part.rubricHash,
              submissionId: part.submissionId
            }
          })
        );
      }

      const partByCommitment = new Map(
        createdParts.map((part) => [part.partCommitment, part] as const)
      );
      const assignmentEvent = await appendAuditEvent(tx, {
        actorPseudonym: actorPseudonym(`admin:${params.adminId}`),
        actorRole: 'ADMIN',
        eventType: 'AssignmentsGenerated',
        examId: params.examId,
        payload: {
          assignmentRoot: assignmentPlan.assignmentRoot,
          markerCount: markers.length,
          partCount: createdParts.length,
          policy,
          seedAuditEventId: seedEvent.id
        }
      });

      for (const assignment of assignmentPlan.assignments) {
        const submissionPart = partByCommitment.get(assignment.submissionPartId);

        if (!submissionPart) {
          throw new NotFoundException('Submission part missing during assignment generation');
        }

        await tx.gradingTask.create({
          data: {
            assignmentCommitment: assignment.assignmentCommitment,
            assignmentOrdinal: assignment.assignmentOrdinal,
            auditEventId: assignmentEvent.id,
            dueAt,
            examId: params.examId,
            markerId: assignment.markerId,
            status: GradingTaskStatus.ASSIGNED,
            submissionPartId: submissionPart.id
          }
        });
      }

      await tx.exam.update({
        where: {
          id: params.examId
        },
        data: {
          status: ExamStatus.MARKING
        }
      });

      return {
        assignmentRoot: assignmentPlan.assignmentRoot,
        auditEventId: assignmentEvent.id,
        dueAt,
        markerRoot: assignmentPlan.markerRoot,
        partCount: createdParts.length,
        policy,
        seedAuditEventId: seedEvent.id,
        submissionRoot: assignmentPlan.submissionRoot,
        taskCount: assignmentPlan.assignments.length
      };
    });
  }

  async listMarkerExams(markerId: string) {
    const marker = await this.prisma.marker.findUnique({
      where: {
        id: markerId
      },
      include: {
        exam: {
          select: {
            id: true,
            status: true,
            title: true
          }
        },
        gradingTasks: {
          orderBy: {
            createdAt: 'asc'
          }
        }
      }
    });

    if (!marker || marker.status !== MarkerStatus.ACTIVE) {
      throw new NotFoundException('Marker not found');
    }

    return [
      {
        examId: marker.exam.id,
        examStatus: marker.exam.status,
        pendingTaskCount: marker.gradingTasks.filter(
          (task) => task.status === GradingTaskStatus.ASSIGNED
        ).length,
        pseudonymLabel: marker.pseudonymLabel,
        title: marker.exam.title,
        totalTaskCount: marker.gradingTasks.length
      }
    ];
  }

  async listMarkerTasks(examId: string, markerId: string) {
    const marker = await this.prisma.marker.findUnique({
      where: {
        id: markerId
      },
      select: {
        examId: true,
        id: true,
        pseudonymLabel: true,
        status: true
      }
    });

    if (!marker || marker.examId !== examId || marker.status !== MarkerStatus.ACTIVE) {
      throw new NotFoundException('Marker not found');
    }

    const tasks = await this.prisma.gradingTask.findMany({
      where: {
        examId,
        markerId
      },
      orderBy: [
        {
          status: 'asc'
        },
        {
          createdAt: 'asc'
        }
      ],
      include: {
        submissionPart: {
          select: {
            maxScore: true,
            prompt: true,
            questionId: true,
            rubricHash: true,
            status: true
          }
        }
      }
    });

    return {
      examId,
      markerId,
      pseudonymLabel: marker.pseudonymLabel,
      tasks: tasks.map((task) => ({
        dueAt: task.dueAt,
        maxScore: toNumber(task.submissionPart.maxScore),
        prompt: task.submissionPart.prompt,
        questionId: task.submissionPart.questionId,
        rubricHash: task.submissionPart.rubricHash,
        status: task.status,
        submissionPartStatus: task.submissionPart.status,
        taskId: task.id
      }))
    };
  }

  async getMarkerTask(taskId: string, markerId: string) {
    const task = await this.prisma.gradingTask.findUnique({
      where: {
        id: taskId
      },
      include: {
        exam: {
          select: {
            id: true,
            status: true,
            title: true
          }
        },
        marker: {
          select: {
            id: true,
            pseudonymLabel: true,
            status: true
          }
        },
        submissionPart: {
          select: {
            id: true,
            maxScore: true,
            prompt: true,
            questionId: true,
            responseText: true,
            rubricHash: true,
            status: true
          }
        }
      }
    });

    if (
      !task ||
      task.markerId !== markerId ||
      task.marker.status !== MarkerStatus.ACTIVE
    ) {
      throw new NotFoundException('Task not found');
    }

    return {
      exam: task.exam,
      marker: {
        markerId: task.marker.id,
        pseudonymLabel: task.marker.pseudonymLabel
      },
      task: {
        dueAt: task.dueAt,
        markPayloadBase: {
          gradingTaskId: task.id,
          markerId: task.marker.id,
          maxScore: toNumber(task.submissionPart.maxScore),
          rubricHash: task.submissionPart.rubricHash,
          submissionPartId: task.submissionPart.id
        },
        prompt: task.submissionPart.prompt,
        questionId: task.submissionPart.questionId,
        responseText: task.submissionPart.responseText,
        status: task.status,
        submissionPartStatus: task.submissionPart.status,
        taskId: task.id
      }
    };
  }

  async submitMark(params: {
    comments: string;
    markerId: string;
    score: number;
    signature: string;
    taskId: string;
  }) {
    const task = await this.prisma.gradingTask.findUnique({
      where: {
        id: params.taskId
      },
      include: {
        exam: {
          select: {
            gradingPolicyData: true,
            id: true,
            status: true
          }
        },
        marker: {
          select: {
            id: true,
            pseudonymLabel: true,
            pseudonymPublicKey: true,
            status: true
          }
        },
        submissionPart: {
          select: {
            examId: true,
            id: true,
            maxScore: true,
            partCommitment: true,
            rubricHash: true,
            submissionId: true
          }
        }
      }
    });

    if (
      !task ||
      task.markerId !== params.markerId ||
      task.marker.status !== MarkerStatus.ACTIVE
    ) {
      throw new NotFoundException('Task not found');
    }

    if (task.exam.status !== ExamStatus.MARKING) {
      throw new ConflictException('The exam is not currently accepting subjective marks');
    }

    if (task.status !== GradingTaskStatus.ASSIGNED) {
      throw new ConflictException('This grading task is no longer assignable');
    }

    const maxScore = toNumber(task.submissionPart.maxScore);

    if (!Number.isFinite(params.score) || params.score < 0 || params.score > maxScore) {
      throw new BadRequestException('score must be within the question score range');
    }

    const commentsHash = buildCommentsHash(params.comments);
    const signedPayload = buildSignedMarkPayload({
      commentsHash,
      gradingTaskId: task.id,
      markerId: task.marker.id,
      maxScore,
      rubricHash: task.submissionPart.rubricHash,
      score: params.score,
      submissionPartId: task.submissionPart.id
    });

    if (
      !verifyCanonicalSignature(
        signedPayload,
        params.signature,
        task.marker.pseudonymPublicKey
      )
    ) {
      throw new BadRequestException('MARK_SIGNATURE_INVALID');
    }

    const policy = normalizeBlindMarkingPolicy(
      Object.prototype.toString.call(task.exam.gradingPolicyData) === '[object Object]'
        ? (task.exam.gradingPolicyData as Record<string, unknown>).subjectiveMarking as
            | Partial<{
                adjudicationDelta: number;
                markersPerPart: number;
              }>
            | undefined
        : undefined
    );

    return this.prisma.$transaction(async (tx) => {
      const auditEvent = await appendAuditEvent(tx, {
        actorPseudonym: task.marker.pseudonymLabel,
        actorRole: 'MARKER',
        eventType: 'MarkSubmitted',
        examId: task.exam.id,
        payload: {
          commentsHash,
          gradingTaskId: task.id,
          score: params.score,
          submissionPartId: task.submissionPart.id
        }
      });
      const createdMark = await tx.mark.create({
        data: {
          auditEventId: auditEvent.id,
          commentsHash,
          examId: task.exam.id,
          gradingTaskId: task.id,
          markerId: task.marker.id,
          markerSignature: params.signature,
          maxScore,
          rubricHash: task.submissionPart.rubricHash,
          score: params.score,
          submissionPartId: task.submissionPart.id
        }
      });

      await tx.gradingTask.update({
        where: {
          id: task.id
        },
        data: {
          auditEventId: auditEvent.id,
          status: GradingTaskStatus.SUBMITTED
        }
      });

      const aggregation = await this.recalculateSubmissionPart(tx, {
        examId: task.exam.id,
        policy,
        submissionId: task.submissionPart.submissionId,
        submissionPartId: task.submissionPart.id
      });

      return {
        adjudicationRequired: aggregation.adjudicationRequired,
        markId: createdMark.id,
        score: createdMark.score,
        status: aggregation.status,
        taskId: task.id
      };
    });
  }

  private async recalculateSubmissionPart(
    tx: Prisma.TransactionClient,
    params: {
      examId: string;
      policy: ReturnType<typeof normalizeBlindMarkingPolicy>;
      submissionId: string;
      submissionPartId: string;
    }
  ) {
    const submissionPart = await tx.submissionPart.findUnique({
      where: {
        id: params.submissionPartId
      },
      include: {
        gradingTasks: {
          orderBy: {
            assignmentOrdinal: 'asc'
          }
        },
        marks: {
          orderBy: {
            createdAt: 'asc'
          }
        }
      }
    });

    if (!submissionPart) {
      throw new NotFoundException('Submission part not found');
    }

    const evaluation = evaluateBlindMarkingScores({
      marks: submissionPart.marks.map((mark) => ({
        markerId: mark.markerId,
        score: toNumber(mark.score)
      })),
      maxScore: toNumber(submissionPart.maxScore),
      policy: params.policy
    });

    if (evaluation.shouldCreateAdjudication) {
      const assignedMarkerIds = new Set(
        submissionPart.gradingTasks.map((task) => task.markerId)
      );
      const adjudicator = await tx.marker.findFirst({
        where: {
          examId: params.examId,
          id: {
            notIn: [...assignedMarkerIds]
          },
          status: MarkerStatus.ACTIVE
        },
        orderBy: {
          addedAt: 'asc'
        }
      });

      await tx.submissionPart.update({
        where: {
          id: submissionPart.id
        },
        data: {
          status: SubmissionPartStatus.ADJUDICATION_REQUIRED
        }
      });

      if (adjudicator) {
        const auditEvent = await appendAuditEvent(tx, {
          actorRole: 'MARKING_ENGINE',
          eventType: 'AdjudicationRequested',
          examId: params.examId,
          payload: {
            adjudicatorMarkerId: adjudicator.id,
            submissionPartId: submissionPart.id
          }
        });

        await tx.gradingTask.create({
          data: {
            assignmentCommitment: buildAdjudicationAssignmentCommitment({
              markerId: adjudicator.id,
              partCommitment: submissionPart.partCommitment,
              submissionPartId: submissionPart.id
            }),
            assignmentOrdinal: submissionPart.gradingTasks.length + 1,
            auditEventId: auditEvent.id,
            examId: params.examId,
            markerId: adjudicator.id,
            status: GradingTaskStatus.ASSIGNED,
            submissionPartId: submissionPart.id
          }
        });
      }

      return {
        adjudicationRequired: true,
        status: SubmissionPartStatus.ADJUDICATION_REQUIRED
      };
    }

    if (!evaluation.finalized || evaluation.averageScore === null) {
      return {
        adjudicationRequired: false,
        status: submissionPart.status
      };
    }

    await tx.submissionPart.update({
      where: {
        id: submissionPart.id
      },
      data: {
        score: evaluation.averageScore,
        status: SubmissionPartStatus.GRADED
      }
    });

    await this.syncSubmissionGrade(tx, {
      examId: params.examId,
      submissionId: params.submissionId
    });

    return {
      adjudicationRequired: evaluation.adjudicationRequired,
      status: SubmissionPartStatus.GRADED
    };
  }

  private async syncSubmissionGrade(
    tx: Prisma.TransactionClient,
    params: {
      examId: string;
      submissionId: string;
    }
  ) {
    const submissionParts = await tx.submissionPart.findMany({
      where: {
        submissionId: params.submissionId
      },
      orderBy: {
        partIndex: 'asc'
      }
    });

    if (
      submissionParts.length === 0 ||
      submissionParts.some((part) => part.status !== SubmissionPartStatus.GRADED)
    ) {
      return;
    }

    const subjectiveScore = submissionParts.reduce(
      (total, part) => total + toNumber(part.score),
      0
    );
    const subjectiveMaxScore = submissionParts.reduce(
      (total, part) => total + toNumber(part.maxScore),
      0
    );
    const latestGrade = await tx.grade.findFirst({
      where: {
        examId: params.examId,
        status: {
          in: [GradeStatus.DRAFT, GradeStatus.VERIFIED]
        },
        submissionId: params.submissionId
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (latestGrade) {
      const objectiveScore = toNumber(latestGrade.objectiveScore);
      const previousSubjectiveScore = toNumber(latestGrade.subjectiveScore);
      const objectiveMaxScore =
        latestGrade.objectiveScore === null
          ? 0
          : Math.max(toNumber(latestGrade.maxScore) - previousSubjectiveScore, 0);

      await tx.grade.update({
        where: {
          id: latestGrade.id
        },
        data: {
          finalScore: objectiveScore + subjectiveScore,
          gradeCommitment: `sha256:${sha256Hex(
            canonicalJson({
              objectiveScore,
              subjectiveScore,
              submissionId: params.submissionId,
              version: 'proofmark-grade-commitment-v2'
            })
          )}`,
          maxScore: objectiveMaxScore + subjectiveMaxScore,
          subjectiveScore
        }
      });
    } else {
      await tx.grade.create({
        data: {
          examId: params.examId,
          finalScore: subjectiveScore,
          gradeCommitment: `sha256:${sha256Hex(
            canonicalJson({
              objectiveScore: 0,
              submissionId: params.submissionId,
              subjectiveScore,
              version: 'proofmark-grade-commitment-v2'
            })
          )}`,
          maxScore: subjectiveMaxScore,
          status: GradeStatus.VERIFIED,
          subjectiveScore,
          submissionId: params.submissionId
        }
      });
    }

    const remainingUngradedParts = await tx.submissionPart.count({
      where: {
        examId: params.examId,
        status: {
          not: SubmissionPartStatus.GRADED
        }
      }
    });
    const exam = await tx.exam.findUnique({
      where: {
        id: params.examId
      },
      select: {
        status: true
      }
    });

    if (remainingUngradedParts === 0 && exam?.status === ExamStatus.MARKING) {
      await tx.exam.update({
        where: {
          id: params.examId
        },
        data: {
          status: ExamStatus.GRADING
        }
      });
      await appendAuditEvent(tx, {
        actorRole: 'MARKING_ENGINE',
        eventType: 'SubjectiveAggregationCompleted',
        examId: params.examId,
        payload: {
          submissionId: params.submissionId
        }
      });
    }
  }
}
