import { PrismaClient, Role, HolidayType } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const year = new Date().getFullYear();

  const eng = await prisma.department.upsert({
    where: { name: "Engineering" },
    update: {},
    create: { name: "Engineering" },
  });
  const hr = await prisma.department.upsert({
    where: { name: "Human Resources" },
    update: {},
    create: { name: "Human Resources" },
  });

  const leaveTypes = [
    { code: "CASUAL", name: "Casual Leave", allocation: 12 },
    { code: "SICK", name: "Sick Leave", allocation: 12 },
    { code: "ANNUAL", name: "Annual Leave", allocation: 15 },
    {
      code: "MENSTRUATION",
      name: "Menstruation Leave",
      allocation: 0,
      monthlyQuota: 1,
      expiresMonthly: true,
      requiresEligibility: true,
      maxDays: 1,
    },
  ];

  for (const lt of leaveTypes) {
    const type = await prisma.leaveType.upsert({
      where: { code: lt.code },
      update: { name: lt.name, isActive: true },
      create: { code: lt.code, name: lt.name, isActive: true },
    });
    await prisma.leavePolicy.upsert({
      where: { leaveTypeId: type.id },
      update: {
        annualAllocation: lt.allocation,
        allowHalfDay: lt.code !== "MENSTRUATION",
        requiresManagerApproval: true,
        monthlyQuota: lt.monthlyQuota ?? null,
        expiresMonthly: lt.expiresMonthly ?? false,
        requiresEligibility: lt.requiresEligibility ?? false,
        maxConsecutiveDays: lt.maxDays ?? (lt.code === "CASUAL" ? 5 : 15),
      },
      create: {
        leaveTypeId: type.id,
        annualAllocation: lt.allocation,
        carryForwardEnabled: lt.code === "ANNUAL",
        carryForwardLimit: 5,
        maxConsecutiveDays: lt.maxDays ?? (lt.code === "CASUAL" ? 5 : 15),
        requiresManagerApproval: true,
        allowHalfDay: lt.code !== "MENSTRUATION",
        allowDuringProbation: lt.code === "SICK",
        monthlyQuota: lt.monthlyQuota ?? null,
        expiresMonthly: lt.expiresMonthly ?? false,
        requiresEligibility: lt.requiresEligibility ?? false,
      },
    });
  }

  await prisma.leaveType.updateMany({
    where: {
      code: { in: ["COMP_OFF", "HALF_DAY", "EARNED", "UNPAID", "OPTIONAL"] },
    },
    data: { isActive: false },
  });

  const manager = await prisma.employee.upsert({
    where: { email: "amit@secureitlab.com" },
    update: {},
    create: {
      name: "Amit Sharma",
      email: "amit@secureitlab.com",
      departmentId: eng.id,
      designation: "Engineering Manager",
      joiningDate: new Date(`${year - 5}-01-15`),
      status: "ACTIVE",
    },
  });

  const employee = await prisma.employee.upsert({
    where: { email: "rahul@secureitlab.com" },
    update: { managerId: manager.id },
    create: {
      name: "Rahul Sharma",
      email: "rahul@secureitlab.com",
      departmentId: eng.id,
      designation: "Software Engineer",
      managerId: manager.id,
      joiningDate: new Date(`${year - 2}-03-01`),
      status: "ACTIVE",
    },
  });

  const hrAdminEmp = await prisma.employee.upsert({
    where: { email: "hr@secureitlab.com" },
    update: {},
    create: {
      name: "HR Admin",
      email: "hr@secureitlab.com",
      departmentId: hr.id,
      designation: "HR Manager",
      joiningDate: new Date(`${year - 6}-01-01`),
      status: "ACTIVE",
    },
  });

  const passwordHash = await bcrypt.hash("Admin@123", 10);

  await prisma.user.upsert({
    where: { email: "admin@secureitlab.com" },
    update: {},
    create: {
      email: "admin@secureitlab.com",
      name: "Super Admin",
      passwordHash,
      role: Role.SUPER_ADMIN,
    },
  });

  await prisma.user.upsert({
    where: { email: "hr@secureitlab.com" },
    update: {},
    create: {
      email: "hr@secureitlab.com",
      name: "HR Admin",
      passwordHash,
      role: Role.HR_ADMIN,
      employeeId: hrAdminEmp.id,
    },
  });

  await prisma.user.upsert({
    where: { email: "amit@secureitlab.com" },
    update: {},
    create: {
      email: "amit@secureitlab.com",
      name: "Amit Sharma",
      passwordHash,
      role: Role.MANAGER,
      employeeId: manager.id,
    },
  });

  await prisma.user.upsert({
    where: { email: "rahul@secureitlab.com" },
    update: {},
    create: {
      email: "rahul@secureitlab.com",
      name: "Rahul Sharma",
      passwordHash,
      role: Role.EMPLOYEE,
      employeeId: employee.id,
    },
  });

  const types = await prisma.leaveType.findMany({
    where: { isActive: true, policy: { monthlyQuota: null } },
    include: { policy: true },
  });
  for (const emp of [manager, employee, hrAdminEmp]) {
    for (const t of types) {
      await prisma.leaveBalance.upsert({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: emp.id,
            leaveTypeId: t.id,
            year,
          },
        },
        update: {},
        create: {
          employeeId: emp.id,
          leaveTypeId: t.id,
          year,
          allocated: t.policy?.annualAllocation ?? 12,
          used: 0,
          pending: 0,
          carryForward: 0,
        },
      });
    }
  }

  const holidays = [
    { name: "Independence Day", date: `${year}-08-15`, type: HolidayType.PUBLIC },
    { name: "Janmashtami", date: `${year}-08-27`, type: HolidayType.FESTIVAL },
    { name: "Gandhi Jayanti", date: `${year}-10-02`, type: HolidayType.PUBLIC },
    { name: "Dussehra", date: `${year}-10-20`, type: HolidayType.FESTIVAL },
    {
      name: "Diwali",
      date: `${year}-11-01`,
      type: HolidayType.OPTIONAL,
      isOptional: true,
      maxRequests: 20,
    },
    { name: "Christmas", date: `${year}-12-25`, type: HolidayType.PUBLIC },
  ];

  for (const h of holidays) {
    const existing = await prisma.holiday.findFirst({
      where: { name: h.name, date: new Date(h.date) },
    });
    if (!existing) {
      await prisma.holiday.create({
        data: {
          name: h.name,
          date: new Date(h.date),
          type: h.type,
          isOptional: h.isOptional ?? false,
          maxRequests: h.maxRequests,
          status: "ACTIVE",
        },
      });
    }
  }

  console.log("Seed complete.");
  console.log("Login: admin@secureitlab.com / Admin@123");
  console.log("Also: hr@, amit@, rahul@secureitlab.com / Admin@123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
