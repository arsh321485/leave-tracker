/** Leave types removed from active use (kept in DB for old records). */
export const REMOVED_LEAVE_TYPE_CODES = [
  "COMP_OFF",
  "HALF_DAY",
  "EARNED",
  "UNPAID",
  "OPTIONAL",
] as const;

export const MENSTRUATION_LEAVE_CODE = "MENSTRUATION";

export function activeLeaveTypeWhere() {
  return {
    isActive: true,
    code: { notIn: [...REMOVED_LEAVE_TYPE_CODES] },
  };
}
