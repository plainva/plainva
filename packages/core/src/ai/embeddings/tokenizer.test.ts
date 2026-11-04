import { describe, expect, it } from "vitest";
import { createEmbeddingTokenizer } from "./tokenizer.js";

const special = (id: number, content: string) => ({ id, content, single_word: false, lstrip: false, rstrip: false, normalized: false, special: true });
const token = (id: string) => ({ SpecialToken: { id, type_id: 0 } });
const text = { Sequence: { id: "A", type_id: 0 } };
const specials = { "[CLS]": { id: "[CLS]", ids: [1], tokens: ["[CLS]"] }, "[SEP]": { id: "[SEP]", ids: [2], tokens: ["[SEP]"] } };

/** A word-level tokenizer.json with the given template around the text. */
function tokenizerJson(single: unknown[]) {
  return {
    version: "1.0",
    truncation: null,
    padding: null,
    added_tokens: [special(0, "[PAD]"), special(1, "[CLS]"), special(2, "[SEP]")],
    normalizer: { type: "Lowercase" },
    pre_tokenizer: { type: "Whitespace" },
    post_processor: { type: "TemplateProcessing", single, pair: [], special_tokens: specials },
    decoder: null,
    model: {
      type: "WordLevel",
      vocab: { "[PAD]": 0, "[CLS]": 1, "[SEP]": 2, "[UNK]": 3, plainva: 4, probe: 5, one: 6, two: 7, three: 8, four: 9 },
      unk_token: "[UNK]",
    },
  };
}

describe("createEmbeddingTokenizer", () => {
  it("keeps special tokens in front and behind when it cuts (Granite 97M)", () => {
    const tokenizer = createEmbeddingTokenizer(tokenizerJson([token("[CLS]"), text, token("[SEP]")]), { pad_token: "[PAD]" }, 4);
    expect(tokenizer.encode("One two")).toEqual([1, 6, 7, 2]);
    expect(tokenizer.encode("One two three four")).toEqual([1, 6, 7, 2]);
    expect(tokenizer.padId).toBe(0);
  });

  it("keeps a closing special token the model pools from (Qwen3)", () => {
    const tokenizer = createEmbeddingTokenizer(tokenizerJson([text, token("[SEP]")]), { pad_token: { content: "[PAD]" } }, 3);
    expect(tokenizer.encode("one two three four")).toEqual([6, 7, 2]);
  });

  it("keeps an opening one alone (Granite 311M)", () => {
    const tokenizer = createEmbeddingTokenizer(tokenizerJson([token("[CLS]"), text]), {}, 3);
    expect(tokenizer.encode("one two three")).toEqual([1, 6, 7]);
    expect(tokenizer.padId).toBe(0);
  });

  it("refuses a limit that leaves no room for text", () => {
    expect(() => createEmbeddingTokenizer(tokenizerJson([token("[CLS]"), text, token("[SEP]")]), {}, 2)).toThrow(/no room/);
  });
});
