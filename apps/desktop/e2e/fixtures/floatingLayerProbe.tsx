import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Button,
  FloatingWindow,
  MenuItem,
  MenuSurface,
  Modal,
  Select,
  TextInput,
  useFixedPopover,
} from "../../../../packages/ui/src/index";
import "../../../../packages/ui/src/styles/base-colors.css";
import "../../../../packages/ui/src/styles/tokens.css";
import "../../../../packages/ui/src/styles/ui.css";
import "../../../../packages/ui/src/themes/index.css";
import "../../src/App.css";
import "../../../../packages/ui/src/i18n";

/**
 * The layer probe: the real FloatingWindow, Modal, MenuSurface, Select and
 * fixed popover over the real stylesheets, and nothing else. What lies in
 * front of what is a property of these primitives and their tokens, so it is
 * asked here, where a test can open any two of them at once — the app only
 * reaches a few of the combinations, each behind its own mock.
 *
 * Every window opens centered, and the two have different sizes on purpose:
 * the small one lies inside the large one, so "which of them is in front" has
 * one answer at the small window's centre.
 */

type WinId = "a" | "b";
const SIZE: Record<WinId, { w: number; h: number }> = { a: { w: 720, h: 520 }, b: { w: 400, h: 280 } };
const CHOICES = ["one", "two", "three"].map((value) => ({ value, label: `Choice ${value}` }));

