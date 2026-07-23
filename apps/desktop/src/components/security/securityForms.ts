import type { TFunction } from "i18next";
import type { SelectOption } from "@plainva/ui";
import type { useVault } from "../../contexts/VaultContext";

/** Shared shape of the governance dialog form + the types derived from the
 * vault control plane, extracted so the page, the dialog and the wizard can be
 * split into separate files (plan Security & Sharing, package B3). */
export type Diagnostics = Awaited<ReturnType<ReturnType<typeof useVault>["getWorkspaceDiagnostics"]>>;
export type Governance = Awaited<ReturnType<ReturnType<typeof useVault>["getWorkspaceGovernance"]>>;

export type WorkspaceRole = "Owner" | "Admin" | "Editor" | "Commenter" | "Reader" | "Contributor";
export const WORKSPACE_ROLES: readonly WorkspaceRole[] = ["Owner", "Admin", "Editor", "Commenter", "Reader", "Contributor"];

/** Publication target providers. Brand names, not localized. */
export const PUBLICATION_PROVIDERS = ["google-drive", "onedrive", "nextcloud", "dropbox", "webdav", "s3"] as const;
const PROVIDER_LABELS: Record<(typeof PUBLICATION_PROVIDERS)[number], string> = {
  "google-drive": "Google Drive",
  onedrive: "OneDrive",
  nextcloud: "Nextcloud",
  dropbox: "Dropbox",
  webdav: "WebDAV",
  s3: "S3",
};

export type GovernanceForm = {
  code: string; name: string; role: string; members: string; scopeKind: string; scopeId: string; sliceKind: string; definition: string;
  publicationMode: string; publicationAccess: string; publicationProvider: string;
  recoveryCode: string; deviceName: string; recoveryFile: string; fallbackPassphrase: string;
};

export function parseSliceForm(form: GovernanceForm) {
  return form.sliceKind === "folder"
    ? { kind: "folder" as const, folder: form.definition }
    : form.sliceKind === "selection"
      ? { kind: "selection" as const, objectIds: form.definition.split(",").map((value) => value.trim()).filter(Boolean) }
      : { kind: "dynamic" as const, definition: JSON.parse(form.definition) as { all: Array<{ field: "path"; operator: "startsWith"; value: string }> } };
}

/** Localized role options WITH a one-line capability description (Mockup 3).
 * The `value` stays the exact backend capability string. */
export function roleOptions(t: TFunction): SelectOption<WorkspaceRole>[] {
  return WORKSPACE_ROLES.map((role) => ({
    value: role,
    label: t(`workspaceSecurity.role.${role}`, { defaultValue: role }),
    description: t(`workspaceSecurity.roleDesc.${role}`, { defaultValue: "" }) || undefined,
  }));
}

export function providerOptions(): SelectOption[] {
  return PUBLICATION_PROVIDERS.map((value) => ({ value, label: PROVIDER_LABELS[value] }));
}
