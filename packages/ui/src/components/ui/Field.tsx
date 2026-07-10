import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cx } from "./cx";

/**
 * Form fields (plan Designsprache P2): one height (--control-md), one radius
 * (sm), one focus treatment (accent border + the global :focus-visible ring).
 * Native elements stay native — these wrappers only pin the shared classes.
 */

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...rest }, ref) {
    return <input ref={ref} className={cx("pv-field", className)} {...rest} />;
  }
);

export const SelectField = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function SelectField({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cx("pv-field", "pv-field--select", className)} {...rest}>
        {children}
      </select>
    );
  }
);

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cx("pv-field", "pv-field--area", className)} {...rest} />;
  }
);
