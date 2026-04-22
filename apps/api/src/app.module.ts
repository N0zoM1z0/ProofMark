import { Module } from '@nestjs/common';
import { AdminExamController } from './admin-exam.controller.js';
import { AdminExamService } from './admin-exam.service.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PublicExamController } from './public-exam.controller.js';
import { PublicExamService } from './public-exam.service.js';
import { PrismaService } from './prisma.service.js';
import { SubmissionService } from './submission.service.js';
import { StudentRegistrationController } from './student-registration.controller.js';
import { StudentRegistrationService } from './student-registration.service.js';

@Module({
  controllers: [
    AppController,
    AdminExamController,
    StudentRegistrationController,
    PublicExamController
  ],
  providers: [
    AdminExamService,
    AppService,
    PrismaService,
    StudentRegistrationService,
    PublicExamService,
    SubmissionService
  ]
})
export class AppModule {}
