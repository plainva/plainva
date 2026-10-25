import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AI_PROFILE_IDS, choiceOnDevice, mcpSkillIdLabel, providerById, type ConversationRecord, type EgressManifest, type ModelChoice, type RunMeta } from "@plainva/core";
import { AiSendOverview, type AiSendOverviewProps, type RunSnapshotView } from "./AiSendOverview";
import { replayRequest, runToolCalls, type RunSnapshotStates } from "./runReplay";
import { useAiSession, useAiState } from "./useAiSession";

/** A note's name as a row shows it where nothing else names it: its file name without the extension. */
const titleOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");

export interface AiRunOverviewProps extends Omit<AiSendOverviewProps, "manifest" | "snapshot"> {
  record: ConversationRecord;
  run: RunMeta;
  manifest: EgressManifest;
}

/**
 * A past run's overview, opened from its line (plan KI-Harness P9-2, ADR
 * 0034): what went where — and the run's snapshot: each source by the
 * version that went and how it reads now, what the tools read, which tools
 * it used, the version of its skills, what it left, and the same question to
 * another model. Whether something changed since is asked when the line
 * opens, on this device.
 */
export function AiRunOverview({ record, run, manifest, ...overview }: AiRunOverviewProps) {
  const { t } = useTranslation();
  const session = useAiSession();
  const state = useAiState();
  const [states, setStates] = useState<{ run: RunMeta; states: RunSnapshotStates } | null>(null);
  useEffect(() => {
    if (!session) return;
    let alive = true;
    void session.snapshotStates(run).then((next) => {
      if (alive) setStates({ run, states: next });
    });
    return () => {
      alive = false;
    };
  }, [session, run]);

  const snapshot = useMemo((): RunSnapshotView | null => {
    if (!session || !state) return null;
    const hashes = new Map((run.readHashes ?? []).map((read) => [read.path, read.hash]));
    const request = replayRequest(record, run);
    // The models a replay can go to: the profiles of this device, not the one that answered — and while it is fully local, only those on it.
    const seen = new Set<string>([`${run.providerId}\n${run.model}`]);
    const choices: { key: string; label: string; hint: string; choice: ModelChoice }[] = [];
    for (const id of AI_PROFILE_IDS) {
      const profile = state.settings.profiles[id];
      if (!profile || (state.settings.localOnly && !choiceOnDevice(state.settings, profile))) continue;
      const key = `${profile.providerId}\n${profile.model}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const provider = providerById(profile.providerId, state.settings.custom)?.label ?? profile.providerId;
      choices.push({ key: id, label: t(`ai.profile.${id}`), hint: `${provider} · ${profile.model}`, choice: { providerId: profile.providerId, model: profile.model } });
    }
    return {
      at: record.conversation.turns[run.userTurn]?.at ?? record.createdAt,
      states: states?.run === run ? states.states : null,
      read: (run.read ?? []).map((path) => ({ path, title: titleOf(path), ...(hashes.get(path) ? { hash: hashes.get(path) } : {}) })),
      readMore: run.readMore === true,
      tools: runToolCalls(record, run),
      // A server's skill (plan P9-4b) by the key the AI loaded it by, never its raw id.
      skills: (run.skills ?? []).flatMap((skill) => (skill.sha256 ? [{ id: skill.id, name: mcpSkillIdLabel(skill.id) ?? skill.id.slice(skill.id.indexOf(":") + 1), hash: skill.sha256 }] : [])),
      result: { rounds: run.writes?.rounds.length ?? 0, drafts: run.writes?.drafts.length ?? 0, plans: run.writes?.plans.length ?? 0 },
      replay: request.ok ? { choices, onReplay: (choice) => void session.replay(record.id, run.userTurn, choice) } : { refused: request.reason },
    };
  }, [session, state, record, run, states, t]);

  return <AiSendOverview manifest={manifest} {...overview} {...(snapshot ? { snapshot } : {})} />;
}
