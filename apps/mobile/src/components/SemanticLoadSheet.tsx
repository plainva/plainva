import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EmbeddingModelSpec } from "@plainva/core";
import { Banner, Button, getPlatformServices, GroupCard, loadFacts, Row, RowList, useLocalEmbeddings, type LoadFacts } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";

/**
 * Before a model package is fetched (plan KI-Harness P2a-4, mockup chapter 10):
 * size, source, licence, free space and a reference duration — the desktop's
 * load dialog in the phone's grammar of a sheet with rows (`loadFacts`).
 */
export function SemanticLoadSheet({ spec, onCancel, onLoad }: { spec: EmbeddingModelSpec; onCancel: () => void; onLoad: () => void }) {
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
    <div className="m-sheet-backdrop" onClick={onCancel}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid="semantic-load-sheet">
        <SheetGrip onClose={onCancel} />
        <p className="m-sheet-title">{facts?.title ?? t("ai.semantic.loadTitle", { model: spec.name })}</p>
        {facts && (
          <GroupCard>
            <RowList>
              <Row title={t("ai.semantic.size")} subtitle={facts.size} wrap />
              <Row title={t("ai.semantic.source")} subtitle={`${facts.source} — ${facts.sourceNote}`} wrap />
              <Row
                title={t("ai.semantic.licence")}
                subtitle={`${facts.licence} · ${t("ai.semantic.showLicence")}`}
                wrap
                onClick={() => void getPlatformServices().openExternal(facts.licenceUrl)}
              />
              {facts.space && <Row title={t("ai.semantic.space")} subtitle={facts.space} />}
              <Row title={t("ai.semantic.duration")} subtitle={facts.duration} wrap />
            </RowList>
          </GroupCard>
        )}
        {facts?.spaceShort && <Banner kind="warning">{facts.spaceShort}</Banner>}
        <p className="m-hint">{t("ai.semantic.staysLocal")}</p>
        <Button variant="primary" onClick={onLoad} disabled={!facts || Boolean(facts.spaceShort)} data-testid="semantic-load">
          {t("ai.semantic.loadAndSwitchOn")}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t("ai.semantic.back")}
        </Button>
      </div>
    </div>
  );
}
