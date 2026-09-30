import { ZoomableImage } from "../components/ZoomableImage";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Share2 } from "lucide-react";
import { Button, ICON, imageMimeType, toast } from "@plainva/ui";
import { AppBar } from "../components/AppBar";
import { MissingFileState } from "../components/MissingFileState";
import { shareVaultFile } from "../services/shareFile";
import type { MobileVault } from "../services/vaultService";
import { useOpenFileLookup } from "./useOpenFileLookup";

/** Image viewing with pinch, double-tap and reset. Crop/paint remain delegated
 * to the phone's own image editor through Share (see the parity catalog). */
export function ImageViewerScreen({
  vault,
  path,
  onBack,
  onRenamed,
}: {
  vault: MobileVault;
  path: string;
  onBack: () => void;
  /** The screen follows its image when it was moved outside Plainva (issue 110). */
  onRenamed?: (to: string) => void;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const name = path.split("/").pop() ?? path;
  // Moved or deleted outside Plainva (issue 110, E9): looked for by its
  // content hash and followed when the move is proven, else "Moved?" or the
  // missing state — never the bare load error.
  const missing = useOpenFileLookup(vault, path, { onRenamed });
  const { look: lookForFile, remember: rememberFile } = missing;

  useEffect(() => {
    setUrl(null); setFailed(false);
    let objectUrl: string | null = null;
    let stale = false;
    void (async () => {
      try {
        const bytes = await vault.files.readBinaryFile(path);
        if (stale) return;
        objectUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: imageMimeType(path) }));
        setUrl(objectUrl);
        rememberFile();
      } catch {
        if (!stale) {
          setFailed(true);
          lookForFile();
        }
      }
    })();
    return () => {
      stale = true;
      // The blob outlives the component otherwise, and a gallery of large
      // photos would hold every one of them for the session.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [vault, path, lookForFile, rememberFile]);

  return (
    <div className="m-page m-page--viewer">
      <AppBar onBack={onBack} title={name} />
      {missing.lookup ? (
        <MissingFileState lookup={missing.lookup} onPick={missing.pick} onBack={onBack} testIdPrefix="image" />
      ) : failed ? (
        <p className="m-hint">{t("imageViewer.loadError")}</p>
      ) : (
        url && <ZoomableImage key={`${path}:${url}`} url={url} name={name} onError={() => setFailed(true)} />
      )}
      <div className="m-sync-actions">
        <Button
          disabled={!url || failed || missing.lookup !== null}
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
