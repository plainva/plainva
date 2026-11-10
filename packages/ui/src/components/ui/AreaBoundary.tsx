import { Component, Fragment, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, RotateCw } from "lucide-react";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import { IconButton } from "./IconButton";
import { Modal } from "./Modal";
import { cx } from "./cx";
import { ICON } from "../../lib/iconSizes";
import { logDiagnostic } from "../../services/diagnosticsLog";
import { getPlatformServices, hasPlatformServices } from "../../platform/services";

/**
 * A way out of a failed area that does not depend on the area itself: close
 * the tab, go back one screen, close the dialog.
 */
export interface AreaExit {
  label: string;
  onExit: () => void;
}

/**
 * How much room the fallback takes. `pane` fills a tab, a screen or a column;
 * `section` is the compact form for a sidebar section, a popover or a sheet's
 * body, where a centred empty state of a whole pane would push everything else
 * out of sight; `strip` is one line for a bar of the shell (title bar, status
 * bar, tab strip, the database line), whose height must not change;
 * `dialog` stands in for a dialog on the overlay layer.
 */
export type AreaBoundarySize = "pane" | "section" | "strip" | "dialog";

export interface AreaBoundaryProps {
  /**
   * The area's machine name for the diagnostics, such as `tab:graph`,
   * `section:backlinks` or `screen:note`. A KIND, never a note path or a
   * title: the diagnostics export is meant to be attached to a public issue.
   */
  area: string;
  /**
   * A FAILED area tries again when this changes — another note in the tab,
   * another message in the reader, another note beside a sidebar section: a
   * failure of the one before says nothing about the next. A healthy area is
   * not remounted by it; what it shows keeps its state.
   */
  resetKey?: string | number | null;
  exit?: AreaExit | null;
  size?: AreaBoundarySize;
  /**
   * The area itself. Pass a function when the area is a piece of JSX of a
   * larger component (a column of the mail view, the body of a sidebar
   * section): a boundary only catches what renders BELOW it, and an
   * expression evaluated in the parent's own render would throw past it.
   * As a function, the area is built inside the boundary.
   */
  children: ReactNode | (() => ReactNode);
  testId?: string;
}

/**
 * The one error boundary of both shells (stability plan 2026-11-10, R3).
 *
 * Before it, the only boundaries sat around the whole window (desktop
 * `main.tsx`) and the whole app (phone `main.tsx`): a render error in one
 * database view, one mail, the graph or an AI surface took everything with it,
 * the editor included. Now every tab, sidebar section, column, screen and
 * dialog that can fail on its own sits in one of these, and a failure stays
 * where it happened:
 *
 * - the fallback says in a sentence that this area could not be shown, and
 *   offers **Reload this area** — a remount from scratch under a fresh key —
 *   and, where there is one, a way out;
 * - the error goes into the diagnostics ring buffer ("About & diagnostics")
 *   with the area's name, the error's kind and first line, and the names of
 *   the components it passed — never the props, never note text;
 * - a reload that fails again does not loop: the fallback stays, says so, and
 *   no longer offers the reload; only a new `resetKey` or the way out leaves.
 *
 * What it cannot catch: errors in event handlers, in timers and in promises
 * (an effect's async work included). Those reach the window's `error` and
 * `unhandledrejection` listeners, which write the same diagnostics.
 */
export function AreaBoundary(props: AreaBoundaryProps) {
  return <AreaBoundaryState {...props} />;
}

interface State {
  resetKey: AreaBoundaryProps["resetKey"];
  error: Error | null;
  /** Reloads the person asked for since the last reset. */
  reloads: number;
  /** Bumped by a reload: the area below is a new tree, not a re-render. */
  generation: number;
  /** A dialog fallback the person closed after it failed again: nothing shows until the next reset. */
  dismissed: boolean;
}

class AreaBoundaryState extends Component<AreaBoundaryProps, State> {
  state: State = { resetKey: this.props.resetKey, error: null, reloads: 0, generation: 0, dismissed: false };

  static getDerivedStateFromProps(props: AreaBoundaryProps, state: State): Partial<State> | null {
    if (props.resetKey === state.resetKey) return null;
    if (!state.error) return { resetKey: props.resetKey, reloads: 0 };
    return { resetKey: props.resetKey, error: null, reloads: 0, generation: state.generation + 1, dismissed: false };
  }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    logDiagnostic(`area:${this.props.area}`, describeAreaError(error, info.componentStack));
    console.error(`[area ${this.props.area}] could not be shown`, error);
  }

  private reload = () => {
    this.setState((s) => ({ error: null, reloads: s.reloads + 1, generation: s.generation + 1 }));
  };

  /**
   * The X of a dialog fallback. With a way out, that is the way out. Without
   * one the dialog is a host that keeps its own open state (the cascade
   * delete, the pairing question): closing remounts it, which closes what it
   * held — unless that already failed again; then it stays away until reset.
   */
  private dismiss = () => {
    if (this.props.exit) this.props.exit.onExit();
    else if (this.state.reloads === 0) this.reload();
    else this.setState({ dismissed: true });
  };

  render() {
    const { area, children, exit, size = "pane", testId } = this.props;
    if (this.state.error) {
      if (this.state.dismissed) return null;
      return (
        <AreaFallback
          area={area}
          exit={exit ?? null}
          failedAgain={this.state.reloads > 0}
          onDismiss={this.dismiss}
          onReload={this.reload}
          size={size}
          testId={testId}
        />
      );
    }
    return (
      <Fragment key={this.state.generation}>
        {TEST_SEAM ? <AreaCrashProbe area={area} /> : null}
        {typeof children === "function" ? <RenderArea build={children} /> : children}
      </Fragment>
    );
  }
}

