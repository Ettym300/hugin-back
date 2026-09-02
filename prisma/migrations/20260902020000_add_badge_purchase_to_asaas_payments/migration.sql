-- AlterTable
ALTER TABLE "asaas_payments"
  ADD COLUMN     "productType" TEXT NOT NULL DEFAULT 'SUPPORTER',
  ADD COLUMN     "badgeBit" INTEGER,
  ALTER COLUMN   "days" DROP NOT NULL;
