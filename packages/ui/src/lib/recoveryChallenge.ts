/**
 * The rules behind "prove you wrote the recovery code down".
 *
 * Both shells asked for two groups and printed those very groups directly above the input
 * fields (finding 2026-08-25, B6). That checks transcription, not possession — the one thing
 * the step exists to establish. The requested groups are therefore hidden while the check is
 * open, and revealing them draws a fresh pair, so looking is never a shortcut past the check.
 */

/** Two distinct group indexes, or `[0, 0]` when a code is too short to ask twice. */
export function pickRecoveryChallenge(groupCount: number): [number, number] {
  if (groupCount < 2) return [0, 0];
  const random = crypto.getRandomValues(new Uint32Array(2));
  const first = random[0] % groupCount;
  let second = random[1] % groupCount;
  if (second === first) second = (second + 1) % groupCount;
  return [first, second];
}

/** Same width as the value it stands in for, so revealing does not reflow the code. */
export function maskRecoveryGroup(group: string): string {
  return "•".repeat(group.length);
}

/**
 * Hidden means: this group is being asked for, the user has not answered it correctly yet,
 * and they have not deliberately revealed the code. A group answered correctly comes back
 * into view — the user has just proven they have it, and hiding it further only nags.
 */
export function isRecoveryGroupHidden(input: {
  groupIndex: number;
  challenge: readonly [number, number];
  revealed: boolean;
  answeredCorrectly: boolean;
}): boolean {
  if (input.revealed || input.answeredCorrectly) return false;
  return input.challenge.includes(input.groupIndex);
}
