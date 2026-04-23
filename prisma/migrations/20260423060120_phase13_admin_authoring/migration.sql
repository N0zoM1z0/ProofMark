-- CreateEnum
CREATE TYPE "QuestionBankEntryType" AS ENUM ('MCQ', 'SUBJECTIVE');

-- CreateTable
CREATE TABLE "ExamTemplate" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "courseId" TEXT,
    "questionSetData" JSONB NOT NULL,
    "questionSetHash" TEXT NOT NULL,
    "answerKeyData" JSONB NOT NULL,
    "gradingPolicyData" JSONB NOT NULL,
    "gradingPolicyHash" TEXT NOT NULL,
    "createdByRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionBankEntry" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "questionType" "QuestionBankEntryType" NOT NULL,
    "questionData" JSONB NOT NULL,
    "answerData" JSONB,
    "tags" JSONB,
    "questionHash" TEXT NOT NULL,
    "createdByRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionBankEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuestionBankEntry_questionType_createdAt_idx" ON "QuestionBankEntry"("questionType", "createdAt");
