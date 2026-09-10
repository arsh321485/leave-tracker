import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const t = await prisma.leaveType.upsert({
    where: { code: "COMP_OFF" },
    update: { isActive: true, name: "Comp Off" },
    create: { code: "COMP_OFF", name: "Comp Off", isActive: true },
  });
  await prisma.leavePolicy.upsert({
    where: { leaveTypeId: t.id },
    update: {
      annualAllocation: 0,
      requiresManagerApproval: true,
      allowHalfDay: true,
      monthlyQuota: null,
      expiresMonthly: false,
      requiresEligibility: false,
    },
    create: {
      leaveTypeId: t.id,
      annualAllocation: 0,
      requiresManagerApproval: true,
      allowHalfDay: true,
    },
  });
  console.log("COMP_OFF ready:", t.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
