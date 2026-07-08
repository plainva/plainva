/**
 * Version-restore handshake, editor side effects live in Editor.tsx
 * (Gesamtplan Backups & Versionierung 2026-07-05, P5).
 *
 * Asks any editor holding `path` to write its pending debounced save NOW and
 * resolves once the editor acks (or after `timeoutMs` when no editor has the
 * file open — there is no registry of open editors, so absence is detected by
 * silence). Without this, a pending 1-s save timer would overwrite a restore
 * one second later with stale text.
 */
export function requestSaveFlush(path: string, timeoutMs = 1200): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener("plainva-pending-save-flushed", onAck);
      if (timer !== undefined) clearTimeout(timer);
      resolve();
    };
    const onAck = (e: Event) => {
      if ((e as CustomEvent<{ path?: string }>).detail?.path === path) finish();
    };
    window.addEventListener("plainva-pending-save-flushed", onAck);
    timer = setTimeout(finish, timeoutMs);
    window.dispatchEvent(new CustomEvent("plainva-flush-pending-save", { detail: { path } }));
  });
}
