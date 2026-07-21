import { useTranslation } from "react-i18next";
import { Check, CopyPlus, FilePlus2, Mail, Palette, Pencil, Trash2 } from "lucide-react";
import { EVENT_COLOR_PALETTE, ICON, MenuItem, MenuLabel, MenuSeparator, MenuSurface } from "@plainva/ui";
import type { PimEventRow } from "@plainva/core";

/**
 * Right-click context menu for a calendar event (quick actions without opening
 * the full dialog). Mirrors the event dialog's ⋮ actions and adds two inline
 * quick-sets requested by the maintainer: a colour swatch row (writable single
 * events) and RSVP accept/tentative/decline (only when the user is an invitee).
 * Colours come from the shared EVENT_COLOR_PALETTE (runtime data, not literals),
 * so the swatch backgrounds stay designLint-clean.
 */
export interface EventContextMenuProps {
  event: PimEventRow;
  at: { x: number; y: number };
  onClose: () => void;
  onEdit: () => void;
  onMeetingNote: () => void;
  onEmailInvite: () => void;
  onDelete: () => void;
  /** Quick colour set (writable single events only); undefined hides the row. */
  onSetColor?: (hex: string) => void;
  /** RSVP (only when the user is an invitee); undefined hides the row. */
  onRespond?: (response: "accepted" | "declined" | "tentative") => void;
  /** Mirror into other calendars (only when another writable calendar exists). */
  onBlock?: () => void;
}

export function EventContextMenu({
  event,
  at,
  onClose,
  onEdit,
  onMeetingNote,
  onEmailInvite,
  onDelete,
  onSetColor,
  onRespond,
  onBlock,
}: EventContextMenuProps) {
  const { t } = useTranslation();
  const activeColor = (event.color ?? "").toLowerCase();
  return (
    <MenuSurface open at={at} onClose={onClose} ariaLabel={t("pim.eventActions", { defaultValue: "Termin-Aktionen" })}>
      <MenuItem icon={<Pencil size={ICON.ui} />} data-testid="ctx-edit" onSelect={onEdit}>
        {t("pim.editEvent", { defaultValue: "Termin bearbeiten" })}
      </MenuItem>
      <MenuItem icon={<FilePlus2 size={ICON.ui} />} data-testid="ctx-meeting-note" onSelect={onMeetingNote}>
        {t("pim.meetingNote", { defaultValue: "Meeting-Notiz" })}
      </MenuItem>

      {onSetColor && (
        <>
          <MenuLabel>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Palette size={ICON.meta} />
              {t("pim.eventColor", { defaultValue: "Farbe" })}
            </span>
          </MenuLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 10px 6px" }} data-testid="ctx-colors">
            <button
              type="button"
              onClick={() => { onSetColor(""); onClose(); }}
              data-testid="ctx-color-default"
              aria-label={t("pim.eventColorDefault", { defaultValue: "Kalenderfarbe" })}
              data-tip={t("pim.eventColorDefault", { defaultValue: "Kalenderfarbe" })}
              style={{
                width: 20,
                height: 20,
                borderRadius: "var(--radius-pill)",
                background: "var(--bg-secondary)",
                cursor: "pointer",
                border: !activeColor ? "2px solid var(--accent-color)" : "1px solid var(--border-color)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "var(--text-xs)",
                color: "var(--text-muted)",
              }}
            >
              ✕
            </button>
            {EVENT_COLOR_PALETTE.map((hex) => {
              const active = activeColor === hex;
              return (
                <button
                  key={hex}
                  type="button"
                  onClick={() => { onSetColor(hex); onClose(); }}
                  data-testid={`ctx-color-${hex}`}
                  aria-label={hex}
                  data-tip={hex}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "var(--radius-pill)",
                    background: hex,
                    cursor: "pointer",
                    border: active ? "2px solid var(--text-main)" : "1px solid var(--border-color-light)",
                  }}
                />
              );
            })}
          </div>
        </>
      )}

      {onRespond && (
        <>
          <MenuLabel>{t("pim.rsvpMenu", { defaultValue: "Zu-/Absagen" })}</MenuLabel>
          <MenuItem icon={<Check size={ICON.ui} />} data-testid="ctx-rsvp-accept" onSelect={() => onRespond("accepted")}>
            {t("pim.rsvpAccept", { defaultValue: "Zusagen" })}
          </MenuItem>
          <MenuItem data-testid="ctx-rsvp-tentative" onSelect={() => onRespond("tentative")}>
            {t("pim.rsvpTentative", { defaultValue: "Vorläufig" })}
          </MenuItem>
          <MenuItem data-testid="ctx-rsvp-decline" onSelect={() => onRespond("declined")}>
            {t("pim.rsvpDecline", { defaultValue: "Absagen" })}
          </MenuItem>
        </>
      )}

      <MenuSeparator />
      <MenuItem icon={<Mail size={ICON.ui} />} data-testid="ctx-email-invite" onSelect={onEmailInvite}>
        {t("pim.emailInvite", { defaultValue: "Per Mail versenden" })}
      </MenuItem>
      {onBlock && (
        <MenuItem icon={<CopyPlus size={ICON.ui} />} data-testid="ctx-block" onSelect={onBlock}>
          {t("pim.blockInCalendars", { defaultValue: "In anderen Kalendern blockieren" })}
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem icon={<Trash2 size={ICON.ui} />} danger data-testid="ctx-delete" onSelect={onDelete}>
        {t("pim.deleteEvent", { defaultValue: "Termin löschen" })}
      </MenuItem>
    </MenuSurface>
  );
}
