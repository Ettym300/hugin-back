-- CreateTable
CREATE TABLE "asaas_customers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "asaasCustomerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asaas_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asaas_payments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "asaasPaymentId" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "valueCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "asaas_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asaas_webhook_events" (
    "id" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asaas_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "asaas_customers_userId_key" ON "asaas_customers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "asaas_customers_asaasCustomerId_key" ON "asaas_customers"("asaasCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "asaas_payments_asaasPaymentId_key" ON "asaas_payments"("asaasPaymentId");

-- CreateIndex
CREATE INDEX "asaas_payments_userId_idx" ON "asaas_payments"("userId");

-- AddForeignKey
ALTER TABLE "asaas_customers" ADD CONSTRAINT "asaas_customers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asaas_payments" ADD CONSTRAINT "asaas_payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
