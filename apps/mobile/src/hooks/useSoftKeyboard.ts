import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";

/**
 * Reports whether the soft keyboard is up, so the shell can drop the bottom
 * navigation and the FAB out of the way while someone types.
 *
 * Extracted from App.tsx: it is a platform concern with its own teardown, and
 * App.tsx is under a shrinking line budget that exists precisely to keep blocks
 * like this one out of the shell.
 */
export function useSoftKeyboard(onChange: (open: boolean) => void): void {
  useEffect(() => {
    // Whenever the shell has a keyboard plugin: the native apps always do, a
    // browser does not - unless a production test stands one in
    // (e2e-prod/note-tuck.spec.ts), which is how the tucked bar gets tested.
    if (!Capacitor.isPluginAvailable("Keyboard")) return;
    let showHandle: { remove: () => Promise<void> } | undefined;
    let hideHandle: { remove: () => Promise<void> } | undefined;

    void Keyboard.addListener("keyboardWillShow", () => onChange(true)).then((h) => {
      showHandle = h;
    });
    void Keyboard.addListener("keyboardWillHide", () => onChange(false)).then((h) => {
      hideHandle = h;
    });

    return () => {
      if (showHandle) void showHandle.remove();
      if (hideHandle) void hideHandle.remove();
    };
  }, [onChange]);
}
