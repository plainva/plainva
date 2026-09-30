import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, ExternalLink } from "lucide-react";
import { embeddingModel, type EmbeddingModelSpec } from "@plainva/core";
import {
  Banner,
  Button,
  getPlatformServices,
  ICON,
  loadFacts,
  Modal,
  packageInstalled,
  Radio,
  semanticModelRows,
  SettingCard,
  SettingCardNote,
  SettingRow,
  useAiState,
  useLocalEmbeddings,
  type AiSession,
  type LoadFacts,
} from "@plainva/ui";
import { appConfirm } from "../../services/appDialogs";
import { desktopLocalModels } from "../../services/ai/localModels";

/**
 * Settings → AI & automation → "Semantic search" (plan KI-Harness P2a-4,
 * mockup chapter 10): which model this device computes with — or none — and
 * the package's life: load it after the facts are on the table, watch it
 * embed, pause, remove it with its vectors. The same choice as the phone's
 * AI screen (`semanticModelRows`, `loadFacts`).
 */
export function SemanticSearchCard({ session }: { session: AiSession }) {
  const { t, i18n } = useTranslation();
  const settings = useAiState()?.settings;
  const { controller, state } = useLocalEmbeddings();
  const [asking, setAsking] = useState<EmbeddingModelSpec | null>(null);
  const chosen = settings?.semanticModel ?? null;
  const rows = semanticModelRows(t, i18n.language);

  const choose = async (spec: EmbeddingModelSpec | null) => {
    if (!spec) {
      await session.updateSettings((s) => ({ ...s, semanticModel: null }));
      return;
    }
    if (await packageInstalled(desktopLocalModels, spec)) await session.updateSettings((s) => ({ ...s, semanticModel: spec.id }));
    else setAsking(spec);
  };
  const load = async (spec: EmbeddingModelSpec) => {
    setAsking(null);
    if (controller && (await controller.install(spec))) await session.updateSettings((s) => ({ ...s, semanticModel: spec.id }));
  };
  const remove = async (spec: EmbeddingModelSpec) => {
    const ok = await appConfirm({ title: t("ai.semantic.remove"), message: t("ai.semantic.removeConfirm", { model: spec.name }), confirmLabel: t("ai.semantic.remove"), kind: "danger" });
    if (!ok || !controller) return;
    if (chosen === spec.id) await session.updateSettings((s) => ({ ...s, semanticModel: null }));
    await controller.remove(spec);
  };

  const engine = state?.engine;
  const download = state?.download ?? null;
  const progress = state?.progress;
  const current = chosen ? embeddingModel(chosen) : undefined;

  return (
    <SettingCard label={t("ai.semantic.title")}>
      <SettingCardNote>{t("ai.semantic.description")}</SettingCardNote>
      <div className="pv-semantic-choices" role="radiogroup" aria-label={t("ai.semantic.title")}>
        <Radio name="semantic-model" checked={!chosen} disabled={Boolean(download)} onChange={() => void choose(null)} label={<strong>{t("ai.semantic.off")}</strong>} />
        {rows.map((row) => (
          <Radio
            key={row.spec.id}
            name="semantic-model"
            checked={chosen === row.spec.id}
            disabled={Boolean(download)}
            onChange={() => void choose(row.spec)}
            data-testid={`semantic-model-${row.spec.id}`}
            label={
              <>
                <strong>{row.spec.name}</strong>
                <span>
                  {row.line} — {row.hint}
                </span>
              </>
            }
          />
        ))}
      </div>
      {download && (
        <SettingCardNote>
          <div role="status">
            {t("ai.semantic.loading", {
              file: download.file,
              received: new Intl.NumberFormat(i18n.language).format(Math.round(download.received / 1e6)),
              total: new Intl.NumberFormat(i18n.language).format(Math.round(download.total / 1e6)),
            })}
          </div>
          <div className="pv-security-progress" aria-hidden="true">
            <div className="pv-security-progress-bar" style={{ width: `${download.total ? (download.received / download.total) * 100 : 0}%` }} />
          </div>
          <Button variant="ghost" size="sm" onClick={() => void controller?.cancelInstall(embeddingModel(download.model)!)}>
            {t("ai.semantic.cancel")}
          </Button>
        </SettingCardNote>
      )}
      {state?.downloadError && <Banner kind="warning">{t("ai.semantic.loadFailed", { reason: state.downloadError })}</Banner>}
      {engine?.kind === "checking" && <SettingCardNote>{t("ai.semantic.checking")}</SettingCardNote>}
      {engine?.kind === "failed" && (
        <Banner kind="warning">{engine.reason === "check" ? t("ai.semantic.checkFailed") : engine.reason === "runtime" ? t("ai.semantic.runtimeMissing") : t("ai.semantic.loadFailed", { reason: engine.detail })}</Banner>
      )}
      {engine?.kind === "ready" && current && progress && (
        <SettingRow label={t("ai.semantic.ready", { model: current.name })} desc={t("ai.semantic.progress", { done: progress.current, total: progress.total })}>
          <Button variant="ghost" size="sm" onClick={() => (progress.state === "paused" ? controller?.resume() : controller?.pause())}>
            {progress.state === "paused" ? t("ai.semantic.resume") : t("ai.semantic.pause")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void remove(current)}>
            {t("ai.semantic.remove")}
          </Button>
        </SettingRow>
      )}
      {asking && <LoadDialog spec={asking} onClose={() => setAsking(null)} onLoad={() => void load(asking)} />}
    </SettingCard>
  );
}

