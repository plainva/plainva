/**
 * What a composer that was opened for somebody tells them once the user took
 * the step (AI harness P5-6): the transport took the mail, or it was stored
 * as a draft at its account.
 *
 * The composer is a screen behind a route, and a route's argument is text —
 * so the one who opens it leaves a function here and puts its token into the
 * draft. A composer that is left without sending or saving calls nothing, and
 * neither does a send that is undone in its few seconds or that the server
 * refuses: a mail the assistant drafted then stays in the list of drafts,
 * where it was.
 */
export type ComposeEnd = "sent" | "saved";

/** The functions that wait, oldest first. A composer nobody finished leaves its entry behind; the oldest go past the bound. */
const waiting = new Map<string, (how: ComposeEnd) => void>();
const BOUND = 20;
let minted = 0;

/** Registers what to tell once the mail was sent or saved; the token goes into the draft that opens the composer. */
export function awaitComposeDone(done: (how: ComposeEnd) => void): string {
  const token = `compose-${++minted}`;
  waiting.set(token, done);
  for (const key of waiting.keys()) {
    if (waiting.size <= BOUND) break;
    waiting.delete(key);
  }
  return token;
}

/** The composer's side: the mail of this token was sent or saved. Told once; a token nobody waits for is nothing. */
export function composeDone(token: string | undefined, how: ComposeEnd): void {
  if (!token) return;
  const done = waiting.get(token);
  waiting.delete(token);
  done?.(how);
}
