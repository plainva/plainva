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

export const TextInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & FieldRole
>(function TextInput({ className, compact, ...rest }, ref) {
  return (
    <input ref={ref} className={cx("pv-field", compact && "pv-field--compact", className)} {...rest} />
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
  TextareaHTMLAttributes<HTMLTextAreaElement> & FieldRole
>(function TextArea({ className, compact, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cx("pv-field", "pv-field--area", compact && "pv-field--compact", className)}
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
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function GrowingField({ className, value, ...rest }, ref) {
  const field = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => field.current as HTMLTextAreaElement, []);
  // After every change of the text, before paint: the field never shows a
  // frame at the wrong height.
  useLayoutEffect(() => {
    if (field.current) fitFieldHeight(field.current);
  }, [value]);
  return <textarea ref={field} rows={1} className={cx("pv-field", "pv-field--compact", "pv-field--grow", className)} value={value} {...rest} />;
});
