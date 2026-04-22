import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

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
        title: true
      }
    });

    if (!exam) {
      throw new NotFoundException('Exam not found');
    }

    return exam;
  }
}
