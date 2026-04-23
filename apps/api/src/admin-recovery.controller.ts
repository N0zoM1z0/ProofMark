import {
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post
} from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service.js';
import { WalletRecoveryService } from './wallet-recovery.service.js';

@Controller('api/admin/exams')
export class AdminRecoveryController {
  constructor(
    @Inject(AdminAuthService)
    private readonly adminAuthService: AdminAuthService,
    @Inject(WalletRecoveryService)
    private readonly walletRecoveryService: WalletRecoveryService
  ) {}

  private authorizeAdmin(adminId: string | undefined, mfaCode: string | undefined) {
    return this.adminAuthService.authorize({
      adminId,
      mfaCode
    });
  }

  @Get(':examId/recovery-requests')
  async listRecoveryRequests(
    @Param('examId') examId: string,
    @Headers('x-admin-id') adminId: string | undefined,
    @Headers('x-admin-mfa-code') mfaCode: string | undefined
  ) {
    this.authorizeAdmin(adminId, mfaCode);
    return this.walletRecoveryService.listAdminRecoveryRequests({
      examId
    });
  }

  @Post(':examId/recovery-requests/:requestId/approve')
  async approveRecoveryRequest(
    @Param('examId') examId: string,
    @Param('requestId') requestId: string,
    @Headers('x-admin-id') adminId: string | undefined,
    @Headers('x-admin-mfa-code') mfaCode: string | undefined
  ) {
    return this.walletRecoveryService.reviewRecoveryRequest({
      adminId: this.authorizeAdmin(adminId, mfaCode),
      approve: true,
      examId,
      requestId
    });
  }

  @Post(':examId/recovery-requests/:requestId/reject')
  async rejectRecoveryRequest(
    @Param('examId') examId: string,
    @Param('requestId') requestId: string,
    @Headers('x-admin-id') adminId: string | undefined,
    @Headers('x-admin-mfa-code') mfaCode: string | undefined
  ) {
    return this.walletRecoveryService.reviewRecoveryRequest({
      adminId: this.authorizeAdmin(adminId, mfaCode),
      approve: false,
      examId,
      requestId
    });
  }
}
