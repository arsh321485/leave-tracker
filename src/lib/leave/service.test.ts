import { describe, expect, it } from "vitest";
import { LeaveValidationError } from "@/lib/leave/service";

describe("LeaveValidationError", () => {
  it("exposes clear message", () => {
    const err = new LeaveValidationError(
      "You have only 2 Casual Leave days available, but you requested 4 days."
    );
    expect(err.message).toContain("2 Casual Leave");
    expect(err.name).toBe("LeaveValidationError");
  });
});

describe("optional holiday limit message", () => {
  it("matches acceptance copy", () => {
    const err = new LeaveValidationError("No slots remaining for this optional holiday.");
    expect(err.message).toBe("No slots remaining for this optional holiday.");
  });
});

describe("manager authorization message", () => {
  it("rejects unauthorized approvers", () => {
    const err = new LeaveValidationError(
      "You are not authorized to approve this request."
    );
    expect(err.message).toContain("not authorized");
  });
});
