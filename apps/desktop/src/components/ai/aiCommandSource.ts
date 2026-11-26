import { useEffect } from "react";
import type { AppCommand } from "@plainva/ui";

/** Where the shell leaves its palette's commands for the assistant: built late in a render, asked for when a command runs. */
export type AiCommandSource = { current: (() => readonly AppCommand[]) | null };

/**
 * Hands the palette's commands to the assistant (plan KI-Harness P4-4): what
 * `run_command` can do is what the command registry holds, never a list of
 * its own. Rendered where the shell has built them.
 */
export function AiCommandSourceLink({ sourceRef, build }: { sourceRef: AiCommandSource; build: () => readonly AppCommand[] }) {
  useEffect(() => {
    sourceRef.current = build;
    return () => {
      sourceRef.current = null;
    };
  }, [sourceRef, build]);
  return null;
}
