/** Remaining-year leave quotas (e.g. last ~4 months / Q4). */
export const REMAINING_YEAR_ALLOCATIONS: Record<string, number> = {
  ANNUAL: 4,
  CASUAL: 3,
  SICK: 3,
};

export const MENSTRUATION_LEAVE_CODE = "MENSTRUATION";
export const COMP_OFF_LEAVE_CODE = "COMP_OFF";

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
