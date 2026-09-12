/** Remaining-year leave quotas (e.g. last ~4 months / Q4). */
export const REMAINING_YEAR_ALLOCATIONS: Record<string, number> = {
  ANNUAL: 4,
  CASUAL: 3,
  SICK: 3,
};

export const MENSTRUATION_LEAVE_CODE = "MENSTRUATION";
export const COMP_OFF_LEAVE_CODE = "COMP_OFF";

/** Casual + Annual + Comp Off share one pool so longer leave can use combined days. */
export const POOLED_LEAVE_CODES = ["COMP_OFF", "CASUAL", "ANNUAL"] as const;
export type PooledLeaveCode = (typeof POOLED_LEAVE_CODES)[number];

/** Slack / API sentinel for applying from the paid leave pool. */
export const PAID_POOL_SELECT_VALUE = "__PAID_POOL__";

export function isPooledLeaveCode(code: string) {
  return (POOLED_LEAVE_CODES as readonly string[]).includes(code);
}

/** Leave types removed from active use (kept in DB for old records). */
export const REMOVED_LEAVE_TYPE_CODES = [
  "HALF_DAY",
  "EARNED",
  "UNPAID",
  "OPTIONAL",
] as const;

export function activeLeaveTypeWhere() {
  return {
    isActive: true,
    code: { notIn: [...REMOVED_LEAVE_TYPE_CODES] },
  };
}
