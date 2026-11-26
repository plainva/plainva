import { useLayoutEffect } from "react";
import { useAiAttention, useAiWaitingCount, type LocalEmbeddings, type LocalGists } from "@plainva/ui/ai";
import { useDesktopAi, type DesktopAiInput } from "./useDesktopAi";
import { useDesktopEmbeddings } from "./useDesktopEmbeddings";
import { useDesktopGists } from "./useDesktopGists";

/** What the shell reads of the AI: the harness's hook, the vault's models, and what waits for a decision. */
export interface DesktopAiReport {
  ai: ReturnType<typeof useDesktopAi>;
  embeddings: LocalEmbeddings | null;
  gists: LocalGists | null;
  /** What waits for the user's decision (plan KI-Oberflächen K11): the ribbon's AI button carries it. */
  waiting: number;
  attention: boolean;
}

/**
 * The AI of the central window, as a part of its own (performance plan L5): the shell mounts it once the AI was
 * asked for — at the start when the switch is on, or when a surface of the AI opened — and until then reads a report
 * of an AI that is off. It runs the same hooks the shell ran itself before and hands their result up; it draws
 * nothing.
 */
export function DesktopAiHost({ input, onReport }: { input: Omit<DesktopAiInput, "embeddings" | "gists">; onReport: (report: DesktopAiReport) => void }) {
  const models = { vaultAdapter: input.vaultAdapter, queryService: input.queryService, vaultPath: input.vaultPath, encrypted: input.encrypted };
  // Search by meaning (plan KI-Harness P2a-4/5, P2b): the vault's controller for the search, the settings and the context package.
  const embeddings = useDesktopEmbeddings(models);
  // Gists (plan KI-Harness P2b-3): written by the model of the profile "Local" on this computer, read by the context package.
  const gists = useDesktopGists(models);
  const ai = useDesktopAi({ ...input, embeddings, gists });
  const waiting = useAiWaitingCount(ai.session ?? null);
  const attention = useAiAttention(ai.session ?? null);
  // Before the paint, so the shell never draws a frame with the AI half there.
  useLayoutEffect(() => {
    onReport({ ai, embeddings, gists, waiting, attention });
  });
  return null;
}