function Win({ id, onClose, subject }: { id: WinId; onClose: () => void; subject?: string }) {
  const [open, setOpen] = useState<null | "menu" | "popover" | "dialog">(null);
  const [choice, setChoice] = useState("one");
  const menuBtn = useRef<HTMLButtonElement>(null);
  const popBtn = useRef<HTMLButtonElement>(null);
  const popRef = useFixedPopover(open === "popover", popBtn);
  const close = () => setOpen(null);
  return (
    <FloatingWindow
      persistKey={`probe-${id}`}
      defaultWidth={SIZE[id].w}
      defaultHeight={SIZE[id].h}
      minWidth={240}
      minHeight={160}
      ariaLabel={`Window ${id}`}
      testId={`win-${id}`}
      subject={subject}
      onEscape={onClose}
      head={<span className="pv-peek-title">Window {id}</span>}
    >
      {/* The controls sit in one centered row at the top, so whatever they
          open hangs down into the middle of the window — where the other
          window is. */}
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "var(--space-2)", padding: "var(--space-3)" }}>
        <Button ref={menuBtn} data-testid={`${id}-menu-btn`} onClick={() => setOpen("menu")}>Menu</Button>
        <Button ref={popBtn} data-testid={`${id}-popover-btn`} onClick={() => setOpen("popover")}>Popover</Button>
        <Select value={choice} onChange={setChoice} ariaLabel={`Choice ${id}`} data-testid={`${id}-select`} options={CHOICES} />
        <Button data-testid={`${id}-dialog-btn`} onClick={() => setOpen("dialog")}>Dialog</Button>
      </div>
      <div style={{ padding: "0 var(--space-3)" }}>
        <TextInput data-testid={`${id}-field`} aria-label={`Field ${id}`} style={{ width: "100%" }} />
      </div>
      {open === "menu" && (
        <MenuSurface open anchorRef={menuBtn} onClose={close} ariaLabel={`Menu ${id}`}>
          {CHOICES.map((c) => (
            <MenuItem key={c.value} data-testid={`${id}-menu-${c.value}`} onSelect={() => setChoice(c.value)}>
              {c.label}
            </MenuItem>
          ))}
        </MenuSurface>
      )}
      {open === "popover" && (
        <div ref={popRef} className="pv-popover pv-popover--fixed" data-testid={`${id}-popover`}>
          {CHOICES.map((c) => (
            <button key={c.value} type="button" className="pv-popover-row" data-testid={`${id}-popover-${c.value}`} onClick={() => { setChoice(c.value); close(); }}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      {open === "dialog" && (
        <Modal onClose={close} title={`Dialog of window ${id}`} testId={`${id}-dialog`}>
          <TextInput data-testid={`${id}-dialog-field`} aria-label={`Dialog field ${id}`} style={{ width: "100%" }} />
        </Modal>
      )}
      <output data-testid={`${id}-choice`} hidden>{choice}</output>
    </FloatingWindow>
  );
}

/**
 * One window with the button that opens it — and a state of its own. That is
 * how the app hosts its windows: a database, the calendar and the shell each
 * keep theirs, so closing one window re-renders nothing that belongs to
 * another. A probe that kept both windows in one state would hide what that
 * means for a key press that reaches both.
 */
function Slot({ id }: { id: WinId }) {
  const [open, setOpen] = useState(false);
  // What the host shows in the window; "another entry" changes it while the window stays open.
  const [entry, setEntry] = useState(1);
  return (
    <>
      <Button size="sm" data-testid={`open-${id}`} onClick={() => setOpen((o) => !o)}>Window {id}</Button>
      <Button size="sm" data-testid={`next-in-${id}`} onClick={() => setEntry((n) => n + 1)}>Another entry in {id}</Button>
      {open && <Win id={id} subject={`entry ${entry}`} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * A window rendered from a React root of its own, the way a database embedded
 * in a note opens its preview: the editor mounts the embed into a widget, so
 * no context of the surrounding tree reaches it — only the DOM does.
 */
function DetachedWin({ id, onClose }: { id: WinId; onClose: () => void }) {
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const root = createRoot(host.current!);
    root.render(<Win id={id} onClose={onClose} />);
    // Not inside this commit: React refuses to unmount one root while it is
    // still committing another.
    return () => { setTimeout(() => root.unmount(), 0); };
    // Mount only: the probe never changes a detached window's props.
  }, []);
  return <span ref={host} />;
}

function Desk() {
  const [dialog, setDialog] = useState(false);
  const [palette, setPalette] = useState(false);
  // The window the dialog itself opened: in the dialog's own tree, or in a root of its own.
  const [fromDialog, setFromDialog] = useState<null | "tree" | "detached">(null);
  const closeDialog = () => { setDialog(false); setFromDialog(null); };
  return (
    <>
      {/* Top left, clear of every centered window. */}
      <div style={{ position: "fixed", left: 8, top: 8, display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
        <Slot id="a" />
        <Slot id="b" />
        <Button size="sm" data-testid="open-dialog" onClick={() => setDialog(true)}>Dialog</Button>
        <Button size="sm" data-testid="open-palette" onClick={() => setPalette(true)}>Palette</Button>
      </div>
      {dialog && (
        <Modal onClose={closeDialog} title="Dialog" testId="dialog">
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <TextInput data-testid="dialog-field" aria-label="Dialog field" />
            <Button data-testid="dialog-open-window" onClick={() => setFromDialog("tree")}>Window from here</Button>
            <Button data-testid="dialog-open-detached" onClick={() => setFromDialog("detached")}>Window from an embed</Button>
          </div>
          {fromDialog === "tree" && <Win id="b" onClose={() => setFromDialog(null)} />}
          {fromDialog === "detached" && <DetachedWin id="b" onClose={() => setFromDialog(null)} />}
        </Modal>
      )}
      {palette && (
        // The markup every palette of the app writes (CommandPalette, QuickSwitcher).
        <div className="pv-palette-overlay" data-testid="palette" onClick={() => setPalette(false)}>
          <div className="pv-palette" role="dialog" aria-label="Palette" onClick={(e) => e.stopPropagation()}>
            <div className="pv-palette-inputrow">
              <input
                autoFocus
                type="text"
                className="pv-palette-input"
                data-testid="palette-field"
                aria-label="Palette field"
                onKeyDown={(e) => { if (e.key === "Escape") setPalette(false); }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** The attributes the theme registry writes onto <html> for a bundled theme. */
export interface ProbeTheme { name: string; mode: "light" | "dark"; variant?: string }

let root: Root | undefined;
export const floatingLayerProbe = {
  /** A fresh desk: nothing open, the theme set the way the app sets it. */
  mount(theme?: ProbeTheme) {
    root?.unmount();
    const html = document.documentElement;
    for (const attr of ["data-theme-name", "data-theme", "data-theme-variant"]) html.removeAttribute(attr);
    if (theme) {
      html.setAttribute("data-theme-name", theme.name);
      html.setAttribute("data-theme", theme.mode);
      if (theme.variant) html.setAttribute("data-theme-variant", theme.variant);
    }
    root = createRoot(document.getElementById("host")!);
    root.render(<Desk />);
  },
};
export type FloatingLayerProbeWindow = Window & { floatingLayerProbe: typeof floatingLayerProbe };
(window as FloatingLayerProbeWindow).floatingLayerProbe = floatingLayerProbe;
