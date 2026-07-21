import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bold, CheckSquare, Code, Heading, Italic, Link2, List, ListOrdered, Quote, Slash, Strikethrough } from "lucide-react";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { ICON, markdownDecorationPlugin, markdownTheme } from "@plainva/ui";
import {
  applyComposeCommand,
  COMPOSE_COMMANDS,
  detectSlash,
  filterCommands,
  type ComposeCommand,
  type ComposeCommandId,
} from "./composeMarkdown";
// The .pv-mail-cmp* rules live in mail.css. Import it here so the editor carries
// its own styling wherever it is used — the calendar event dialog reuses this
// component and never loads a mail view.
import "./mail.css";

/**
 * Compose message editor: a Markdown editor with a formatting toolbar and a `/`
 * slash-command menu (headings, bold/italic/strike/code, lists, task, quote,
 * code block, divider, link). It runs a DEDICATED, ISOLATED CodeMirror live
 * preview (markdownDecorationPlugin + markdownTheme only) so the body renders
 * formatted exactly like the note editor — but WITHOUT the note editor's
 * completion/embed/table/wiki/header/block extensions, which fire global window
 * events the note editor also listens to. No editorCompletion here = no such
 * events, so an open note can never be written to from the mail/event dialog.
 * The toolbar/slash commands stay the pure text ops of composeMarkdown.ts,
 * applied to the editor as CodeMirror transactions.
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
  const hostRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const lastValueRef = useRef(value);

  const [slash, setSlash] = useState<{ from: number; query: string; top: number; left: number } | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const commands: ComposeCommand[] = slash ? filterCommands(slash.query) : [];

  // Refs so the CodeMirror keymap (created once, at mount) always sees the
  // current slash state without re-creating the editor.
  const slashRef = useRef(slash);
  const commandsRef = useRef(commands);
  const slashIndexRef = useRef(slashIndex);

  const runCommand = useCallback((id: ComposeCommandId) => {
    const view = viewRef.current;
    if (!view) return;
    const doc = view.state.doc.toString();
    const { from, to } = view.state.selection.main;
    const edit = applyComposeCommand(id, doc, from, to);
    view.dispatch({ changes: { from: 0, to: doc.length, insert: edit.value }, selection: { anchor: edit.selStart, head: edit.selEnd } });
    view.focus();
  }, []);
  const runCmdRef = useRef(runCommand);

  const runSlashCommand = useCallback((id: ComposeCommandId) => {
    const view = viewRef.current;
    const s = slashRef.current;
    if (!view || !s) return;
    const doc = view.state.doc.toString();
    const caret = view.state.selection.main.head;
    const stripped = doc.slice(0, s.from) + doc.slice(caret);
    const edit = applyComposeCommand(id, stripped, s.from, s.from);
    view.dispatch({ changes: { from: 0, to: doc.length, insert: edit.value }, selection: { anchor: edit.selStart, head: edit.selEnd } });
    setSlash(null);
    view.focus();
  }, []);
  const runSlashRef = useRef(runSlashCommand);

  const updateSlash = useCallback(() => {
    const view = viewRef.current;
    if (!view) { setSlash(null); return; }
    const doc = view.state.doc.toString();
    const caret = view.state.selection.main.head;
    const hit = detectSlash(doc, caret);
    if (!hit) { setSlash((s) => (s ? null : s)); return; }
    const coords = view.coordsAtPos(caret);
    const wrap = wrapRef.current;
    if (!coords || !wrap) { setSlash(null); return; }
    const box = wrap.getBoundingClientRect();
    setSlash({ from: hit.from, query: hit.query, top: coords.bottom - box.top + 2, left: coords.left - box.left });
    setSlashIndex(0);
  }, []);
  const updateSlashRef = useRef(updateSlash);

  // Keep the mount-time keymap/listener refs pointing at the latest closures
  // (updating a ref during render is forbidden by the React Compiler rules).
  useEffect(() => {
    onChangeRef.current = onChange;
    slashRef.current = slash;
    commandsRef.current = commands;
    slashIndexRef.current = slashIndex;
    runCmdRef.current = runCommand;
    runSlashRef.current = runSlashCommand;
    updateSlashRef.current = updateSlash;
  });

  // Mount the isolated CodeMirror live preview once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const slashKeys = Prec.highest(
      keymap.of([
        { key: "ArrowDown", run: () => { const n = commandsRef.current.length; if (!slashRef.current || n === 0) return false; setSlashIndex((i) => (i + 1) % n); return true; } },
        { key: "ArrowUp", run: () => { const n = commandsRef.current.length; if (!slashRef.current || n === 0) return false; setSlashIndex((i) => (i - 1 + n) % n); return true; } },
        { key: "Enter", run: () => { const cmds = commandsRef.current; if (!slashRef.current || cmds.length === 0) return false; runSlashRef.current(cmds[slashIndexRef.current]?.id ?? cmds[0].id); return true; } },
        { key: "Tab", run: () => { const cmds = commandsRef.current; if (!slashRef.current || cmds.length === 0) return false; runSlashRef.current(cmds[slashIndexRef.current]?.id ?? cmds[0].id); return true; } },
        { key: "Escape", run: () => { if (!slashRef.current) return false; setSlash(null); return true; } },
        { key: "Mod-b", preventDefault: true, run: () => { runCmdRef.current("bold"); return true; } },
        { key: "Mod-i", preventDefault: true, run: () => { runCmdRef.current("italic"); return true; } },
      ])
    );
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          slashKeys,
          markdown(),
          markdownDecorationPlugin(true),
          markdownTheme(),
          EditorView.lineWrapping,
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          cmPlaceholder(placeholder ?? ""),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              const v = u.state.doc.toString();
              lastValueRef.current = v;
              onChangeRef.current(v);
            }
            if (u.docChanged || u.selectionSet) updateSlashRef.current();
          }),
        ],
      }),
      parent: host,
    });
    viewRef.current = view;
    if (autoFocus) view.focus();
    return () => { view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync EXTERNAL value changes (reply/forward prefill set by the parent) into
  // the editor. Typing does not trigger this: onChange updates the parent value
  // to exactly what the listener already emitted, so value === lastValueRef.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === lastValueRef.current) return;
    const cur = view.state.doc.toString();
    if (value !== cur) view.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
    lastValueRef.current = value;
  }, [value]);

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
