-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('DRAFT', 'COMMITTED', 'REGISTRATION', 'PUBLISHED', 'OPEN', 'CLOSED', 'ASSIGNING', 'MARKING', 'GRADING', 'FINALIZED', 'CLAIMING', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EligibleCommitmentStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('ACCEPTED', 'REJECTED', 'DUPLICATE', 'VOIDED');

-- CreateEnum
CREATE TYPE "ProofVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'INVALID');

-- CreateEnum
CREATE TYPE "GradeStatus" AS ENUM ('DRAFT', 'VERIFIED', 'FINALIZED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('CLAIMED', 'REVOKED');

-- CreateTable
CREATE TABLE "Exam" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "courseId" TEXT,
    "status" "ExamStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "questionSetHash" TEXT,
    "answerKeyCommitment" TEXT,
    "gradingPolicyHash" TEXT,
    "currentGroupRoot" TEXT,
    "createdByRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamVersion" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "questionSetHash" TEXT NOT NULL,
    "policyHash" TEXT NOT NULL,
    "manifestHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auditEventId" TEXT,

    CONSTRAINT "ExamVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibleCommitment" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "identityCommitment" TEXT NOT NULL,
    "status" "EligibleCommitmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "addedByRef" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auditEventId" TEXT,

    CONSTRAINT "EligibleCommitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrarIdentityLink" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "identityCommitment" TEXT NOT NULL,
    "realUserRefCiphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrarIdentityLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "submissionIndex" INTEGER NOT NULL,
    "groupRoot" TEXT NOT NULL,
    "nullifierHash" TEXT NOT NULL,
    "messageHash" TEXT NOT NULL,
    "answerCommitment" TEXT NOT NULL,
    "encryptedBlobHash" TEXT NOT NULL,
    "encryptedBlobUri" TEXT NOT NULL,
    "submittedAtBucket" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'ACCEPTED',
    "receiptHash" TEXT,
    "auditEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofArtifact" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "submissionId" TEXT,
    "type" TEXT NOT NULL,
    "circuitName" TEXT,
    "circuitVersion" TEXT,
    "vkHash" TEXT,
    "publicInputsHash" TEXT NOT NULL,
    "proofHash" TEXT NOT NULL,
    "proofUri" TEXT,
    "verificationStatus" "ProofVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProofArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "actorPseudonym" TEXT,
    "payloadHash" TEXT NOT NULL,
    "prevEventHash" TEXT,
    "eventHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditRoot" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "fromSeq" INTEGER NOT NULL,
    "toSeq" INTEGER NOT NULL,
    "merkleRoot" TEXT NOT NULL,
    "prevPhaseRoot" TEXT,
    "anchoredTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditRoot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grade" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "objectiveScore" DECIMAL(10,2),
    "subjectiveScore" DECIMAL(10,2),
    "finalScore" DECIMAL(10,2),
    "maxScore" DECIMAL(10,2),
    "gradeCommitment" TEXT,
    "proofArtifactsRoot" TEXT,
    "status" "GradeStatus" NOT NULL DEFAULT 'DRAFT',
    "finalizedAt" TIMESTAMP(3),
    "auditEventId" TEXT,
    "supersedesGradeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Grade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeClaim" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "gradeId" TEXT,
    "userReferenceCiphertext" TEXT NOT NULL,
    "claimProofHash" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ClaimStatus" NOT NULL DEFAULT 'CLAIMED',
    "auditEventId" TEXT,

    CONSTRAINT "GradeClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExamVersion_examId_createdAt_idx" ON "ExamVersion"("examId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExamVersion_examId_version_key" ON "ExamVersion"("examId", "version");

-- CreateIndex
CREATE INDEX "EligibleCommitment_examId_addedAt_idx" ON "EligibleCommitment"("examId", "addedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EligibleCommitment_examId_identityCommitment_key" ON "EligibleCommitment"("examId", "identityCommitment");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrarIdentityLink_examId_identityCommitment_key" ON "RegistrarIdentityLink"("examId", "identityCommitment");

-- CreateIndex
CREATE INDEX "Submission_examId_createdAt_idx" ON "Submission"("examId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_examId_nullifierHash_key" ON "Submission"("examId", "nullifierHash");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_examId_submissionIndex_key" ON "Submission"("examId", "submissionIndex");

-- CreateIndex
CREATE INDEX "ProofArtifact_examId_createdAt_idx" ON "ProofArtifact"("examId", "createdAt");

-- CreateIndex
CREATE INDEX "ProofArtifact_submissionId_idx" ON "ProofArtifact"("submissionId");

-- CreateIndex
CREATE INDEX "AuditEvent_examId_createdAt_idx" ON "AuditEvent"("examId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_examId_seq_key" ON "AuditEvent"("examId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_examId_eventHash_key" ON "AuditEvent"("examId", "eventHash");

-- CreateIndex
CREATE INDEX "AuditRoot_examId_createdAt_idx" ON "AuditRoot"("examId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditRoot_examId_phase_toSeq_key" ON "AuditRoot"("examId", "phase", "toSeq");

-- CreateIndex
CREATE INDEX "Grade_examId_submissionId_status_idx" ON "Grade"("examId", "submissionId", "status");

-- CreateIndex
CREATE INDEX "Grade_supersedesGradeId_idx" ON "Grade"("supersedesGradeId");

-- CreateIndex
CREATE INDEX "GradeClaim_examId_claimedAt_idx" ON "GradeClaim"("examId", "claimedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GradeClaim_examId_submissionId_key" ON "GradeClaim"("examId", "submissionId");

-- AddForeignKey
ALTER TABLE "ExamVersion" ADD CONSTRAINT "ExamVersion_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibleCommitment" ADD CONSTRAINT "EligibleCommitment_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrarIdentityLink" ADD CONSTRAINT "RegistrarIdentityLink_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofArtifact" ADD CONSTRAINT "ProofArtifact_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofArtifact" ADD CONSTRAINT "ProofArtifact_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRoot" ADD CONSTRAINT "AuditRoot_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grade" ADD CONSTRAINT "Grade_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grade" ADD CONSTRAINT "Grade_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grade" ADD CONSTRAINT "Grade_supersedesGradeId_fkey" FOREIGN KEY ("supersedesGradeId") REFERENCES "Grade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeClaim" ADD CONSTRAINT "GradeClaim_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeClaim" ADD CONSTRAINT "GradeClaim_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeClaim" ADD CONSTRAINT "GradeClaim_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE SET NULL ON UPDATE CASCADE;
