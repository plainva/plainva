import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bold, CheckSquare, Code, Heading, Italic, Link2, List, ListOrdered, Quote, Slash, Strikethrough } from "lucide-react";
import { ICON } from "@plainva/ui";
import {
  COMPOSE_COMMANDS,
  createComposeSession,
  filterCommands,
  type ComposeCommand,
  type ComposeCommandId,
  type ComposeSession,
} from "@plainva/ui/mail";
// The .pv-mail-cmp* rules live in mail.css. Import it here so the editor carries
// its own styling wherever it is used — the calendar event dialog reuses this
// component and never loads a mail view.
import "./mail.css";

/**
 * Compose message editor: a Markdown editor with a formatting toolbar and a `/`
 * slash-command menu (headings, bold/italic/strike/code, lists, task, quote,
 * code block, divider, link).
 *
 * The editor itself is the SHARED `createComposeSession` (G3b) — the same one
 * the phone runs, so writing a message cannot behave differently on the two
 * platforms. It carries a DEDICATED, ISOLATED CodeMirror live preview
 * (markdown decorations + theme only) WITHOUT the note editor's completion/
 * embed/table/wiki/header/block extensions, which fire global window events the
 * note editor also listens to; no such events here means an open note can never
 * be written to from the mail or event dialog. This file owns only the desktop
 * chrome: the inline toolbar, the caret-anchored menu and its keyboard
 * navigation.
 */

interface ComposeEditorProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Settings use: give the box a height grip (the compose window sizes itself). */
  resizable?: boolean;
  "data-testid"?: string;
}

/** Icon for a toolbar/menu command. */
function CmdIcon({ id }: { id: ComposeCommandId }) {
  switch (id) {
    case "h1": case "h2": case "h3": return <Heading size={ICON.ui} />;
    case "bold": return <Bold size={ICON.ui} />;
    case "italic": return <Italic size={ICON.ui} />;
    case "strike": return <Strikethrough size={ICON.ui} />;
    case "code": case "codeblock": return <Code size={ICON.ui} />;
    case "bullet": return <List size={ICON.ui} />;
    case "numbered": return <ListOrdered size={ICON.ui} />;
    case "task": return <CheckSquare size={ICON.ui} />;
    case "quote": return <Quote size={ICON.ui} />;
    case "link": return <Link2 size={ICON.ui} />;
    default: return <Slash size={ICON.ui} />;
  }
}

const TOOLBAR_IDS: ComposeCommandId[] = ["h1", "bold", "italic", "strike", "code", "bullet", "numbered", "task", "quote", "link"];

