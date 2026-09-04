import React from "react";
import { useTranslation } from "react-i18next";
import { MenuItem, MenuLabel, MenuSeparator, MenuSurface, type BlockAction, type BlockTarget } from "@plainva/ui";

export type { BlockAction } from "@plainva/ui";

interface Props {
  x: number;
  y: number;
  onAction: (action: BlockAction) => void;
  onClose: () => void;
}

/**
 * Notion-style block menu opened from a block's drag handle (#7): convert the
 * block, duplicate / move / delete it.
 *
 * On the shared menu primitive since the Design-Runde (E5, 2026-09-04): it
 * was the one menu on the desktop that drew itself — its own rows, its own
 * hover, its own outside-click and Escape, its own clamp against the window.
 * `MenuSurface` does all of that for every other menu, and the grammar guard
 * (`interactionGrammar.test.ts`) now refuses a hand-built `role="menu"`.
 */
export const BlockMenu: React.FC<Props> = ({ x, y, onAction, onClose }) => {
  const { t } = useTranslation();
  const turn = (target: BlockTarget, label: string) => (
    <MenuItem key={target} onSelect={() => onAction({ kind: "turn", target })}>
      {label}
    </MenuItem>
  );
  return (
    <MenuSurface open at={{ x, y }} onClose={onClose} minWidth={220} ariaLabel={t("block.menuTitle", { defaultValue: "Block-Aktionen" })}>
      <MenuLabel>{t("block.turnInto", { defaultValue: "Umwandeln in" })}</MenuLabel>
      {turn("paragraph", t("block.paragraph", { defaultValue: "Text" }))}
      {turn("h1", t("block.h1", { defaultValue: "Überschrift 1" }))}
      {turn("h2", t("block.h2", { defaultValue: "Überschrift 2" }))}
      {turn("h3", t("block.h3", { defaultValue: "Überschrift 3" }))}
      {turn("bullet", t("block.bullet", { defaultValue: "Aufzählung" }))}
      {turn("numbered", t("block.numbered", { defaultValue: "Nummerierte Liste" }))}
      {turn("task", t("block.task", { defaultValue: "Aufgabe" }))}
      {turn("quote", t("block.quote", { defaultValue: "Zitat" }))}
      {turn("code", t("block.code", { defaultValue: "Code-Block" }))}
      <MenuSeparator />
      <MenuItem onSelect={() => onAction({ kind: "duplicate" })}>{t("block.duplicate", { defaultValue: "Duplizieren" })}</MenuItem>
      <MenuItem onSelect={() => onAction({ kind: "move-up" })}>{t("block.moveUp", { defaultValue: "Nach oben" })}</MenuItem>
      <MenuItem onSelect={() => onAction({ kind: "move-down" })}>{t("block.moveDown", { defaultValue: "Nach unten" })}</MenuItem>
      <MenuSeparator />
      <MenuItem danger onSelect={() => onAction({ kind: "delete" })}>{t("block.delete", { defaultValue: "Block löschen" })}</MenuItem>
    </MenuSurface>
  );
};
