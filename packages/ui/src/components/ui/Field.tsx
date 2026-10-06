import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cx } from "./cx";
import { fitFieldHeight } from "../../lib/growingField";
import { useSpellcheck, type WritingPurpose } from "../../lib/spellcheck";

/**
 * Form fields (plan Designsprache P2; metric roles sweep 2026-07-19, E10):
 * the FORM standard is --control-lg with a --space-3 inset; `compact` opts a
 * field into the dense --control-md role (toolbars, sidebar search, inline
 * cell editors). One radius (md), one focus treatment. Native elements stay
 * native — these wrappers only pin the shared classes.
 */

interface FieldRole {
  /** Dense chrome contexts only (toolbars, sidebar search, inline cells). */
  compact?: boolean;
}

/**
 * What the field holds, for the spell-checking rule (lib/spellcheck.ts). The
 * primitives own the `spellcheck` attribute - a call site names the purpose and
 * never sets the attribute itself, which is why `spellCheck` is not accepted.
 * A multi-line field holds prose unless it says otherwise; a one-line field
 * holds a name, an address or a number unless it says it holds prose.
 */
interface FieldPurpose {
  purpose?: WritingPurpose;
}

export const TextInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "spellCheck"> & FieldRole & FieldPurpose
>(function TextInput({ className, compact, purpose = "name", ...rest }, ref) {
  const spellCheck = useSpellcheck(purpose);
  return (
    <input ref={ref} className={cx("pv-field", compact && "pv-field--compact", className)} spellCheck={spellCheck} {...rest} />
  );
});

export const SelectField = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & FieldRole
>(function SelectField({ className, compact, children, ...rest }, ref) {
  return (
    <select
      ref={ref}
      className={cx("pv-field", "pv-field--select", compact && "pv-field--compact", className)}
      {...rest}
    >
      {children}
    </select>
  );
});

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "spellCheck"> & FieldRole & FieldPurpose
>(function TextArea({ className, compact, purpose = "prose", ...rest }, ref) {
  const spellCheck = useSpellcheck(purpose);
  return (
    <textarea
      ref={ref}
      className={cx("pv-field", "pv-field--area", compact && "pv-field--compact", className)}
      spellCheck={spellCheck}
      {...rest}
    />
  );
});

/**
 * A one-value field that is as tall as its text (issue 118): it starts at one
 * line, wraps at its own width and grows with what is typed. For inline cell
 * editors, where a long value has to stay readable while it is changed. It has
 * no resize handle and no scrollbar — the text decides the height.
 */
export const GrowingField = forwardRef<
  HTMLTextAreaElement,
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "spellCheck"> & FieldPurpose
>(function GrowingField({ className, value, purpose = "prose", ...rest }, ref) {
  const spellCheck = useSpellcheck(purpose);
  const field = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => field.current as HTMLTextAreaElement, []);
  // After every change of the text, before paint: the field never shows a
  // frame at the wrong height.
  useLayoutEffect(() => {
    if (field.current) fitFieldHeight(field.current);
  }, [value]);
  // ... and after every change of its WIDTH: the text wraps differently in a
  // column that was dragged narrower, and the height has to follow. A cell
  // editor lives for one edit and never saw its width change; a property value
  // in the context column stands in this field for as long as the note is open
  // (plan Befunde 2026-10-06, R2). Setting the height does not change the
  // width, so the observer cannot feed itself.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fitFieldHeight(el);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return <textarea ref={field} rows={1} className={cx("pv-field", "pv-field--compact", "pv-field--grow", className)} value={value} spellCheck={spellCheck} {...rest} />;
});
