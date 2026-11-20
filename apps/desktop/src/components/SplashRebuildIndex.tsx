import React from "react";
import { indexDatabaseRebuildOffered } from "@plainva/ui";
import { useVault } from "../contexts/VaultContext";
import { RebuildIndexButton } from "./RebuildIndexButton";

/**
 * The start's "Rebuild index" for a damaged index database: a button under
 * the error, asked first, one run at a time. Its own module, loaded only when
 * a vault's index database failed, so the start screen's entry file carries
 * none of it.
 */
export const SplashRebuildIndex: React.FC = () => {
  const { indexDatabaseFailure, rebuildIndexDatabase } = useVault();
  const offered = !!indexDatabaseFailure && indexDatabaseRebuildOffered(indexDatabaseFailure.kind, indexDatabaseFailure.workspace);
  if (!offered) return null;
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "calc(-1 * var(--space-4))", marginBottom: "var(--space-6)" }}>
      <RebuildIndexButton onRebuild={rebuildIndexDatabase} testId="splash-rebuild-index" />
    </div>
  );
};
