-- CreateEnum
CREATE TYPE "SubmissionPartStatus" AS ENUM ('READY', 'ADJUDICATION_REQUIRED', 'GRADED');

-- CreateEnum
CREATE TYPE "MarkerStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "GradingTaskStatus" AS ENUM ('ASSIGNED', 'SUBMITTED', 'RETURNED');

-- CreateTable
CREATE TABLE "SubmissionPart" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "partIndex" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "responseText" TEXT NOT NULL,
    "rubricHash" TEXT NOT NULL,
    "maxScore" DECIMAL(10,2) NOT NULL,
    "partCommitment" TEXT NOT NULL,
    "status" "SubmissionPartStatus" NOT NULL DEFAULT 'READY',
    "score" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubmissionPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Marker" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "markerRef" TEXT,
    "pseudonymLabel" TEXT NOT NULL,
    "pseudonymPublicKey" TEXT NOT NULL,
    "pseudonymPrivateKey" TEXT NOT NULL,
    "status" "MarkerStatus" NOT NULL DEFAULT 'ACTIVE',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Marker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradingTask" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "submissionPartId" TEXT NOT NULL,
    "markerId" TEXT NOT NULL,
    "assignmentOrdinal" INTEGER NOT NULL,
    "assignmentCommitment" TEXT NOT NULL,
    "status" "GradingTaskStatus" NOT NULL DEFAULT 'ASSIGNED',
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auditEventId" TEXT,

    CONSTRAINT "GradingTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mark" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "gradingTaskId" TEXT NOT NULL,
    "submissionPartId" TEXT NOT NULL,
    "markerId" TEXT NOT NULL,
    "score" DECIMAL(10,2) NOT NULL,
    "maxScore" DECIMAL(10,2) NOT NULL,
    "rubricHash" TEXT NOT NULL,
    "commentsHash" TEXT NOT NULL,
    "markerSignature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auditEventId" TEXT,

    CONSTRAINT "Mark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubmissionPart_examId_createdAt_idx" ON "SubmissionPart"("examId", "createdAt");

-- CreateIndex
CREATE INDEX "SubmissionPart_submissionId_createdAt_idx" ON "SubmissionPart"("submissionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionPart_submissionId_questionId_key" ON "SubmissionPart"("submissionId", "questionId");

-- CreateIndex
CREATE INDEX "Marker_examId_addedAt_idx" ON "Marker"("examId", "addedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Marker_examId_pseudonymLabel_key" ON "Marker"("examId", "pseudonymLabel");

-- CreateIndex
CREATE INDEX "GradingTask_examId_createdAt_idx" ON "GradingTask"("examId", "createdAt");

-- CreateIndex
CREATE INDEX "GradingTask_markerId_createdAt_idx" ON "GradingTask"("markerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GradingTask_submissionPartId_markerId_key" ON "GradingTask"("submissionPartId", "markerId");

-- CreateIndex
CREATE INDEX "Mark_examId_createdAt_idx" ON "Mark"("examId", "createdAt");

-- CreateIndex
CREATE INDEX "Mark_submissionPartId_createdAt_idx" ON "Mark"("submissionPartId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Mark_gradingTaskId_key" ON "Mark"("gradingTaskId");

-- AddForeignKey
ALTER TABLE "SubmissionPart" ADD CONSTRAINT "SubmissionPart_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionPart" ADD CONSTRAINT "SubmissionPart_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Marker" ADD CONSTRAINT "Marker_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingTask" ADD CONSTRAINT "GradingTask_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingTask" ADD CONSTRAINT "GradingTask_submissionPartId_fkey" FOREIGN KEY ("submissionPartId") REFERENCES "SubmissionPart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingTask" ADD CONSTRAINT "GradingTask_markerId_fkey" FOREIGN KEY ("markerId") REFERENCES "Marker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mark" ADD CONSTRAINT "Mark_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mark" ADD CONSTRAINT "Mark_gradingTaskId_fkey" FOREIGN KEY ("gradingTaskId") REFERENCES "GradingTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mark" ADD CONSTRAINT "Mark_submissionPartId_fkey" FOREIGN KEY ("submissionPartId") REFERENCES "SubmissionPart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mark" ADD CONSTRAINT "Mark_markerId_fkey" FOREIGN KEY ("markerId") REFERENCES "Marker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
