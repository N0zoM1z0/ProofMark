import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post
} from '@nestjs/common';
import { WalletRecoveryService } from './wallet-recovery.service.js';

type RecoveryPackageBody = {
  encryptedRecord?: {
    ciphertext?: string;
    commitment?: string;
    iv?: string;
    salt?: string;
    version?: number;
  };
  operatorWrapCiphertext?: string | null;
};

type RecoveryRequestBody = {
  reason?: string | null;
};

function requireStudentId(studentId: string | undefined) {
  if (!studentId?.trim()) {
    throw new BadRequestException('Missing x-student-id header');
  }

  return studentId;
}

@Controller('api/student/exams')
export class StudentRecoveryController {
  constructor(
    @Inject(WalletRecoveryService)
    private readonly walletRecoveryService: WalletRecoveryService
  ) {}

  @Get(':examId/recovery-package')
  async getRecoveryPackage(
    @Param('examId') examId: string,
    @Headers('x-student-id') studentId: string | undefined
  ) {
    return this.walletRecoveryService.getStudentRecoveryPackage({
      examId,
      studentId: requireStudentId(studentId)
    });
  }

  @Post(':examId/recovery-package')
  async escrowRecoveryPackage(
    @Param('examId') examId: string,
    @Headers('x-student-id') studentId: string | undefined,
    @Body() body: RecoveryPackageBody
  ) {
    if (
      !body.encryptedRecord?.ciphertext ||
      !body.encryptedRecord.commitment ||
      !body.encryptedRecord.iv ||
      !body.encryptedRecord.salt ||
      body.encryptedRecord.version !== 1
    ) {
      throw new BadRequestException('Valid encryptedRecord is required');
    }

    return this.walletRecoveryService.escrowRecoveryPackage({
      encryptedRecord: {
        ciphertext: body.encryptedRecord.ciphertext,
        commitment: body.encryptedRecord.commitment,
        iv: body.encryptedRecord.iv,
        salt: body.encryptedRecord.salt,
        version: 1
      },
      examId,
      operatorWrapCiphertext: body.operatorWrapCiphertext,
      studentId: requireStudentId(studentId)
    });
  }

  @Get(':examId/recovery-requests')
  async listRecoveryRequests(
    @Param('examId') examId: string,
    @Headers('x-student-id') studentId: string | undefined
  ) {
    return this.walletRecoveryService.listStudentRecoveryRequests({
      examId,
      studentId: requireStudentId(studentId)
    });
  }

  @Post(':examId/recovery-requests')
  async createRecoveryRequest(
    @Param('examId') examId: string,
    @Headers('x-student-id') studentId: string | undefined,
    @Body() body: RecoveryRequestBody
  ) {
    return this.walletRecoveryService.createRecoveryRequest({
      examId,
      reason: body.reason,
      studentId: requireStudentId(studentId)
    });
  }

  @Post(':examId/recovery-requests/:requestId/restore')
  async restoreRecoveryPackage(
    @Param('examId') examId: string,
    @Param('requestId') requestId: string,
    @Headers('x-student-id') studentId: string | undefined
  ) {
    return this.walletRecoveryService.restoreRecoveryPackage({
      examId,
      requestId,
      studentId: requireStudentId(studentId)
    });
  }
}
