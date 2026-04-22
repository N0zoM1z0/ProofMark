-- AlterTable
ALTER TABLE "Exam" ADD COLUMN     "answerKeyData" JSONB,
ADD COLUMN     "answerKeySalt" TEXT,
ADD COLUMN     "gradingPolicyData" JSONB,
ADD COLUMN     "questionSetData" JSONB;

-- AlterTable
ALTER TABLE "ExamVersion" ADD COLUMN     "answerKeyData" JSONB,
ADD COLUMN     "answerKeySalt" TEXT,
ADD COLUMN     "gradingPolicyData" JSONB,
ADD COLUMN     "questionSetData" JSONB;
