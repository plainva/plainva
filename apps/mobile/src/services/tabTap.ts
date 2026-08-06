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
 * a change the user has not agreed to yet.
 */
export async function tabTapped(
  id: TabScreenId,
  setNav: (fn: (state: NavState) => NavState) => void,
): Promise<void> {
  if (!(await askBeforeLeaving())) return;
  haptics.light();
  // Home starts again — see forgetNavigatorSection for who else may do this.
  if (id === "notes") forgetNavigatorSection();
  setNav((state) => tapTab(state, id));
}
