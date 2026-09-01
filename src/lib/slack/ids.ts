/** Extract a Slack user ID (U…) or channel ID (C/G/D…) from pasted text. */
export function normalizeSlackId(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  const match = trimmed.match(/[UWCGD][A-Z0-9]{8,}/i);
  return match ? match[0].toUpperCase() : trimmed;
}

export function isSlackUserId(id: string) {
  return /^U|^W/i.test(id);
}

export function isSlackChannelId(id: string) {
  return /^[CGD]/i.test(id);
}

/** Public channel (everyone sees posts). D = private DM with bot. */
export function isPublicSlackChannel(id: string) {
  return /^[CG]/i.test(id);
}
