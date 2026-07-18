import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Button, Checkbox } from "@plainva/ui";

/**
 * "Block in other calendars" dialog (calendar #1, Notion-Calendar style): pick
 * one or more OTHER writable calendars and mirror the event into each — either
 * as an opaque "Busy" placeholder or with full details. Series are mirrored
 * with their recurrence (handled by the caller). The dialog only collects the
 * choice; the writes are the caller's job.
 */

interface BlockCalendarsModalProps {
  eventTitle: string;
  /** The OTHER writable calendars (never the event's own). */
  calendars: Array<{ value: string; label: string }>;
  isSeries: boolean;
  onConfirm: (selected: string[], mode: "busy" | "details") => void;
  onCancel: () => void;
}

export function BlockCalendarsModal({ eventTitle, calendars, isSeries, onConfirm, onCancel }: BlockCalendarsModalProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"busy" | "details">("busy");
  const [busy, setBusy] = useState(false);

  const toggle = (value: string) =>
    setSelected((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));

  return (
    <Modal
      title={t("pim.blockInCalendars", { defaultValue: "In anderen Kalendern blockieren" })}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel", { defaultValue: "Abbrechen" })}
          </Button>
          <Button
            variant="primary"
            data-testid="block-confirm"
            disabled={busy || selected.length === 0}
            onClick={() => { setBusy(true); onConfirm(selected, mode); }}
          >
            {t("pim.blockCreate", { defaultValue: "Blockieren" })}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }} data-testid="block-form">
        <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
          {t("pim.blockHint", { defaultValue: "„{{title}}“ in weitere Kalender als Blocker übernehmen.", title: eventTitle })}
          {isSeries ? " " + t("pim.blockSeriesHint", { defaultValue: "Die Wiederholung wird mitübernommen." }) : ""}
        </p>
        {calendars.length === 0 ? (
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
            {t("pim.blockNoOther", { defaultValue: "Kein weiterer beschreibbarer Kalender vorhanden." })}
          </p>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflow: "auto" }}>
              {calendars.map((c) => (
                <Checkbox
                  key={c.value}
                  checked={selected.includes(c.value)}
                  onChange={() => toggle(c.value)}
                  data-testid="block-calendar"
                >
                  {c.label}
                </Checkbox>
              ))}
            </div>
            <div>
              <label style={{ display: "block", fontSize: "var(--text-sm)", marginBottom: 4 }}>
                {t("pim.blockMode", { defaultValue: "Als" })}
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                <Button size="sm" variant={mode === "busy" ? "primary" : "ghost"} data-testid="block-mode-busy" onClick={() => setMode("busy")}>
                  {t("pim.blockBusy", { defaultValue: "Beschäftigt" })}
                </Button>
                <Button size="sm" variant={mode === "details" ? "primary" : "ghost"} data-testid="block-mode-details" onClick={() => setMode("details")}>
                  {t("pim.blockDetails", { defaultValue: "Mit Details" })}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
