import { Module } from '@nestjs/common';
import { AdminAuthoringController } from './admin-authoring.controller.js';
import { AdminAuthoringService } from './admin-authoring.service.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminExamController } from './admin-exam.controller.js';
import { AdminExamService } from './admin-exam.service.js';
import { AuditRootService } from './audit-root.service.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { BlobStorageService } from './blob-storage.service.js';
import { MarkerController } from './marker.controller.js';
import { MarkingService } from './marking.service.js';
import { PublicExamController } from './public-exam.controller.js';
import { PublicExamService } from './public-exam.service.js';
import { PublicUploadController } from './public-upload.controller.js';
import { PublicVerifyController } from './public-verify.controller.js';
import { PublicVerifyService } from './public-verify.service.js';
import { PrismaService } from './prisma.service.js';
import { SubmissionService } from './submission.service.js';
import { SubmissionUploadService } from './submission-upload.service.js';
import { StudentClaimController } from './student-claim.controller.js';
import { StudentClaimService } from './student-claim.service.js';
import { StudentRegistrationController } from './student-registration.controller.js';
import { StudentRegistrationService } from './student-registration.service.js';

@Module({
  controllers: [
    AppController,
    AdminAuthoringController,
    AdminExamController,
    StudentRegistrationController,
    StudentClaimController,
    PublicExamController,
    PublicUploadController,
    PublicVerifyController,
    MarkerController
  ],
  providers: [
    AdminAuthService,
    AdminAuthoringService,
    AdminExamService,
    AuditRootService,
    AppService,
    BlobStorageService,
    MarkingService,
    PrismaService,
    PublicVerifyService,
    StudentClaimService,
    StudentRegistrationService,
    PublicExamService,
    SubmissionService,
    SubmissionUploadService
  ]
})
export class AppModule {}
