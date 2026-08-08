import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button } from "@plainva/ui";
import { getMobileSettings, updateMobileSettings } from "../services/mobileSettings";

/**
 * Says once per vault that rows can be swiped (round 3, R1.1 / decision E1).
 *
 * `SwipeRow` was complete since S12 and announced by NOTHING — no edge marker,
 * no hint, no first run, no word in the manual. A gesture you only find if you
 * already know about it does not exist for most people, and the maintainer who
 * wrote the rule ("tap opens, swipe performs the row action") did not find it
 * either. That is the finding this closes.
 *
 * E1 chose the pair "one-time hint + the same actions in the row's action
 * sheet" over a permanent grip strip on the row edge, and the second half of
 * that pair matters more than the first: the hint teaches, the sheet is what
 * makes the gesture never the ONLY way to reach an action. So this component
 * is deliberately small — it is the announcement, not the affordance.
 *
 * Dismissal is per VAULT and device-local (the same slice `navigatorTab` lives
 * in): the phone teaches a TOUCH gesture, so "has been taught" belongs to the
 * device that has the touchscreen. There is no desktop counterpart to carry it
 * to, and a second phone still has to learn it.
 */
export function SwipeHint() {
  // Read once on mount: the value only ever changes through the button below,
  // and re-reading on every render would make the dismissal depend on when a
  // parent happens to re-render.
  const [seen, setSeen] = useState(() => getMobileSettings().swipeHintSeen);
  const { t } = useTranslation();
  if (seen) return null;
  return (
    <Banner
      className="m-swipehint"
      kind="info"
      rounded
      actions={
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setSeen(true);
            void updateMobileSettings({ swipeHintSeen: true });
          }}
        >
          {t("mobile.swipeHintAck")}
        </Button>
      }
    >
      {t("mobile.swipeHint")}
    </Banner>
  );
}
