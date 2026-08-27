-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('PENDING', 'EXECUTED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN "status" "QuoteStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "Quote_status_expiresAt_idx" ON "Quote"("status", "expiresAt");
