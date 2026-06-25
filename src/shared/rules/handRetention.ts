export type HandDiscardPhase = "NON_STATUS" | "STATUS" | null;

export type HandDiscardRequirements = {
  nonStatusRetainCount: number;
  nonStatusDiscardCount: number;
  statusDiscardCount: number;
  discardCount: number;
  phase: HandDiscardPhase;
};

export function calculateStatusRetainCount(retainCount: number, constitutionModifier: number): number {
  return Math.max(0, retainCount) + Math.max(0, constitutionModifier);
}

export function calculateHandDiscardRequirements(input: {
  retainCount: number;
  statusRetainCount: number;
  statusCardCount: number;
  nonStatusCardCount: number;
}): HandDiscardRequirements {
  const retainCount = Math.max(0, input.retainCount);
  const statusRetainCount = Math.max(retainCount, input.statusRetainCount);
  const statusCardCount = Math.max(0, input.statusCardCount);
  const nonStatusCardCount = Math.max(0, input.nonStatusCardCount);
  const nonStatusRetainCount = Math.max(0, retainCount - statusCardCount);
  const nonStatusDiscardCount = Math.max(0, nonStatusCardCount - nonStatusRetainCount);
  const statusDiscardCount = Math.max(0, statusCardCount - statusRetainCount);
  const discardCount = nonStatusDiscardCount + statusDiscardCount;
  const phase: HandDiscardPhase = nonStatusDiscardCount > 0
    ? "NON_STATUS"
    : statusDiscardCount > 0
      ? "STATUS"
      : null;

  return {
    nonStatusRetainCount,
    nonStatusDiscardCount,
    statusDiscardCount,
    discardCount,
    phase
  };
}
