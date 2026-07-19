import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cx } from "./cx";

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
