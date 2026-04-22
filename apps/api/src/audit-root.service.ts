import {
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { EligibleCommitmentStatus } from '@prisma/client';
import { Group } from '@semaphore-protocol/group';
import { PrismaService } from './prisma.service.js';
import { calculateMerkleRoot } from './submission-utils.js';

@Injectable()
export class AuditRootService {
  constructor(private readonly prisma: PrismaService) {}

  async listAuditRoots(examId: string) {
    const exam = await this.prisma.exam.findUnique({
      where: {
        id: examId
      },
      select: {
        id: true
      }
    });

    if (!exam) {
      throw new NotFoundException('Exam not found');
    }

    const auditEvents = await this.prisma.auditEvent.findMany({
      where: {
        examId
      },
      orderBy: {
        seq: 'asc'
      },
      select: {
        createdAt: true,
        eventHash: true,
        eventType: true,
        seq: true
      }
    });
    const persistedRoots = await this.prisma.auditRoot.findMany({
      where: {
        examId
      },
      orderBy: {
        toSeq: 'asc'
      }
    });
    const persistedBySeq = new Map(
      persistedRoots.map((root) => [root.toSeq, root] as const)
    );
    const snapshots = [...persistedRoots];
    const latestPersistedSeq = persistedRoots.at(-1)?.toSeq ?? 0;

    if (auditEvents.length > latestPersistedSeq) {
      let previousRoot = persistedRoots.at(-1)?.merkleRoot ?? null;

      for (let index = 0; index < auditEvents.length; index += 1) {
        const auditEvent = auditEvents[index]!;

        if (persistedBySeq.has(auditEvent.seq)) {
          previousRoot = persistedBySeq.get(auditEvent.seq)!.merkleRoot;
          continue;
        }

        const merkleRoot =
          calculateMerkleRoot(
            auditEvents.slice(0, index + 1).map((event) => event.eventHash)
          ) ?? auditEvent.eventHash;
        const createdRoot = await this.prisma.auditRoot.create({
          data: {
            createdAt: auditEvent.createdAt,
            examId,
            fromSeq: 1,
            merkleRoot,
            phase: auditEvent.eventType,
            prevPhaseRoot: previousRoot,
            toSeq: auditEvent.seq
          }
        });

        snapshots.push(createdRoot);
        previousRoot = createdRoot.merkleRoot;
      }
    }

    return {
      currentAuditRoot: snapshots.at(-1)?.merkleRoot ?? null,
      currentEventCount: auditEvents.length,
      examId,
      snapshots: snapshots
        .sort((left, right) => left.toSeq - right.toSeq)
        .map((snapshot) => ({
          createdAt: snapshot.createdAt,
          fromSeq: snapshot.fromSeq,
          id: snapshot.id,
          merkleRoot: snapshot.merkleRoot,
          phase: snapshot.phase,
          prevPhaseRoot: snapshot.prevPhaseRoot,
          toSeq: snapshot.toSeq
        }))
    };
  }

  async listGroupRoots(examId: string) {
    const exam = await this.prisma.exam.findUnique({
      where: {
        id: examId
      },
      select: {
        currentGroupRoot: true,
        id: true
      }
    });

    if (!exam) {
      throw new NotFoundException('Exam not found');
    }

    const commitments = await this.prisma.eligibleCommitment.findMany({
      where: {
        examId,
        status: EligibleCommitmentStatus.ACTIVE
      },
      orderBy: [
        {
          addedAt: 'asc'
        },
        {
          id: 'asc'
        }
      ],
      select: {
        addedAt: true,
        identityCommitment: true
      }
    });
    const memberCommitments: bigint[] = [];
    const history = commitments.map((commitment, index) => {
      memberCommitments.push(BigInt(commitment.identityCommitment));
      const group = new Group(memberCommitments);

      return {
        addedAt: commitment.addedAt,
        groupRoot: group.root.toString(),
        groupSnapshotVersion: index + 1,
        identityCommitment: commitment.identityCommitment,
        memberCount: index + 1
      };
    });

    return {
      currentGroupRoot: exam.currentGroupRoot,
      examId,
      history
    };
  }
}
