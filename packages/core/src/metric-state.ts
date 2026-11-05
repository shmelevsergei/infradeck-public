export type RuleState = {
  since?: number;
  recoverySince?: number;
  firing: boolean;
  lastAt?: number;
  firedAt?: number;
  lastNotifiedAt?: number;
  reminders?: number;
};
export function advanceRule(
  state: RuleState,
  sample: { value: number; at: number } | null,
  rule: {
    threshold: number;
    recoveryBelow: number;
    forSeconds: number;
    recoverySeconds: number;
  },
  now: number,
): { state: RuleState; transition?: "FIRING" | "RESOLVED" } {
  if (
    !sample ||
    !Number.isFinite(sample.value) ||
    now - sample.at > 180000 ||
    sample.at > now + 30000
  )
    return { state: { ...state, since: undefined, recoverySince: undefined } };
  if (state.lastAt !== undefined && sample.at <= state.lastAt) return { state };
  const continuous =
    state.lastAt !== undefined && sample.at - state.lastAt <= 180000;
  const next: RuleState = {
    firing: state.firing,
    lastAt: sample.at,
    ...(state.firing
      ? {
          firedAt: state.firedAt,
          lastNotifiedAt: state.lastNotifiedAt,
          reminders: state.reminders,
        }
      : {}),
  };
  if (!state.firing && sample.value > rule.threshold) {
    next.since = continuous ? (state.since ?? sample.at) : sample.at;
    if (sample.at - next.since >= rule.forSeconds * 1000) {
      next.firing = true;
      return { state: next, transition: "FIRING" };
    }
  } else if (state.firing && sample.value < rule.recoveryBelow) {
    next.recoverySince = continuous
      ? (state.recoverySince ?? sample.at)
      : sample.at;
    if (sample.at - next.recoverySince >= rule.recoverySeconds * 1000) {
      next.firing = false;
      return { state: next, transition: "RESOLVED" };
    }
  }
  return { state: next };
}
