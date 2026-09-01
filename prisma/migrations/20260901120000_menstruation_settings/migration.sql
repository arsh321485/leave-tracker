-- AlterTable
ALTER TABLE "LeavePolicy" ADD COLUMN "monthlyQuota" DOUBLE PRECISION;
ALTER TABLE "LeavePolicy" ADD COLUMN "expiresMonthly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LeavePolicy" ADD COLUMN "requiresEligibility" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "EmployeeLeaveEligibility" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeLeaveEligibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeLeaveEligibility_employeeId_leaveTypeId_key" ON "EmployeeLeaveEligibility"("employeeId", "leaveTypeId");

-- CreateIndex
CREATE INDEX "EmployeeLeaveEligibility_leaveTypeId_idx" ON "EmployeeLeaveEligibility"("leaveTypeId");

-- AddForeignKey
ALTER TABLE "EmployeeLeaveEligibility" ADD CONSTRAINT "EmployeeLeaveEligibility_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeLeaveEligibility" ADD CONSTRAINT "EmployeeLeaveEligibility_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
