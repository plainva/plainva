import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bold, CheckSquare, Code, Heading, Italic, Link2, List, ListOrdered, Quote, Slash, Strikethrough } from "lucide-react";
import {
  applyComposeCommand,
  COMPOSE_COMMANDS,
  detectSlash,
  filterCommands,
  type ComposeCommand,
  type ComposeCommandId,
  type TextEdit,
} from "./composeMarkdown";
import { ICON } from "@plainva/ui";
// The .pv-mail-cmp* rules live in mail.css. Import it here so the editor carries
// its own styling wherever it is used — the calendar event dialog reuses this
// component and never loads a mail view, so without this the textarea rendered
// as a bare (monospace, resizable) browser textarea.
import "./mail.css";

/**
 * Compose message editor: a Markdown <textarea> with a formatting toolbar and a
 * `/` slash-command menu (headings, bold/italic/strike/code, lists, task,
 * quote, code block, divider, link). All commands are pure textarea edits — the
 * shared CodeMirror session is deliberately NOT reused here (its slash pickers
 * fire global window events the note editor also handles, some unguarded, which
 * would cross-talk with an open note). See composeMarkdown.ts.
 */

interface ComposeEditorProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
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

export function ComposeEditor({ value, onChange, placeholder, autoFocus, ...rest }: ComposeEditorProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement | null>(null);
  // A pending selection to restore after a value change (React re-render clears
  // the native selection otherwise).
  const pendingSel = useRef<{ start: number; end: number } | null>(null);
  // Slash menu: active trigger position + query + highlighted index + anchor.
  const [slash, setSlash] = useState<{ from: number; query: string; top: number; left: number } | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pendingSel.current) {
      el.setSelectionRange(pendingSel.current.start, pendingSel.current.end);
      pendingSel.current = null;
    }
  });

  const apply = useCallback(
    (edit: TextEdit) => {
      pendingSel.current = { start: edit.selStart, end: edit.selEnd };
      onChange(edit.value);
    },
    [onChange]
  );

  const runCommand = useCallback(
    (id: ComposeCommandId) => {
      const el = ref.current;
      if (!el) return;
      apply(applyComposeCommand(id, el.value, el.selectionStart, el.selectionEnd));
      requestAnimationFrame(() => ref.current?.focus());
    },
    [apply]
  );

  // Drop the `/query` text, then run the command at the slash position.
  const runSlashCommand = useCallback(
    (id: ComposeCommandId) => {
      const el = ref.current;
      if (!el || !slash) return;
      const caret = el.selectionEnd;
      const stripped = el.value.slice(0, slash.from) + el.value.slice(caret);
      apply(applyComposeCommand(id, stripped, slash.from, slash.from));
      setSlash(null);
      requestAnimationFrame(() => ref.current?.focus());
    },
    [apply, slash]
  );

  // Position the slash menu just below the caret's line (line-based — robust,
  // no mirror-div maths): count newlines before the caret, multiply by the
  // computed line height, offset by padding minus the scroll position.
  const updateSlash = useCallback(() => {
    const el = ref.current;
    if (!el) { setSlash(null); return; }
    const hit = detectSlash(el.value, el.selectionEnd);
    if (!hit) { setSlash(null); return; }
    const cs = window.getComputedStyle(el);
    const lineH = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 || 18;
    const padTop = parseFloat(cs.paddingTop) || 0;
    const padLeft = parseFloat(cs.paddingLeft) || 0;
    const lineIdx = el.value.slice(0, el.selectionEnd).split("\n").length - 1;
    const top = padTop + (lineIdx + 1) * lineH - el.scrollTop + 2;
    setSlash({ from: hit.from, query: hit.query, top, left: padLeft });
    setSlashIndex(0);
  }, []);

  const commands: ComposeCommand[] = slash ? filterCommands(slash.query) : [];

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slash && commands.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashIndex((i) => (i + 1) % commands.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSlashIndex((i) => (i - 1 + commands.length) % commands.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); runSlashCommand(commands[slashIndex].id); return; }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setSlash(null); return; }
    }
    // Editor-style shortcuts even without the slash menu.
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "b") { e.preventDefault(); runCommand("bold"); return; }
      if (k === "i") { e.preventDefault(); runCommand("italic"); return; }
    }
  };

  return (
    <div className="pv-mail-cmpeditor">
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
      <div className="pv-mail-cmpbodywrap">
        <textarea
          ref={ref}
          className="pv-mail-cmpbody"
          value={value}
          onChange={(e) => { onChange(e.target.value); updateSlash(); }}
          onKeyDown={onKeyDown}
          onKeyUp={updateSlash}
          onClick={updateSlash}
          onBlur={() => setTimeout(() => setSlash(null), 120)}
          data-testid={rest["data-testid"]}
          placeholder={placeholder}
          autoFocus={autoFocus}
        />
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