function RenderArea({ build }: { build: () => ReactNode }) {
  return <>{build()}</>;
}

function AreaFallback({ area, exit, failedAgain, onDismiss, onReload, size, testId }: {
  area: string;
  exit: AreaExit | null;
  failedAgain: boolean;
  onDismiss: () => void;
  onReload: () => void;
  size: AreaBoundarySize;
  testId?: string;
}) {
  const { t } = useTranslation();
  const place = t("settings.about");
  const small = size === "section";
  if (size === "strip") {
    // One line, so the bar it stands in keeps its height.
    return (
      <div
        className="pv-areafail pv-areafail--strip"
        data-area={area}
        data-failed-again={failedAgain ? "true" : undefined}
        data-testid={testId ?? "area-fallback"}
        role="alert"
      >
        <AlertCircle aria-hidden size={ICON.ui} />
        <span className="pv-areafail-line">{failedAgain ? t("errors.areaAgain", { place }) : t("errors.areaTitle")}</span>
        {!failedAgain && (
          <IconButton data-testid="area-fallback-reload" label={t("errors.areaReload")} onClick={onReload} size="sm">
            <RotateCw size={ICON.ui} />
          </IconButton>
        )}
        {exit && (
          <Button data-testid="area-fallback-exit" onClick={exit.onExit} size="sm" variant="ghost">
            {exit.label}
          </Button>
        )}
      </div>
    );
  }
  const actions = (
    <div className="pv-areafail-actions">
      {!failedAgain && (
        <Button data-testid="area-fallback-reload" onClick={onReload} size={small ? "sm" : "md"} variant="tonal">
          {t("errors.areaReload")}
        </Button>
      )}
      {exit && (
        <Button data-testid="area-fallback-exit" onClick={exit.onExit} size={small ? "sm" : "md"} variant="ghost">
          {exit.label}
        </Button>
      )}
    </div>
  );
  const body = (
    <div
      className={cx("pv-areafail", `pv-areafail--${size}`)}
      data-area={area}
      data-failed-again={failedAgain ? "true" : undefined}
      data-testid={testId ?? "area-fallback"}
      role="alert"
    >
      <EmptyState
        action={actions}
        icon={small ? undefined : <AlertCircle size={ICON.empty} />}
        title={size === "dialog" ? undefined : t("errors.areaTitle")}
      >
        {failedAgain ? t("errors.areaAgain", { place }) : t("errors.areaBody", { place })}
      </EmptyState>
    </div>
  );
  // A dialog that failed is still a dialog: the fallback takes its place on
  // the overlay layer, so the shell behind it stays as it was and Escape, the
  // X and a click beside it close it like the dialog it stands in for.
  // On the phone that layer is a sheet: the shell registers its own.
  if (size === "dialog") {
    const Sheet = hasPlatformServices() ? getPlatformServices().Sheet : undefined;
    if (Sheet) return <Sheet onClose={onDismiss} testId="area-fallback-dialog" title={t("errors.areaTitle")}>{body}</Sheet>;
    return <Modal onClose={onDismiss} testId="area-fallback-dialog" title={t("errors.areaTitle")}>{body}</Modal>;
  }
  return body;
}

/**
 * The diagnostics line of a failed area: the error's kind and the first line
 * of its message — what a developer reads — and the components it passed,
 * innermost first. Never the stack's later lines (they can quote values), the
 * props or any text of a note.
 */
export function describeAreaError(error: unknown, componentStack?: string | null): string {
  const kind = error instanceof Error ? error.name || "Error" : typeof error;
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const first = raw.split("\n", 1)[0].trim();
  const message = first.length > 160 ? `${first.slice(0, 160)}…` : first;
  const names: string[] = [];
  for (const line of (componentStack ?? "").split("\n")) {
    const match = /^ *(?:at|in) ([A-Z][\w$]*)/.exec(line);
    if (!match) continue;
    if (names[names.length - 1] !== match[1]) names.push(match[1]);
    if (names.length === 4) break;
  }
  return `${kind}${message ? `: ${message}` : ""}${names.length ? ` (in ${names.join(" < ")})` : ""}`;
}

// ---- Test seam -------------------------------------------------------------
// A real crash cannot be ordered from outside: the end-to-end runs and the
// unit tests make an area fail through this seam. It exists in the dev
// server, the test runner and the phone's e2e bundle (`vite build --mode
// e2e`), and is dead code in every build that ships.
const TEST_SEAM = import.meta.env.DEV || import.meta.env.MODE === "e2e" || import.meta.env.MODE === "test";
const CRASH_EVENT = "plainva-test-area-crash";
const crashing = new Set<string>();

/** Makes every area of that name fail until `clear` (test seam). */
export const areaCrashSeam = TEST_SEAM
  ? {
      crash(area: string) {
        crashing.add(area);
        window.dispatchEvent(new CustomEvent(CRASH_EVENT));
      },
      clear(area?: string) {
        if (area === undefined) crashing.clear();
        else crashing.delete(area);
        window.dispatchEvent(new CustomEvent(CRASH_EVENT));
      },
    }
  : null;

if (TEST_SEAM && typeof window !== "undefined") {
  (window as unknown as { __plainvaAreaCrash?: typeof areaCrashSeam }).__plainvaAreaCrash = areaCrashSeam;
}

function AreaCrashProbe({ area }: { area: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const onCrash = () => setTick((n) => n + 1);
    window.addEventListener(CRASH_EVENT, onCrash);
    return () => window.removeEventListener(CRASH_EVENT, onCrash);
  }, []);
  if (crashing.has(area)) throw new Error(`Test crash of area ${area}`);
  return null;
}
