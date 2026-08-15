import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Share2 } from "lucide-react";
import { Button, ICON, imageMimeType, toast } from "@plainva/ui";
import { AppBar } from "../components/AppBar";
import { shareVaultFile } from "../services/shareFile";
import type { MobileVault } from "../services/vaultService";

/**
 * The image viewer (S42).
 *
 * An attachment was invisible on the phone: the navigator listed notes and
 * databases only, so a photo you had just inserted could not be looked at
 * again. This is the smallest thing that fixes that honestly — the picture at
 * full width, its name, and a way to hand it to another app.
 *
 * Deliberately NOT the desktop's editor (crop, rotate, draw). That is a canvas
 * pipeline with an undo stack; offering a cut-down version of it would invite
 * edits the phone cannot finish. Viewing is the gap; editing is a decision for
 * its own step.
 */
export function ImageViewerScreen({
  vault,
  path,
  onBack,
}: {
  vault: MobileVault;
  path: string;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const name = path.split("/").pop() ?? path;

  useEffect(() => {
    let objectUrl: string | null = null;
    let stale = false;
    void (async () => {
      try {
        const bytes = await vault.files.readBinaryFile(path);
        if (stale) return;
        objectUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: imageMimeType(path) }));
        setUrl(objectUrl);
      } catch {
        if (!stale) setFailed(true);
      }
    })();
    return () => {
      stale = true;
      // The blob outlives the component otherwise, and a gallery of large
      // photos would hold every one of them for the session.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [vault, path]);

  return (
    <div className="m-page m-page--viewer">
      <AppBar onBack={onBack} title={name} />
      {failed ? (
        <p className="m-hint">{t("mobile.noteMissing")}</p>
      ) : (
        url && <img alt={name} className="m-viewerimg" src={url} />
      )}
      <div className="m-sync-actions">
        <Button
          disabled={!url}
          onClick={() => {
            void shareVaultFile(vault, path).catch(() => toast.warning(t("mobile.vaultExportFailed")));
          }}
          variant="tonal"
        >
          <Share2 size={ICON.ui} />
          {t("mobile.share")}
        </Button>
      </div>
    </div>
  );
}
