import { WebClient } from "@slack/web-api";
import { getSlackClient } from "@/lib/slack/client";
import { prisma } from "@/lib/prisma";

export type SlackUserRow = {
  slackUserId: string;
  slackName: string;
  email: string | null;
  employeeId: string | null;
  employeeName: string | null;
  mappingStatus: "Mapped" | "Unmapped" | "EmailMatch";
};

export async function syncSlackUsers(): Promise<SlackUserRow[]> {
  const client: WebClient = getSlackClient();
  const users: SlackUserRow[] = [];
  let cursor: string | undefined;

  do {
    const res = await client.users.list({ limit: 200, cursor });
    for (const u of res.members || []) {
      if (u.deleted || u.is_bot || u.id === "USLACKBOT") continue;
      const email = u.profile?.email?.toLowerCase() || null;
      const slackName = u.profile?.display_name || u.real_name || u.name || u.id!;
      let employee = await prisma.employee.findFirst({
        where: {
          OR: [
            { slackUserId: u.id },
            ...(email ? [{ email }] : []),
          ],
        },
      });

      if (employee && !employee.slackUserId && email && employee.email === email) {
        employee = await prisma.employee.update({
          where: { id: employee.id },
          data: { slackUserId: u.id, slackName },
        });
      } else if (employee && employee.slackUserId === u.id) {
        await prisma.employee.update({
          where: { id: employee.id },
          data: { slackName },
        });
      }

      users.push({
        slackUserId: u.id!,
        slackName,
        email,
        employeeId: employee?.id ?? null,
        employeeName: employee?.name ?? null,
        mappingStatus: employee?.slackUserId === u.id ? "Mapped" : email && employee ? "EmailMatch" : "Unmapped",
      });
    }
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return users;
}

export async function mapSlackUser(employeeId: string, slackUserId: string, slackName?: string) {
  const existing = await prisma.employee.findFirst({
    where: { slackUserId, NOT: { id: employeeId } },
  });
  if (existing) {
    throw new Error(`Slack user already mapped to ${existing.name}`);
  }
  return prisma.employee.update({
    where: { id: employeeId },
    data: { slackUserId, slackName: slackName || undefined },
  });
}
