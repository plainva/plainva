import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  publishedSliceProviderInstructions,
  type PublishedProjectionPreview,
  type PublishedSliceMode,
  type PublishedSliceProvider,
} from "@plainva/core";
import { Banner, Button, publicationInstructionText, Segmented, TextInput } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { mSelect } from "../services/mobileDialogs";

/**
 * Publishing a Vault Slice from the phone (M3) — the mobile shape of the
 * desktop's publish card.
 *
 * Collects values only; the publication itself is created by the caller, so a
 * failure surfaces here and the sheet stays open with what was typed.
 *
 * There is deliberately no "keep this private" option: a sheet titled "publish"
 * whose third choice is "do not publish" asks the same question twice. Closing
 * it leaves the slice internal, which is what private means.
 */

/** Brand names, not translatable strings — identical in all ten languages. */
const PROVIDER_NAMES: Record<PublishedSliceProvider, string> = {
  "google-drive": "Google Drive",
  onedrive: "OneDrive",
  nextcloud: "Nextcloud",
  dropbox: "Dropbox",
  webdav: "WebDAV",
  s3: "S3",
};

const PROVIDERS = Object.keys(PROVIDER_NAMES) as PublishedSliceProvider[];

export type PublishSliceValues = {
  name: string;
  mode: "exact" | "sanitized";
  access: "read" | "comment" | "suggest";
  provider: PublishedSliceProvider;
};

