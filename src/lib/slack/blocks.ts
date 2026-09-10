import type { KnownBlock } from "@slack/web-api";

export function welcomeBlocks(): KnownBlock[] {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "🏖️ SECUREITLAB LEAVE TRACKER" },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Manage your company leave directly from Slack.\n\nManagers can approve or reject leave requests directly from Slack.",
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "🏖️ Apply Leave" },
          action_id: "apply_leave",
          style: "primary",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "⏱️ Request Comp Off" },
          action_id: "request_comp_off",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "📊 My Balance" },
          action_id: "my_balance",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "📋 My Leave History" },
          action_id: "my_history",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "🎉 Upcoming Holidays" },
          action_id: "upcoming_holidays",
        },
      ],
    },
  ];
}

export function leaveHomeBlocks(): KnownBlock[] {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "🏖️ Leave Tracker" },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Apply Leave" },
          action_id: "apply_leave",
          style: "primary",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Request Comp Off" },
          action_id: "request_comp_off",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "My Balance" },
          action_id: "my_balance",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "My Leave History" },
          action_id: "my_history",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Upcoming Holidays" },
          action_id: "upcoming_holidays",
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Comp Off: request credit for extra work (e.g. Saturday) → manager approves → then apply Comp Off leave.",
        },
      ],
    },
  ];
}

export function managerApprovalBlocks(input: {
  requestId: string;
  employeeName: string;
  leaveType: string;
  dateRange: string;
  days: number;
  reason: string;
  balanceRemaining: number;
}): KnownBlock[] {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "🔔 LEAVE APPROVAL REQUIRED" },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Employee:*\n${input.employeeName}` },
        { type: "mrkdwn", text: `*Leave Type:*\n${input.leaveType}` },
        { type: "mrkdwn", text: `*Date:*\n${input.dateRange}` },
        { type: "mrkdwn", text: `*Days:*\n${input.days}` },
        { type: "mrkdwn", text: `*Reason:*\n${input.reason}` },
        { type: "mrkdwn", text: `*Current Balance:*\n${input.balanceRemaining} days` },
      ],
    },
    {
      type: "actions",
      block_id: `leave_approval_${input.requestId}`,
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "✅ Approve" },
          style: "primary",
          action_id: "approve_leave",
          value: input.requestId,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "❌ Reject" },
          style: "danger",
          action_id: "reject_leave",
          value: input.requestId,
        },
      ],
    },
  ];
}

export function managerCompOffApprovalBlocks(input: {
  creditId: string;
  employeeName: string;
  workDate: string;
  days: number;
  reason: string;
}): KnownBlock[] {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "⏱️ COMP OFF CREDIT" },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Employee worked extra and is requesting Comp Off credit. Approving adds days to their Comp Off balance.",
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Employee:*\n${input.employeeName}` },
        { type: "mrkdwn", text: `*Work date:*\n${input.workDate}` },
        { type: "mrkdwn", text: `*Credit:*\n${input.days} day(s)` },
        { type: "mrkdwn", text: `*Reason:*\n${input.reason}` },
      ],
    },
    {
      type: "actions",
      block_id: `comp_off_approval_${input.creditId}`,
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "✅ Approve credit" },
          style: "primary",
          action_id: "approve_comp_off",
          value: input.creditId,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "❌ Reject" },
          style: "danger",
          action_id: "reject_comp_off",
          value: input.creditId,
        },
      ],
    },
  ];
}