function LoadDialog({ spec, onClose, onLoad }: { spec: EmbeddingModelSpec; onClose: () => void; onLoad: () => void }) {
  const { t, i18n } = useTranslation();
  const { controller } = useLocalEmbeddings();
  const [facts, setFacts] = useState<LoadFacts | null>(null);
  useEffect(() => {
    let alive = true;
    void Promise.all([controller?.noteBytes() ?? Promise.resolve(0), controller?.freeSpace() ?? Promise.resolve(null)]).then(([noteBytes, free]) => {
      if (alive) setFacts(loadFacts(t, spec, i18n.language, { noteBytes }, free));
    });
    return () => {
      alive = false;
    };
  }, [controller, spec, t, i18n.language]);
  return (
    <Modal
      title={facts?.title ?? t("ai.semantic.loadTitle", { model: spec.name })}
      icon={<Download size={ICON.ui} />}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("ai.semantic.back")}
          </Button>
          <Button variant="primary" onClick={onLoad} disabled={!facts || Boolean(facts.spaceShort)} data-testid="semantic-load">
            {t("ai.semantic.loadAndSwitchOn")}
          </Button>
        </>
      }
    >
      {facts && (
        <dl className="pv-security-details">
          <dt>{t("ai.semantic.size")}</dt>
          <dd>{facts.size}</dd>
          <dt>{t("ai.semantic.source")}</dt>
          <dd>
            {facts.source}
            <br />
            <span className="pv-semantic-note">{facts.sourceNote}</span>
          </dd>
          <dt>{t("ai.semantic.licence")}</dt>
          <dd>
            {facts.licence}{" "}
            <Button variant="ghost" size="sm" onClick={() => void getPlatformServices().openExternal(facts.licenceUrl)}>
              <ExternalLink size={ICON.ui} />
              {t("ai.semantic.showLicence")}
            </Button>
          </dd>
          {facts.space && (
            <>
              <dt>{t("ai.semantic.space")}</dt>
              <dd>{facts.space}</dd>
            </>
          )}
          <dt>{t("ai.semantic.duration")}</dt>
          <dd>{facts.duration}</dd>
        </dl>
      )}
      {facts?.spaceShort && <Banner kind="warning">{facts.spaceShort}</Banner>}
      <p className="pv-semantic-note">{t("ai.semantic.staysLocal")}</p>
    </Modal>
  );
}
