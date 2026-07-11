/**
 * Per-vault property TYPE registry (ADR 0008).
 *
 * Obsidian itself records property *types* globally per name in
 * `.obsidian/types.json` (not options). We mirror that idea in a Plainva-local
 * store so a property a user marks as e.g. "status" stays a status across
 * reloads — WITHOUT writing anything into the note or vault (Obsidian-safe).
 *
 * Only the type name is stored here. Option sets / colors are NOT stored: they
 * come from a `.base` (curated) or are discovered from vault usage + derived
 * colors. We use localStorage (synchronous, like RightSidebar's section state)
 * rather than the async Tauri store so the panel can resolve types on render.
 */

import type { PropertyType } from "@plainva/ui";

const key = (vault: string | null) => `plainva-prop-types::${vault ?? "_"}`;

type Registry = Record<string, PropertyType>;

function read(vault: string | null): Registry {
  try {
    const raw = localStorage.getItem(key(vault));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Registry) : {};
  } catch {
    return {};
  }
}

function write(vault: string | null, reg: Registry): void {
  try {
    localStorage.setItem(key(vault), JSON.stringify(reg));
  } catch {
    /* storage unavailable — degrade to inference-only, no crash */
  }
}

/** The whole registry for a vault (property name -> chosen type). */
export function loadPropertyTypes(vault: string | null): Registry {
  return read(vault);
}

/** Remember the explicit type a user picked for a property name. */
export function setPropertyType(vault: string | null, name: string, type: PropertyType): void {
  const reg = read(vault);
  reg[name] = type;
  write(vault, reg);
}

/** Forget an explicit type (e.g. when the property is deleted). */
export function clearPropertyType(vault: string | null, name: string): void {
  const reg = read(vault);
  if (name in reg) {
    delete reg[name];
    write(vault, reg);
  }
}

/** Follow a rename so the type sticks to the new name. */
export function renamePropertyType(vault: string | null, oldName: string, newName: string): void {
  const reg = read(vault);
  if (oldName in reg) {
    reg[newName] = reg[oldName];
    delete reg[oldName];
    write(vault, reg);
  }
}