export function PublishSliceSheet({
  sliceName,
  onClose,
  onPreview,
  onSubmit,
}: {
  /** Prefills the publication name — recipients recognise the slice, not an id. */
  sliceName: string;
  onClose: () => void;
  /** Reads the covered notes and projects them — asked, never automatic (M4). */
  onPreview: (mode: PublishedSliceMode) => Promise<PublishedProjectionPreview>;
  onSubmit: (values: PublishSliceValues) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(sliceName);
  const [mode, setMode] = useState<"exact" | "sanitized">("sanitized");
  const [access, setAccess] = useState<"read" | "comment" | "suggest">("read");
  const [provider, setProvider] = useState<PublishedSliceProvider>("google-drive");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ mode: PublishedSliceMode; data: PublishedProjectionPreview } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const valid = name.trim().length > 0;

  /* Derived rather than cleared in an effect: an answer computed for the other
     mode is not this mode's answer, and a count that outlives the rule it was
     computed for is worse than no count. */
  const shown = preview && preview.mode === mode ? preview.data : null;

  const runPreview = () => {
    if (previewBusy) return;
    setPreviewBusy(true);
    setError(null);
    void onPreview(mode)
      .then((data) => setPreview({ mode, data }))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setPreviewBusy(false));
  };

  const submit = () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    void onSubmit({ name: name.trim(), mode, access, provider }).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    });
  };

  const pickAccess = () => {
    void (async () => {
      const picked = await mSelect({
        title: t("workspaceSecurity.access", { defaultValue: "Access" }),
        options: (["read", "comment", "suggest"] as const).map((value) => ({
          value,
          label: t(`workspaceSecurity.publicationAccessName.${value}`, { defaultValue: value }),
        })),
        value: access,
      });
      if (picked !== null) setAccess(picked as "read" | "comment" | "suggest");
    })();
  };

  const pickProvider = () => {
    void (async () => {
      const picked = await mSelect({
        title: t("workspaceSecurity.provider", { defaultValue: "Provider" }),
        options: PROVIDERS.map((value) => ({ value, label: PROVIDER_NAMES[value] })),
        value: provider,
      });
      if (picked !== null) setProvider(picked as PublishedSliceProvider);
    })();
  };

  // The same advice the desktop shows, from the same shared source: what to set
  // at the provider so its permissions back the encryption up instead of
  // contradicting it.
  const advice = publishedSliceProviderInstructions({ provider, access })
    .map((instruction) => publicationInstructionText(instruction, t))
    .join(" ");

  return (
    <div className="m-sheet-backdrop m-sheet-backdrop--dialog" onClick={onClose}>
      <div className="pv-sheet m-sheet" data-testid="publish-slice-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("workspaceSecurity.publishSlice", { defaultValue: "Publish a Vault Slice" })}</p>
        <p className="m-hint">
          {t("workspaceSecurity.publicationCreateHint", {
            defaultValue:
              "The publication becomes its own workspace with its own keys, in a folder that reveals nothing about this vault.",
          })}
        </p>

        <label className="m-field">
          <span>{t("workspaceSecurity.sliceLabel", { defaultValue: "Vault Slice" })}</span>
          <TextInput
            data-testid="publish-slice-name"
            onChange={(e) => setName(e.target.value)}
            value={name}
          />
        </label>

        <p className="m-sectionlabel">{t("workspaceSecurity.publicationMode", { defaultValue: "Publication" })}</p>
        <Segmented
          ariaLabel={t("workspaceSecurity.publicationMode", { defaultValue: "Publication" })}
          options={(["exact", "sanitized"] as const).map((value) => ({
            value,
            label: t(`workspaceSecurity.publicationModeName.${value}`, { defaultValue: value }),
            testId: `publish-mode-${value}`,
          }))}
          value={mode}
          onChange={(v) => setMode(v as "exact" | "sanitized")}
        />
        {/* Once a preview exists, `unchanged` decides the wording, not the mode:
            a sanitized publication that happens to remove nothing should say so
            rather than promise a cleanup it did not perform. */}
        <p className="m-hint">
          {(shown ? shown.unchanged : mode === "exact")
            ? t("workspaceSecurity.projectionExactHint", {
                defaultValue: "An exact publication hands the notes out as they are - nothing is removed.",
              })
            : t("workspaceSecurity.projectionSanitizedHint", {
                defaultValue: "This leaves the vault. Everything counted here is removed from the published copy.",
              })}
        </p>

        {/* Explicit, because it reads every covered note. The desktop asks on its
            own review step; the sheet has no steps, so the button is the step. */}
        <Button variant="tonal" disabled={busy || previewBusy} data-testid="publish-preview" onClick={runPreview}>
          {previewBusy ? <span className="m-actionspin" aria-hidden /> : null}
          {t("workspaceSecurity.preview", { defaultValue: "Preview" })}
        </Button>
        {previewBusy && !shown && (
          <p className="m-hint">
            {t("workspaceSecurity.projectionLoading", {
              defaultValue: "Reading the covered notes to show what would leave the vault.",
            })}
          </p>
        )}
        {shown && (
          <div className="m-publish-preview" data-testid="publish-preview-result">
            <p className="m-sectionlabel">{t("workspaceSecurity.previewCount", { count: shown.objectCount })}</p>
            {!shown.unchanged && (
              <>
                <div className="m-row m-row--static">
                  <span>{t("workspaceSecurity.projectionRemovedProperties", { defaultValue: "Properties removed" })}</span>
                  <span>{shown.removedProperties.length}</span>
                </div>
                <div className="m-row m-row--static">
                  <span>{t("workspaceSecurity.projectionNeutralizedLinks", { defaultValue: "Links neutralized" })}</span>
                  <span>{shown.neutralizedLinks.length}</span>
                </div>
                <div className="m-row m-row--static">
                  <span>{t("workspaceSecurity.projectionRemovedEmbeds", { defaultValue: "Embeds omitted" })}</span>
                  <span>{shown.removedEmbeds.length}</span>
                </div>
              </>
            )}
            {shown.sample && (
              <>
                <p className="m-hint">{shown.sample.path}</p>
                <p className="m-sectionlabel">{t("workspaceSecurity.projectionBefore", { defaultValue: "In the vault" })}</p>
                <pre className="m-publish-sample"><code>{shown.sample.before}</code></pre>
                <p className="m-sectionlabel">{t("workspaceSecurity.projectionAfter", { defaultValue: "Handed out" })}</p>
                <pre className="m-publish-sample"><code>{shown.sample.after}</code></pre>
              </>
            )}
          </div>
        )}

        <button className="m-row" data-testid="publish-access" onClick={pickAccess}>
          <span>{t("workspaceSecurity.access", { defaultValue: "Access" })}</span>
          <span>{t(`workspaceSecurity.publicationAccessName.${access}`, { defaultValue: access })}</span>
        </button>
        <button className="m-row" data-testid="publish-provider" onClick={pickProvider}>
          <span>{t("workspaceSecurity.provider", { defaultValue: "Provider" })}</span>
          <span>{PROVIDER_NAMES[provider]}</span>
        </button>
        <p className="m-hint">{advice}</p>
        <p className="m-hint">
          {t("workspaceSecurity.providerAclHint", {
            defaultValue: "Provider permissions are a second lock. The encryption stays authoritative.",
          })}
        </p>

        {error && (
          <Banner kind="error" rounded>
            {error}
          </Banner>
        )}

        <div className="m-btnrow">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            data-testid="publish-slice-submit"
            disabled={!valid || busy}
            onClick={submit}
          >
            {t("workspaceSecurity.createPublication", { defaultValue: "Create publication" })}
          </Button>
        </div>
      </div>
    </div>
  );
}
