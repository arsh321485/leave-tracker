import { Role } from "@prisma/client";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  employeeId?: string | null;
};

const ADMIN_ROLES: Role[] = [Role.SUPER_ADMIN, Role.HR_ADMIN];

export function isAdmin(role: Role) {
  return ADMIN_ROLES.includes(role);
}

export function isSuperAdmin(role: Role) {
  return role === Role.SUPER_ADMIN;
}

export function canManageEmployees(role: Role) {
  return isAdmin(role);
}

export function canManagePolicies(role: Role) {
  return isAdmin(role);
}

export function canViewAllLeaves(role: Role) {
  return isAdmin(role);
}

export function canApproveAsAdmin(role: Role) {
  return isAdmin(role);
}

export function canViewReports(role: Role) {
  return isAdmin(role) || role === Role.MANAGER;
}

export function canViewAuditLogs(role: Role) {
  return isAdmin(role);
}

export function assertRole(user: SessionUser | null | undefined, allowed: Role[]) {
  if (!user || !allowed.includes(user.role)) {
    const err = new Error("Forbidden");
    (err as Error & { status: number }).status = 403;
    throw err;
  }
}
