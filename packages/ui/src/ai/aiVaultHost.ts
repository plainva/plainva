import {
  DEFAULT_AI_POLICY,
  effectivePolicy,
  ENCRYPTED_WORKSPACE_AI_POLICY,
  notePolicyFrom,
  parsePolicyFile,
  readFrontmatterPath,
  type ContextNote,
  type ContextPolicyHost,
  type EffectivePolicy,
  type EgressRecipient,
  type ParsedPolicyFile,
} from "@plainva/core";
import type { AiVaultHost } from "./aiSession";
import { createAiVaultStores, type AiFileStore } from "./aiStores";
import { CHAT_TOOL_NAMES, createVaultToolExecutor, type VaultToolDeps } from "./vaultTools";

/**
 * The vault side of the AI session, built the same way in both shells: the
 * shells hand in how to read a note and what is open, this module decides
 * what the policy says about it (ADR 0017).
 */

/** Where folder rules live. Plainva writes no marker files into the user's folders. */
export const AI_POLICY_FILE = ".agent/policy.yml";

export interface VaultPolicyHost extends ContextPolicyHost {
  /** The parsed folder rules, re-read at most every few seconds. */
  rules(): Promise<ParsedPolicyFile>;
  /** Forget the cached rules (after the settings wrote the file). */
  invalidate(): void;
}

export function createVaultPolicy(opts: {
  readFile(path: string): Promise<string | null>;
  resolveLink(target: string, fromPath: string): Promise<string | null>;
  /** True inside an encrypted workspace: the cloud is off unless the rules say otherwise. */
  encrypted(): boolean;
  now?: () => number;
}): VaultPolicyHost {
  const now = opts.now ?? (() => Date.now());
  let cached: { at: number; parsed: ParsedPolicyFile } | null = null;
  const rules = async (): Promise<ParsedPolicyFile> => {
    if (cached && now() - cached.at < 3000) return cached.parsed;
    let text: string | null;
    try {
      text = await opts.readFile(AI_POLICY_FILE);
    } catch {
      // Unreadable is not "no rules": fall back to the defaults, and say so.
      const parsed = { rules: [], problems: [`${AI_POLICY_FILE} could not be read`] };
      cached = { at: now(), parsed };
      return parsed;
    }
    const parsed = text === null ? { rules: [], problems: [] } : parsePolicyFile(text);
    cached = { at: now(), parsed };
    return parsed;
  };
  return {
    rules,
    invalidate() {
      cached = null;
    },
    async policyOf(path: string, text?: string): Promise<EffectivePolicy> {
      let content = text;
      if (content === undefined) {
        try {
          content = (await opts.readFile(path)) ?? "";
        } catch {
          content = "";
        }
      }
      const plainva = readFrontmatterPath(content, ["plainva"]);
      const own = notePolicyFrom(plainva === undefined ? {} : { plainva });
      return effectivePolicy(path, own, (await rules()).rules, opts.encrypted() ? ENCRYPTED_WORKSPACE_AI_POLICY : DEFAULT_AI_POLICY);
    },
    resolveLink: opts.resolveLink,
  };
}

export interface AiVaultHostInput {
  files: AiFileStore;
  /** A stable handle of the vault (see `aiVaultKey`). */
  vaultKey: string;
  policy: VaultPolicyHost;
  /** The note open in the shell right now — its saved text. */
  activeNote(): Promise<Omit<ContextNote, "pinned"> | null>;
  readNote(path: string): Promise<Omit<ContextNote, "pinned"> | null>;
  /** The tools' access to the vault; null when this shell offers no tools. */
  toolDeps: Omit<VaultToolDeps, "policyOf" | "resolveLink"> | null;
}

export function createAiVaultHost(input: AiVaultHostInput): AiVaultHost {
  const stores = createAiVaultStores(input.files, input.vaultKey);
  return {
    ...stores,
    activeNote: input.activeNote,
    readNote: input.readNote,
    policy: input.policy,
    tools(recipient: EgressRecipient) {
      if (!input.toolDeps) return null;
      const deps: VaultToolDeps = { ...input.toolDeps, policyOf: input.policy.policyOf, resolveLink: input.policy.resolveLink };
      return { names: CHAT_TOOL_NAMES, executor: createVaultToolExecutor(deps, { recipient, webTools: false }) };
    },
  };
}
