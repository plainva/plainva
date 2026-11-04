/**
 * The tokenizer of a local embedding model, in TypeScript for all shells
 * (`@huggingface/tokenizers`, Apache-2.0, no dependencies; it gave the ids of
 * Transformers.js on all 284 samples of the embedding spike). The native
 * runtime only ever sees ids.
 */
import { Tokenizer } from "@huggingface/tokenizers";

export interface EmbeddingTokenizer {
  /** The ids of a text with the model's special tokens, cut to the token limit. */
  encode(text: string): number[];
  /** The id a batch is padded with (masked out, so it never counts). */
  readonly padId: number;
}

function runIndex(haystack: readonly number[], needle: readonly number[]): number {
  outer: for (let start = 0; start + needle.length <= haystack.length; start++) {
    for (let i = 0; i < needle.length; i++) if (haystack[start + i] !== needle[i]) continue outer;
    return start;
  }
  return -1;
}

function tokenName(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { content?: unknown }).content === "string") {
    return (value as { content: string }).content;
  }
  return null;
}

/**
 * A tokenizer from a package's `tokenizer.json` and `tokenizer_config.json`.
 * Text longer than `maxTokens` loses its end, never the special tokens: where
 * they sit is learnt from a probe, because the catalog's models differ
 * (Granite 97M one in front and one behind, Granite 311M one in front,
 * Qwen3 one behind — the one Qwen3 pools from).
 */
export function createEmbeddingTokenizer(tokenizerJson: object, tokenizerConfig: object, maxTokens: number): EmbeddingTokenizer {
  const tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig);
  const probe = "Plainva probe";
  const bare = tokenizer.encode(probe, { add_special_tokens: false }).ids;
  const full = tokenizer.encode(probe).ids;
  const at = runIndex(full, bare);
  if (at < 0) throw new Error("embedding tokenizer: special tokens do not surround the text");
  const head = full.slice(0, at);
  const tail = full.slice(at + bare.length);
  const room = maxTokens - head.length - tail.length;
  if (room < 1) throw new Error(`embedding tokenizer: ${maxTokens} tokens leave no room for text`);
  const pad = tokenName((tokenizerConfig as { pad_token?: unknown }).pad_token);
  const padId = (pad !== null ? tokenizer.token_to_id(pad) : undefined) ?? 0;
  return {
    padId,
    encode(text) {
      const ids = tokenizer.encode(text, { add_special_tokens: false }).ids;
      return [...head, ...(ids.length > room ? ids.slice(0, room) : ids), ...tail];
    },
  };
}
