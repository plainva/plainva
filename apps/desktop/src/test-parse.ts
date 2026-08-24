import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";

/**
 * Drive CodeMirror's background parse to completion for a test.
 *
 * Two separate things make a plain `ensureSyntaxTree(state, upto, 5000)` call
 * unreliable, and this helper handles both:
 *
 * 1. The timeout is a WALL-CLOCK slice. `ensureSyntaxTree` returns null when
 *    the slice runs out before reaching `upto`, so one fixed budget measures
 *    the machine's CPU share rather than the parse. The v0.7.0 release cut fell
 *    exactly here: tree length 7 against a 3000-character precondition on an
 *    overbooked Windows runner (suite 722s with 1728s of setup time), green on
 *    macOS, on Linux and locally (137s). The parse context lives in the editor
 *    state, so repeated calls RESUME the same parse -- looping until CodeMirror
 *    reports it done measures the parse and nothing else.
 *
 * 2. `syntaxTree(state)` reads the Language StateField's SNAPSHOT, which only
 *    adopts the parser's progress on the next transaction. Driving the parse
 *    without one leaves the snapshot at the init window, however long it ran.
 *    Passing a view lets this settle it with an empty dispatch.
 *
 * Pass a view whenever the caller has one. A detached state cannot be settled
 * in place; that stays sound for fixtures below the ~3000-character window the
 * initial parse covers synchronously, which is what the state callers use.
 *
 * The deadline exists only so a genuinely stuck parse fails the test instead of
 * hanging the suite.
 */
export function forceFullParse(
  target: EditorView | EditorState,
  upto?: number,
  budgetMs = 30_000,
): void {
  const view = "state" in target ? target : null;
  const state = view ? view.state : (target as EditorState);
  const end = upto ?? state.doc.length;
  const deadline = Date.now() + budgetMs;
  do {
    if (ensureSyntaxTree(state, end, 1000) != null) break;
  } while (Date.now() < deadline);
  // Make the StateField snapshot adopt what the parser just produced.
  view?.dispatch({});
}
