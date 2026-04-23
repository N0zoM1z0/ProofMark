-- CreateEnum
CREATE TYPE "WalletRecoveryPackageStatus" AS ENUM ('ACTIVE', 'RESTORED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WalletRecoveryRequestStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "WalletRecoveryPackage" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "identityCommitment" TEXT NOT NULL,
    "userReferenceCiphertext" TEXT NOT NULL,
    "encryptedIdentityCiphertext" TEXT NOT NULL,
    "encryptedIdentityIv" TEXT NOT NULL,
    "encryptedIdentitySalt" TEXT NOT NULL,
    "operatorWrapCiphertext" TEXT,
    "packageHash" TEXT NOT NULL,
    "status" "WalletRecoveryPackageStatus" NOT NULL DEFAULT 'ACTIVE',
    "escrowedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restoredAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "auditEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletRecoveryPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletRecoveryRequest" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "walletRecoveryPackageId" TEXT NOT NULL,
    "requestedByCiphertext" TEXT NOT NULL,
    "operatorReferenceCiphertext" TEXT,
    "status" "WalletRecoveryRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "auditEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletRecoveryRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletRecoveryPackage_examId_identityCommitment_key" ON "WalletRecoveryPackage"("examId", "identityCommitment");

-- CreateIndex
CREATE INDEX "WalletRecoveryPackage_examId_escrowedAt_idx" ON "WalletRecoveryPackage"("examId", "escrowedAt");

-- CreateIndex
CREATE INDEX "WalletRecoveryPackage_status_expiresAt_idx" ON "WalletRecoveryPackage"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "WalletRecoveryRequest_examId_requestedAt_idx" ON "WalletRecoveryRequest"("examId", "requestedAt");

-- CreateIndex
CREATE INDEX "WalletRecoveryRequest_walletRecoveryPackageId_status_idx" ON "WalletRecoveryRequest"("walletRecoveryPackageId", "status");

-- AddForeignKey
ALTER TABLE "WalletRecoveryPackage" ADD CONSTRAINT "WalletRecoveryPackage_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletRecoveryRequest" ADD CONSTRAINT "WalletRecoveryRequest_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletRecoveryRequest" ADD CONSTRAINT "WalletRecoveryRequest_walletRecoveryPackageId_fkey" FOREIGN KEY ("walletRecoveryPackageId") REFERENCES "WalletRecoveryPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
