-- CreateTable
-- OtpToken was in the schema but never in a migration; prod may already have it.
CREATE TABLE IF NOT EXISTS "OtpToken" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'email_verification',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCounter" (
    "projectId" TEXT NOT NULL,
    "nextCase" INTEGER NOT NULL DEFAULT 0,
    "nextPlan" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TestCounter_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "TestCase" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "preconditions" TEXT NOT NULL DEFAULT '',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "priorityId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "ownerId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "automationStatus" TEXT NOT NULL DEFAULT 'NOT_AUTOMATED',
    "automationRef" TEXT,
    "automatedVersion" INTEGER,
    "lastResult" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCaseTicket" (
    "testCaseId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,

    CONSTRAINT "TestCaseTicket_pkey" PRIMARY KEY ("testCaseId","ticketId")
);

-- CreateTable
CREATE TABLE "TestPlan" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sprintId" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "ownerId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestSuite" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestSuite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestPoint" (
    "id" TEXT NOT NULL,
    "suiteId" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "configuration" TEXT NOT NULL DEFAULT '',
    "testerId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "lastResult" TEXT,
    "lastRunAt" TIMESTAMP(3),

    CONSTRAINT "TestPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestResult" (
    "id" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "pointId" TEXT,
    "outcome" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "stepResults" JSONB,
    "notes" TEXT NOT NULL DEFAULT '',
    "buildVersion" TEXT,
    "executedById" TEXT,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bugTicketId" TEXT,

    CONSTRAINT "TestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CiToken" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CiToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OtpToken_email_purpose_idx" ON "OtpToken"("email", "purpose");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OtpToken_expiresAt_idx" ON "OtpToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TestCase_key_key" ON "TestCase"("key");

-- CreateIndex
CREATE INDEX "TestCase_projectId_deletedAt_idx" ON "TestCase"("projectId", "deletedAt");

-- CreateIndex
CREATE INDEX "TestCaseTicket_ticketId_idx" ON "TestCaseTicket"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "TestPlan_key_key" ON "TestPlan"("key");

-- CreateIndex
CREATE INDEX "TestPlan_projectId_deletedAt_idx" ON "TestPlan"("projectId", "deletedAt");

-- CreateIndex
CREATE INDEX "TestSuite_planId_idx" ON "TestSuite"("planId");

-- CreateIndex
CREATE INDEX "TestPoint_suiteId_idx" ON "TestPoint"("suiteId");

-- CreateIndex
CREATE INDEX "TestPoint_testerId_idx" ON "TestPoint"("testerId");

-- CreateIndex
CREATE INDEX "TestPoint_testCaseId_idx" ON "TestPoint"("testCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "TestPoint_suiteId_testCaseId_configuration_key" ON "TestPoint"("suiteId", "testCaseId", "configuration");

-- CreateIndex
CREATE INDEX "TestResult_testCaseId_executedAt_idx" ON "TestResult"("testCaseId", "executedAt");

-- CreateIndex
CREATE INDEX "TestResult_pointId_executedAt_idx" ON "TestResult"("pointId", "executedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CiToken_tokenHash_key" ON "CiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "CiToken_userId_idx" ON "CiToken"("userId");

-- AddForeignKey
ALTER TABLE "TestCounter" ADD CONSTRAINT "TestCounter_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_priorityId_fkey" FOREIGN KEY ("priorityId") REFERENCES "Priority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseTicket" ADD CONSTRAINT "TestCaseTicket_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseTicket" ADD CONSTRAINT "TestCaseTicket_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestPlan" ADD CONSTRAINT "TestPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestPlan" ADD CONSTRAINT "TestPlan_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestPlan" ADD CONSTRAINT "TestPlan_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSuite" ADD CONSTRAINT "TestSuite_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TestPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSuite" ADD CONSTRAINT "TestSuite_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TestSuite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestPoint" ADD CONSTRAINT "TestPoint_suiteId_fkey" FOREIGN KEY ("suiteId") REFERENCES "TestSuite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestPoint" ADD CONSTRAINT "TestPoint_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestPoint" ADD CONSTRAINT "TestPoint_testerId_fkey" FOREIGN KEY ("testerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "TestPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_executedById_fkey" FOREIGN KEY ("executedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_bugTicketId_fkey" FOREIGN KEY ("bugTicketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CiToken" ADD CONSTRAINT "CiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Grant the new permissions to existing roles. Admin already has "*".
UPDATE "Role"
SET "permissions" = "permissions" || '["testcase.manage", "testcase.execute"]'::jsonb
WHERE "name" IN ('Manager', 'Employee')
  AND NOT "permissions" @> '["testcase.manage"]'::jsonb;
