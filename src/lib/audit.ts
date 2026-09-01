import { AuditAction, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type AuditInput = {
  actorId?: string | null;
  actorLabel?: string | null;
  action: AuditAction;
  objectType: string;
  objectId?: string | null;
  oldValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
};

/** Avoid FK errors when session user id is stale (e.g. after DB re-seed). */
async function resolveActorId(
  actorId: string | null | undefined,
  client: Prisma.TransactionClient | typeof prisma
): Promise<string | null> {
  if (!actorId) return null;
  const user = await client.user.findUnique({
    where: { id: actorId },
    select: { id: true },
  });
  return user?.id ?? null;
}

export async function writeAuditLog(input: AuditInput, tx?: Prisma.TransactionClient) {
  const client = tx ?? prisma;
  const actorId = await resolveActorId(input.actorId, client);

  return client.leaveAuditLog.create({
    data: {
      actorId,
      actorLabel: input.actorLabel ?? null,
      action: input.action,
      objectType: input.objectType,
      objectId: input.objectId ?? null,
      oldValue: input.oldValue ?? undefined,
      newValue: input.newValue ?? undefined,
      metadata: input.metadata ?? undefined,
    },
  });
}
