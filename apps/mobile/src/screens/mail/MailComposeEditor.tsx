import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bold,
  CheckSquare,
  Code,
  Heading,
  Italic,
  Link2,
  List,
  ListOrdered,
  Plus,
  Quote,
  Slash,
  Strikethrough,
} from "lucide-react";
import { DockedToolbar } from "@plainva/ui";
import {
  COMPOSE_COMMANDS,
  createComposeSession,
  filterCommands,
  type ComposeCommand,
  type ComposeCommandId,
  type ComposeSession,
} from "@plainva/ui/mail";

/**
 * The message body as a real Markdown editor (G3b).
 *
 * Until now the phone offered a plain text area while the desktop had a live
 * preview with a formatting toolbar and a "/" menu — the same message, written
 * on two devices, was two different experiences. Both now run the SHARED
 * `createComposeSession`, so the editing behaviour cannot drift apart; what
 * differs is only the chrome around it, and deliberately so: the toolbar docks
 * above the keyboard rather than sitting inline, and it appears only while the
 * body has focus so it never covers the form below.
 *
 * Compose is a screen of its own in the shell's ternary chain, so the note
 * editor is unmounted while this one lives: never two editors on one surface.
 */

const TOOLBAR_IDS: ComposeCommandId[] = ["bold", "italic", "strike", "h1", "bullet", "numbered", "task", "quote", "code", "link"];

function CmdIcon({ id }: { id: ComposeCommandId }) {
  switch (id) {
    case "h1": case "h2": case "h3": return <Heading size={18} />;
    case "bold": return <Bold size={18} />;
    case "italic": return <Italic size={18} />;
    case "strike": return <Strikethrough size={18} />;
    case "code": case "codeblock": return <Code size={18} />;
    case "bullet": return <List size={18} />;
    case "numbered": return <ListOrdered size={18} />;
    case "task": return <CheckSquare size={18} />;
    case "quote": return <Quote size={18} />;
    case "link": return <Link2 size={18} />;
    default: return <Slash size={18} />;
  }
}

export function MailComposeEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<ComposeSession | null>(null);
  const onChangeRef = useRef(onChange);

  const [focused, setFocused] = useState(false);
  const [slash, setSlash] = useState<{ from: number; query: string; top: number } | null>(null);
  const commands: ComposeCommand[] = slash ? filterCommands(slash.query) : [];

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    const parent = hostRef.current;
    if (!parent) return;
    const session = createComposeSession({
      parent,
      doc: value,
      placeholder,
      touch: true,
      // Escape closes the menu; the typed "/" stays, exactly as on the desktop.
      extraKeys: [{ key: "Escape", run: () => { setSlash(null); return false; } }],
      onChange: (v) => onChangeRef.current(v),
      onFocusChange: setFocused,
      onSlashChange: (hit) => {
        if (!hit) {
          setSlash((s) => (s ? null : s));
          return;
        }
        // Anchor the menu under the caret line; full width, so a thumb cannot miss.
        const view = sessionRef.current?.view;
        const wrap = wrapRef.current;
        const coords = view?.coordsAtPos(view.state.selection.main.head);
        const top = coords && wrap ? coords.bottom - wrap.getBoundingClientRect().top + 4 : 0;
        setSlash({ from: hit.from, query: hit.query, top });
      },
    });
    sessionRef.current = session;
    return () => {
      session.destroy();
      sessionRef.current = null;
    };
    // Built once; the value prop is adopted by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A reply prefill arriving from the parent. Typing never lands here: onChange
  // already set the parent to what the session emitted.
  useEffect(() => {
    sessionRef.current?.applyExternalText(value);
  }, [value]);

  const insertSlash = useCallback(() => {
    const view = sessionRef.current?.view;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const doc = view.state.doc.toString();
    const needsSpace = from > 0 && doc[from - 1] !== "\n" && doc[from - 1] !== " ";
    const insert = (needsSpace ? " " : "") + "/";
    view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
    view.focus();
  }, []);

  return (
    <div className="m-cmpeditor">
      <div className="m-cmpwrap" ref={wrapRef}>
        <div ref={hostRef} className="m-cmpbody" data-testid="mail-compose-body" />
        {slash && commands.length > 0 && (
          <div className="m-cmpslash" role="listbox" data-testid="mail-compose-slash" style={{ top: slash.top }}>
            {commands.map((c) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={false}
                className="m-cmpslash-item"
                data-testid={`mail-compose-slash-${c.id}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => sessionRef.current?.runSlash(c.id, slash.from)}
              >
                <CmdIcon id={c.id} />
                <span>{t(c.labelKey, { defaultValue: c.defaultLabel })}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {focused && (
        <DockedToolbar aria-label={t("compose.toolbar")} className="m-edit-toolbar">
          {/* ＋ opens the same "/" menu the desktop shows — the note editor's
              insert button reads exactly like this, so the phone stays
              consistent with itself. */}
          <button
            type="button"
            aria-label={t("compose.slashHint")}
            className="is-primary"
            data-testid="mail-compose-insert"
            onMouseDown={(e) => e.preventDefault()}
            onClick={insertSlash}
          >
            <Plus size={18} />
          </button>
          {TOOLBAR_IDS.map((id) => {
            const cmd = COMPOSE_COMMANDS.find((c) => c.id === id)!;
            return (
              <button
                key={id}
                type="button"
                aria-label={t(cmd.labelKey, { defaultValue: cmd.defaultLabel })}
                data-testid={`mail-compose-tool-${id}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => sessionRef.current?.run(id)}
              >
                <CmdIcon id={id} />
              </button>
            );
          })}
        </DockedToolbar>
      )}
    </div>
  );
}
