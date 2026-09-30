import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, ExternalLink } from "lucide-react";
import { AI_EMBEDDING_PROFILE, SEMANTIC_BY_PROVIDER, semanticSourceOf, type EmbeddingModelSpec } from "@plainva/core";
import {
  AiSendOverview,
  Banner,
  Button,
  getPlatformServices,
  ICON,
  loadFacts,
  Modal,
  packageInstalled,
  Radio,
  semanticFailureText,
  semanticModelRows,
  semanticProgressLine,
  semanticReadyLine,
  semanticRunFailureText,
  semanticUnusedLine,
  SettingCard,
  SettingCardNote,
  SettingRow,
  useAiState,
  useLocalEmbeddings,
  type AiSession,
  type LoadFacts,
  type StandingApproval,
  type UnusedEmbeddings,
} from "@plainva/ui";
import { appConfirm } from "../../services/appDialogs";
import { desktopLocalModels } from "../../services/ai/localModels";

/**
 * Settings → AI & automation → "Semantic search" (plan KI-Harness P2a-4/P2a-5,
 * mockup chapter 10): what this device computes with — a catalog package, the
 * model of the profile "Embeddings" at an own provider, or nothing — and the
 * life of it: a package loads after the facts are on the table, a cloud model
 * starts after the send overview's standing approval, both can be paused, a
 * package removed, an approval withdrawn, and what is no longer used cleared
 * away. The same choice as the phone's AI screen (`semanticModelRows`,
 * `semanticSourceOf`, `semanticFailureText`).
 */
export function SemanticSearchCard({ session, onChooseModel }: { session: AiSession; onChooseModel: () => void }) {
  const { t, i18n } = useTranslation();
  const settings = useAiState()?.settings;
  const { controller, state } = useLocalEmbeddings();
  const [asking, setAsking] = useState<EmbeddingModelSpec | null>(null);
  const [unused, setUnused] = useState<UnusedEmbeddings | null>(null);
  const [approval, setApproval] = useState<StandingApproval | null>(null);
  const chosen = settings?.semanticModel ?? null;
  // Stable between renders: the effects below follow it.
  const source = useMemo(() => (settings ? semanticSourceOf(settings) : null), [settings]);
  const target = source?.kind === "provider" ? source.target : null;
  const rows = semanticModelRows(t, i18n.language);
  const engine = state?.engine;
  const download = state?.download ?? null;
  const progress = state?.progress;

  // What is kept but not used, and the approval of the chosen cloud model, follow every change of the engine.
  useEffect(() => {
    let alive = true;
    void controller?.unused().then((found) => alive && setUnused(found));
    if (controller && target) void controller.approvalOf(target).then((found) => alive && setApproval(found));
    else setApproval(null);
    return () => {
      alive = false;
    };
  }, [controller, engine, target]);

  const choose = async (spec: EmbeddingModelSpec | null) => {
    if (!spec) {
      await session.updateSettings((s) => ({ ...s, semanticModel: null }));
      return;
    }
    if (await packageInstalled(desktopLocalModels, spec)) await session.updateSettings((s) => ({ ...s, semanticModel: spec.id }));
    else setAsking(spec);
  };
  const chooseProvider = async () => {
    await session.updateSettings((s) => ({ ...s, semanticModel: SEMANTIC_BY_PROVIDER }));
    // Without a model in the profile there is nothing to compute with yet: ask for one right away.
    if (!settings?.profiles[AI_EMBEDDING_PROFILE]) onChooseModel();
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
  const withdraw = async () => {
    if (!controller || !target) return;
    const ok = await appConfirm({ title: t("ai.semantic.withdraw"), message: t("ai.semantic.withdrawConfirm", { provider: target.provider.label }), confirmLabel: t("ai.semantic.withdraw"), kind: "danger" });
    if (ok) await controller.withdraw(target);
  };
  const removeUnused = async () => {
    if (!controller || !unused) return;
    const what = semanticUnusedLine(t, unused, i18n.language);
    const ok = await appConfirm({ title: t("ai.semantic.unused"), message: t("ai.semantic.unusedConfirm", { what }), confirmLabel: t("ai.semantic.unusedRemove"), kind: "danger" });
    if (!ok) return;
    await controller.removeUnused();
    setUnused(await controller.unused());
  };

  const hasUnused = Boolean(unused && (unused.packages.length || unused.spaces.length));
  const readyPackage = engine?.kind === "ready" && engine.source.kind === "package" ? engine.source.spec : null;

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
        <Radio
          name="semantic-model"
          checked={chosen === SEMANTIC_BY_PROVIDER}
          disabled={Boolean(download)}
          onChange={() => void chooseProvider()}
          data-testid="semantic-model-provider"
          label={
            <>
              <strong>{t("ai.semantic.provider")}</strong>
              <span>
                {target ? `${target.provider.label} · ${target.model}` : t("ai.semantic.providerUnset")} — {t("ai.semantic.providerHint")}
              </span>
            </>
          }
        />
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
          <Button variant="ghost" size="sm" onClick={() => void controller?.cancelInstall(rows.find((row) => row.spec.id === download.model)!.spec)}>
            {t("ai.semantic.cancel")}
          </Button>
        </SettingCardNote>
      )}
      {state?.downloadError && <Banner kind="warning">{t("ai.semantic.loadFailed", { reason: state.downloadError })}</Banner>}
      {(engine?.kind === "checking" || engine?.kind === "opening") && <SettingCardNote>{t("ai.semantic.checking")}</SettingCardNote>}
      {engine?.kind === "failed" && (
        <Banner kind="warning">
          <span className="pv-ai-notewithaction">
            <span>{semanticFailureText(t, engine)}</span>
            {(engine.reason === "no-model" || engine.reason === "no-route") && (
              <Button size="sm" variant="tonal" onClick={onChooseModel} data-testid="semantic-choose-model">
                {t("ai.semantic.chooseModel")}
              </Button>
            )}
          </span>
        </Banner>
      )}
      {engine?.kind === "approval" && (
        <AiSendOverview manifest={engine.manifest} onSend={() => void controller?.approve()} onCancel={() => void session.updateSettings((s) => ({ ...s, semanticModel: null }))} />
      )}
      {engine?.kind === "ready" && progress && (
        <SettingRow label={semanticReadyLine(t, engine.source)} desc={semanticProgressLine(t, progress, i18n.language)}>
          <Button variant="ghost" size="sm" onClick={() => (progress.state === "paused" ? controller?.resume() : controller?.pause())}>
            {progress.state === "paused" ? t("ai.semantic.resume") : t("ai.semantic.pause")}
          </Button>
          {readyPackage && (
            <Button variant="ghost" size="sm" onClick={() => void remove(readyPackage)}>
              {t("ai.semantic.remove")}
            </Button>
          )}
          {engine.source.kind === "provider" && approval && (
            <Button variant="ghost" size="sm" onClick={() => void withdraw()} data-testid="semantic-withdraw">
              {t("ai.semantic.withdraw")}
            </Button>
          )}
        </SettingRow>
      )}
      {engine?.kind === "ready" && progress?.state === "failed" && (
        <Banner kind="warning">{semanticRunFailureText(t, engine.source, state?.runFailure ?? null, progress.error ?? "")}</Banner>
      )}
      {hasUnused && unused && (
        <SettingRow label={t("ai.semantic.unused")} desc={semanticUnusedLine(t, unused, i18n.language)}>
          <Button variant="ghost" size="sm" onClick={() => void removeUnused()} data-testid="semantic-remove-unused">
            {t("ai.semantic.unusedRemove")}
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
