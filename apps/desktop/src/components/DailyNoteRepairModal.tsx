import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Wrench } from "lucide-react";
import { Button, Checkbox, ICON, Modal } from "@plainva/ui";
import { useVault } from "../contexts/VaultContext";
import { applyIndexChanges } from "../services/fileActions";
import {
  repairDailyNotes,
  scanInheritedTemplateMarkers,
  type AffectedDailyNote,
} from "../services/dailyNoteRepair";

/**
 * TEMPORARY — remove together with `services/dailyNoteRepair.ts` by 2026-11-01
 * (plan Vorlagen-Engine E4, Sammelplan C13).
 *
 * Offers to clean daily notes that inherited a template's `plainva.tasks:
 * false` (their tasks are invisible in the Tasks view) or its `templateFor`
 * back when the desktop daily path bypassed the shared template engine.
 * Everything is shown before anything is written, and every note can be
 * deselected — hiding a note's tasks CAN be a deliberate choice.
 */
export const DailyNoteRepairModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation();
  const { vaultAdapter, vaultPath, indexer, triggerFileTreeUpdate } = useVault();

  const [notes, setNotes] = useState<AffectedDailyNote[] | null>(null);
  const [scanned, setScanned] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ repaired: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!vaultAdapter || !vaultPath) return;
    const controller = new AbortController();
    abortRef.current = controller;
    scanInheritedTemplateMarkers({
      adapter: vaultAdapter,
      vaultPath,
      signal: controller.signal,
      onProgress: setScanned,
    })
      .then((found) => {
        setNotes(found);
        setSelected(new Set(found.map((f) => f.path)));
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setNotes([]);
      });
    return () => controller.abort();
  }, [vaultAdapter, vaultPath]);

  const when = useMemo(() => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }), []);

  const toggle = (path: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const run = async () => {
    if (!vaultAdapter || !notes) return;
    const chosen = notes.filter((n) => selected.has(n.path));
    if (chosen.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      // The full adapter chain: every rewrite gets a snapshot and joins the
      // sync queue like a normal edit.
      const result = await repairDailyNotes({ adapter: vaultAdapter, notes: chosen });
      if (indexer && result.repaired.length > 0) {
        // Targeted re-index of exactly the rewritten notes (Issue #9 rule).
        await applyIndexChanges(indexer, { added: result.repaired });
      }
      if (result.repaired.length > 0) triggerFileTreeUpdate?.(result.repaired);
      setDone({ repaired: result.repaired.length, failed: result.failed.length });
      setNotes((prev) => (prev ?? []).filter((n) => !result.repaired.includes(n.path)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const markerLabel = (n: AffectedDailyNote) =>
    n.markers
      .map((m) =>
        m === "tasks"
          ? t("dailyRepair.markerTasks", { defaultValue: "Aufgaben ausgeblendet" })
          : t("dailyRepair.markerTemplateFor", { defaultValue: "als Vorlage geführt" })
      )
      .join(" · ");

  return (
    <Modal
      onClose={() => { if (!busy) onClose(); }}
      title={t("dailyRepair.title", { defaultValue: "Tagesnotizen prüfen" })}
      size="lg"
      testId="daily-repair-modal"
      closeOnOverlay={!busy}
    >
      <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginBottom: "var(--space-3)" }}>
        {t("dailyRepair.hint", {
          defaultValue:
            "Ältere Tagesnotizen können Angaben aus ihrer Vorlage geerbt haben, die dort nicht hingehören — vor allem „Aufgaben ausgeblendet“, wodurch ihre Aufgaben in der Aufgabenübersicht fehlen. Hier siehst Du die betroffenen Notizen, bevor etwas geändert wird.",
        })}
      </div>

      {error && (
        <div style={{ marginBottom: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--error-text)" }}>{error}</div>
      )}
      {done && (
        <div style={{ marginBottom: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--success-text)" }}>
          {t("dailyRepair.done", { defaultValue: "Repariert: {{repaired}}", repaired: done.repaired })}
          {done.failed > 0 && ` · ${t("dailyRepair.doneFailed", { defaultValue: "fehlgeschlagen: {{failed}}", failed: done.failed })}`}
        </div>
      )}

      {notes === null && (
        <div style={{ padding: "var(--space-5)", textAlign: "center", color: "var(--text-muted)", fontSize: "var(--text-md)" }}>
          {t("dailyRepair.scanning", { defaultValue: "Suche läuft… ({{scanned}} geprüft)", scanned })}
        </div>
      )}
      {notes !== null && notes.length === 0 && (
        <div style={{ padding: "var(--space-5)", textAlign: "center", color: "var(--text-muted)", fontSize: "var(--text-md)" }} data-testid="daily-repair-empty">
          {t("dailyRepair.empty", { defaultValue: "Keine betroffenen Tagesnotizen gefunden." })}
        </div>
      )}

      {(notes ?? []).map((note) => (
        <div
          key={note.path}
          data-testid="daily-repair-row"
          style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) 0", borderBottom: "1px solid var(--border-color-light, var(--border-color))" }}
        >
          <Checkbox checked={selected.has(note.path)} disabled={busy} onChange={() => toggle(note.path)} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "var(--text-md)" }} data-tip={note.path}>
              {when.format(note.date)}
            </div>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{markerLabel(note)}</div>
          </div>
        </div>
      ))}

      {notes !== null && notes.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel", { defaultValue: "Abbrechen" })}
          </Button>
          <Button
            variant="primary"
            icon={<Wrench size={ICON.ui} />}
            data-testid="daily-repair-run"
            onClick={run}
            disabled={busy || selected.size === 0}
          >
            {busy
              ? t("dailyRepair.running", { defaultValue: "Wird repariert…" })
              : t("dailyRepair.repair", { defaultValue: "Ausgewählte reparieren ({{n}})", n: selected.size })}
          </Button>
        </div>
      )}
    </Modal>
  );
};
