import { useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Button,
  ClickCatch,
  FloatingWindow,
  MenuItem,
  MenuSurface,
  useFixedPopover,
} from "../../../../packages/ui/src/index";
import "../../../../packages/ui/src/styles/base-colors.css";
import "../../../../packages/ui/src/styles/tokens.css";
import "../../../../packages/ui/src/styles/ui.css";
import "../../../../packages/ui/src/themes/index.css";
import "../../src/App.css";
import "../../../../packages/ui/src/i18n";

/**
 * The probe for leaving a surface by a press beside it: the real ClickCatch,
 * MenuSurface and FloatingWindow over the real stylesheets, and nothing else.
 *
 * What it adds to the app's own tests is the one arrangement the app reaches
 * only deep inside a note: a popover opened from within a stacking context of
 * its own. An editor's scroller is one (positioned, with a layer), and a
 * database embedded in a note lives in it. There the catcher's layer counts
 * inside the scroller alone, and a floating window lies in FRONT of the
 * catcher, whatever layer the catcher names.
 */
function Desk() {
  const [form, setForm] = useState(false);
  const [menu, setMenu] = useState(false);
  const [beside, setBeside] = useState(0);
  const formBtn = useRef<HTMLButtonElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const popRef = useFixedPopover(form, formBtn);
  return (
    <>
      {/* The editor's scroller: positioned, with a layer of its own. */}
      <div data-testid="scroller" style={{ position: "relative", zIndex: 0, padding: 16, display: "flex", gap: 8, alignItems: "flex-start" }}>
        <Button ref={formBtn} data-testid="open-form" onClick={() => setForm(true)}>Form</Button>
        <Button data-testid="beside" onClick={() => setBeside((n) => n + 1)}>Beside</Button>
        <output data-testid="beside-count">{beside}</output>
        {form && (
          <>
            <ClickCatch onPress={() => setForm(false)} popover={popRef} />
            <div ref={popRef} className="pv-popover pv-popover--fixed" data-testid="form">A form with two buttons</div>
          </>
        )}
      </div>
      {/* A line narrower than a menu's own least width, at the foot of the page:
          the menu that hangs on it is as wide as the line, and opens over it. */}
      <div ref={line} data-testid="line" style={{ position: "fixed", left: 16, bottom: 16, width: 133 }}>
        <Button data-testid="open-menu" onClick={() => setMenu((m) => !m)} style={{ width: "100%" }}>Line</Button>
      </div>
      <MenuSurface open={menu} onClose={() => setMenu(false)} anchorRef={line} matchAnchorWidth ariaLabel="Line menu">
        <MenuItem data-testid="menu-long" onSelect={() => {}}>An entry with a name far longer than the line it hangs on</MenuItem>
        <MenuItem onSelect={() => {}}>Short</MenuItem>
      </MenuSurface>
      <FloatingWindow
        persistKey="probe-outside-press"
        defaultWidth={420}
        defaultHeight={300}
        minWidth={240}
        minHeight={160}
        ariaLabel="Window"
        testId="win"
        head={<span className="pv-peek-title">Window</span>}
      >
        <p data-testid="win-text" style={{ padding: 16 }}>Text in the window</p>
      </FloatingWindow>
    </>
  );
}

let root: Root | undefined;
export const outsidePressProbe = {
  mount() {
    root?.unmount();
    root = createRoot(document.getElementById("host")!);
    root.render(<Desk />);
  },
};
export type OutsidePressProbeWindow = Window & { outsidePressProbe: typeof outsidePressProbe };
(window as OutsidePressProbeWindow).outsidePressProbe = outsidePressProbe;