export function ComposeEditor({ value, onChange, placeholder, autoFocus, resizable, ...rest }: ComposeEditorProps) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<ComposeSession | null>(null);
  const onChangeRef = useRef(onChange);

  const [slash, setSlash] = useState<{ from: number; query: string; top: number; left: number } | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const commands: ComposeCommand[] = slash ? filterCommands(slash.query) : [];

  // Refs so the CodeMirror keymap (created once, at mount) always sees the
  // current slash state without re-creating the editor.
  const slashRef = useRef(slash);
  const commandsRef = useRef(commands);
  const slashIndexRef = useRef(slashIndex);

  const runCommand = useCallback((id: ComposeCommandId) => {
    sessionRef.current?.run(id);
  }, []);
  const runCmdRef = useRef(runCommand);

  const runSlashCommand = useCallback((id: ComposeCommandId) => {
    const s = slashRef.current;
    if (!s) return;
    sessionRef.current?.runSlash(id, s.from);
    setSlash(null);
  }, []);
  const runSlashRef = useRef(runSlashCommand);

  // Keep the mount-time keymap/listener refs pointing at the latest closures
  // (updating a ref during render is forbidden by the React Compiler rules).
  useEffect(() => {
    onChangeRef.current = onChange;
    slashRef.current = slash;
    commandsRef.current = commands;
    slashIndexRef.current = slashIndex;
    runCmdRef.current = runCommand;
    runSlashRef.current = runSlashCommand;
  });

  // Mount the shared compose session once.
  useEffect(() => {
    const parent = hostRef.current;
    if (!parent) return;
    const session = createComposeSession({
      parent,
      doc: value,
      placeholder,
      extraKeys: [
        { key: "ArrowDown", run: () => { const n = commandsRef.current.length; if (!slashRef.current || n === 0) return false; setSlashIndex((i) => (i + 1) % n); return true; } },
        { key: "ArrowUp", run: () => { const n = commandsRef.current.length; if (!slashRef.current || n === 0) return false; setSlashIndex((i) => (i - 1 + n) % n); return true; } },
        { key: "Enter", run: () => { const cmds = commandsRef.current; if (!slashRef.current || cmds.length === 0) return false; runSlashRef.current(cmds[slashIndexRef.current]?.id ?? cmds[0].id); return true; } },
        { key: "Tab", run: () => { const cmds = commandsRef.current; if (!slashRef.current || cmds.length === 0) return false; runSlashRef.current(cmds[slashIndexRef.current]?.id ?? cmds[0].id); return true; } },
        { key: "Escape", run: () => { if (!slashRef.current) return false; setSlash(null); return true; } },
        { key: "Mod-b", preventDefault: true, run: () => { runCmdRef.current("bold"); return true; } },
        { key: "Mod-i", preventDefault: true, run: () => { runCmdRef.current("italic"); return true; } },
      ],
      onChange: (v) => onChangeRef.current(v),
      onSlashChange: (hit) => {
        if (!hit) { setSlash((s) => (s ? null : s)); return; }
        const view = sessionRef.current?.view;
        const wrap = wrapRef.current;
        const coords = view?.coordsAtPos(view.state.selection.main.head);
        if (!coords || !wrap) { setSlash(null); return; }
        // Viewport coordinates, clamped so the panel stays on screen: it flips
        // above the caret near the bottom edge instead of being cut off.
        const MENU_W = 240;
        const MENU_H = 268;
        const left = Math.max(8, Math.min(coords.left, window.innerWidth - MENU_W));
        const below = coords.bottom + 2;
        const top = below + MENU_H > window.innerHeight ? Math.max(8, coords.top - MENU_H) : below;
        setSlash({ from: hit.from, query: hit.query, top, left });
        setSlashIndex(0);
      },
    });
    sessionRef.current = session;
    if (autoFocus) session.view.focus();
    return () => { session.destroy(); sessionRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync EXTERNAL value changes (reply/forward prefill set by the parent) into
  // the editor. Typing does not trigger this: onChange updates the parent value
  // to exactly what the session already emitted.
  useEffect(() => {
    sessionRef.current?.applyExternalText(value);
  }, [value]);

  return (
    <div className={`pv-mail-cmpeditor${resizable ? " pv-mail-cmpeditor--resizable" : ""}`}>
      <div className="pv-mail-cmptoolbar" role="toolbar" aria-label={t("compose.toolbar", { defaultValue: "Formatierung" })}>
        {TOOLBAR_IDS.map((id) => {
          const cmd = COMPOSE_COMMANDS.find((c) => c.id === id)!;
          return (
            <button
              key={id}
              type="button"
              className="pv-mail-cmptool"
              data-testid={`compose-tool-${id}`}
              data-tip={t(cmd.labelKey, { defaultValue: cmd.defaultLabel })}
              aria-label={t(cmd.labelKey, { defaultValue: cmd.defaultLabel })}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runCommand(id)}
            >
              <CmdIcon id={id} />
            </button>
          );
        })}
        <span className="pv-mail-cmptool-hint">
          <Slash size={ICON.meta} /> {t("compose.slashHint", { defaultValue: "„/“ für Befehle" })}
        </span>
      </div>
      <div className="pv-mail-cmpbodywrap" ref={wrapRef}>
        <div ref={hostRef} className="pv-mail-cmpbody" data-testid={rest["data-testid"]} />
        {slash && commands.length > 0 && (
          <div className="pv-mail-cmpslash" role="listbox" data-testid="compose-slash-menu" style={{ top: slash.top, left: slash.left }}>
            {commands.map((c, i) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={i === slashIndex}
                className={"pv-mail-cmpslash-item" + (i === slashIndex ? " on" : "")}
                data-testid={`compose-slash-${c.id}`}
                onMouseEnter={() => setSlashIndex(i)}
                onMouseDown={(e) => { e.preventDefault(); runSlashCommand(c.id); }}
              >
                <CmdIcon id={c.id} />
                <span>{t(c.labelKey, { defaultValue: c.defaultLabel })}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
