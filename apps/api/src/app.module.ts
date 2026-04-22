import { Module } from '@nestjs/common';
import { AdminExamController } from './admin-exam.controller.js';
import { AdminExamService } from './admin-exam.service.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { BlobStorageService } from './blob-storage.service.js';
import { PublicExamController } from './public-exam.controller.js';
import { PublicExamService } from './public-exam.service.js';
import { PublicUploadController } from './public-upload.controller.js';
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
    AdminExamController,
    StudentRegistrationController,
    StudentClaimController,
    PublicExamController,
    PublicUploadController
  ],
  providers: [
    AdminExamService,
    AppService,
    BlobStorageService,
    PrismaService,
    StudentClaimService,
    StudentRegistrationService,
    PublicExamService,
    SubmissionService,
    SubmissionUploadService
  ]
})
export class AppModule {}
