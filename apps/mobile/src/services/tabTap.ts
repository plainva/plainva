import { requestNew, type NewItemId } from "@plainva/ui";
import { tapTab, type NavState, type TabScreenId } from "../navigation";
import { askBeforeLeaving } from "./leaveQuestion";
import { forgetNavigatorSection } from "./navigatorPlace";
import { haptics } from "./haptics";

/**
 * What a tap on the bottom bar does (N1.4).
 *
 * It is more than "switch tab", and the parts had drifted apart: the unsaved-
 * work question, the haptic, the stack reset and — since N1.4 — forgetting the
 * remembered navigator section all have to happen together, in that order, and
 * only for this gesture. Spread across an inline handler in the shell they read
 * as four unrelated lines; here they read as one decision, which is what they
 * are.
 *
 * The order matters: the question comes first, because everything after it is
 * a change the user has not agreed to yet. `agreed` is what the step brings
 * along (see `newInTab`): it runs once the answer is yes, and before the area
 * opens. Resolves to whether the step was taken.
 */
export async function tabTapped(
  id: TabScreenId,
  setNav: (fn: (state: NavState) => NavState) => void,
  agreed?: () => void,
): Promise<boolean> {
  if (!(await askBeforeLeaving())) return false;
  agreed?.();
  haptics.light();
  // Home starts again — see forgetNavigatorSection for who else may do this.
  if (id === "notes") forgetNavigatorSection();
  setNav((state) => tapTab(state, id));
  return true;
}

/**
 * "New task" and "New event" from elsewhere: the area that makes the thing
 * opens and takes the request (finding 2026-10-12).
 *
 * The request is parked for a screen that may still be mounting (`requestNew`),
 * and it used to be parked by the caller, a line BEFORE the bar step asked
 * about unsaved work. After "Cancel" it was still waiting: the capture sheet
 * opened by itself on the next visit to the area — minutes later, with whatever
 * a journal entry had handed over still in it. Parking the request is part of
 * what the person has not agreed to yet, so it comes after the question, like
 * the rest of the step. "Cancel" leaves nothing behind.
 *
 * Resolves to whether the area opened, for a caller that has something of its
 * own to finish then (the journal sheet closes only once its text is taken).
 */
export function newInTab(
  item: NewItemId,
  tab: TabScreenId,
  setNav: (fn: (state: NavState) => NavState) => void,
  text = "",
): Promise<boolean> {
  return tabTapped(tab, setNav, () => requestNew(item, text));
}
