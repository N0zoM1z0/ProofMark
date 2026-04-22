import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import {
  buildPublicExamManifest,
  getManifestPublicKeyPem,
  signManifestPayload
} from './manifest-utils.js';
import { computeSubmitScope } from './submission-utils.js';

@Injectable()
export class PublicExamService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublicExam(examId: string) {
    const exam = await this.prisma.exam.findUnique({
      where: {
        id: examId
      },
      select: {
        currentGroupRoot: true,
        endsAt: true,
        id: true,
        questionSetHash: true,
        startsAt: true,
        status: true,
        title: true,
        versions: {
          select: {
            manifestHash: true,
            version: true
          },
          orderBy: {
            version: 'desc'
          },
          take: 1
        }
      }
    });

    if (!exam) {
      throw new NotFoundException('Exam not found');
    }

    const latestVersion = exam.versions[0];

    return {
      currentGroupRoot: exam.currentGroupRoot,
      endsAt: exam.endsAt,
      examVersion: latestVersion?.version ?? 1,
      id: exam.id,
      manifestHash: latestVersion?.manifestHash ?? null,
      questionSetHash: exam.questionSetHash,
      startsAt: exam.startsAt,
      status: exam.status,
      submitScope: computeSubmitScope(exam.id, latestVersion?.version ?? 1),
      title: exam.title
    };
  }

  async getPublicManifest(examId: string) {
    const exam = await this.prisma.exam.findUnique({
      where: {
        id: examId
      },
      select: {
        answerKeyCommitment: true,
        courseId: true,
        currentGroupRoot: true,
        endsAt: true,
        gradingPolicyHash: true,
        id: true,
        questionSetHash: true,
        startsAt: true,
        status: true,
        title: true,
        versions: {
          select: {
            manifestHash: true,
            version: true
          },
          orderBy: {
            version: 'desc'
          },
          take: 1
        }
      }
    });

    if (!exam) {
      throw new NotFoundException('Exam not found');
    }

    const latestVersion = exam.versions[0];

    if (!latestVersion?.manifestHash) {
      throw new ConflictException('Manifest is not published for this exam');
    }

    const { manifest, manifestHash } = buildPublicExamManifest({
      answerKeyCommitment: exam.answerKeyCommitment!,
      courseId: exam.courseId,
      currentGroupRoot: exam.currentGroupRoot!,
      endsAt: exam.endsAt,
      examId: exam.id,
      examVersion: latestVersion.version,
      gradingPolicyHash: exam.gradingPolicyHash!,
      questionSetHash: exam.questionSetHash!,
      startsAt: exam.startsAt,
      title: exam.title
    });

    if (manifestHash !== latestVersion.manifestHash) {
      throw new ConflictException('Manifest state is inconsistent with published hash');
    }

    return {
      manifest,
      manifestHash,
      serverPublicKey: getManifestPublicKeyPem(),
      serverSignature: signManifestPayload(manifest),
      status: exam.status
    };
  }
}
