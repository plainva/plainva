/**
 * The local embedding models Plainva offers as optional packages (plan
 * KI-Harness §10.1, P2a; chosen in the embedding spike of 2026-09-30). Data,
 * not code: every file is pinned by repository revision, size and SHA-256, so
 * a package is exactly what was measured — and a file that fails the check is
 * never loaded. The app works fully without any of them; any other embedding
 * model is reachable through an own provider (Ollama, LM Studio, a cloud),
 * never blocked, only described.
 */

export interface EmbeddingPackageFile {
  /** Path inside the repository at `revision`. */
  name: string;
  bytes: number;
  sha256: string;
}

export type EmbeddingPooling = "cls" | "last" | "mean";

/** Why the catalog mentions a model: the default, the more precise one, or one with a caveat. */
export type EmbeddingModelHint = "recommended" | "precise" | "slow-on-phones";

export interface EmbeddingModelSpec {
  id: string;
  /** Product name as its publisher writes it; not translated. */
  name: string;
  publisher: string;
  licence: { spdx: string; url: string };
  /** Hugging Face repository and the commit every file is taken from (no sign-in needed). */
  repo: string;
  revision: string;
  model: EmbeddingPackageFile;
  tokenizer: EmbeddingPackageFile;
  tokenizerConfig: EmbeddingPackageFile;
  dim: number;
  pooling: EmbeddingPooling;
  /** Longer input is cut to this many tokens (special tokens included). */
  maxTokens: number;
  /** Prepended to a search question; documents go in as they are. */
  queryPrefix: string;
  /** Chunks per second on the spike's reference laptop (i7-1265U), native ONNX Runtime, sustained. */
  referenceChunksPerSecond: number;
  hint: EmbeddingModelHint;
}

const QWEN3_QUERY = "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery:";

export const EMBEDDING_MODELS: readonly EmbeddingModelSpec[] = [
  {
    id: "granite-r2-97m",
    name: "Granite Embedding Multilingual R2 (97M)",
    publisher: "IBM",
    licence: { spdx: "Apache-2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" },
    repo: "onnx-community/granite-embedding-97m-multilingual-r2-ONNX",
    revision: "536a9f241cb3f02a9c5995a1e708c784bd274859",
    model: { name: "onnx/model_quantized.onnx", bytes: 97_858_099, sha256: "704c1ebca5fbb7cd83ced41827658ac4c9990c64f7f2874d22b78044e5022e22" },
    tokenizer: { name: "tokenizer.json", bytes: 25_301_671, sha256: "51947676cae1f991fa51c6b9a24e14ee5460e5f0b9f692f13bb3159829d1592a" },
    tokenizerConfig: { name: "tokenizer_config.json", bytes: 12_860, sha256: "6ed69389e30a8ecabfce2f9ebcdf0c908b34056f24d994340f2f216521c057d5" },
    dim: 384,
    pooling: "cls",
    maxTokens: 512,
    queryPrefix: "",
    referenceChunksPerSecond: 6.7,
    hint: "recommended",
  },
  {
    id: "granite-r2-311m",
    name: "Granite Embedding Multilingual R2 (311M)",
    publisher: "IBM",
    licence: { spdx: "Apache-2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" },
    repo: "onnx-community/granite-embedding-311m-multilingual-r2-ONNX",
    revision: "8f039f21d4181327268271bea4b11ddcc7eef88d",
    model: { name: "onnx/model_quantized.onnx", bytes: 312_556_945, sha256: "54d33d10f865516eda6770d7b0bbf5eaece861058907da0ad095c62e52958c3d" },
    tokenizer: { name: "tokenizer.json", bytes: 33_384_821, sha256: "0087c868b33bad550a78a08d19798cfd7f713cde4f020803b8f51f405503e15f" },
    tokenizerConfig: { name: "tokenizer_config.json", bytes: 1_155_500, sha256: "7947bdf0378520e69ca412b8c4dacd1cffa8aef099f851fdd5c65aa27c6b36a0" },
    dim: 768,
    pooling: "cls",
    maxTokens: 512,
    queryPrefix: "",
    referenceChunksPerSecond: 2.8,
    hint: "precise",
  },
  {
    id: "qwen3-embedding-0.6b",
    name: "Qwen3 Embedding (0.6B)",
    publisher: "Qwen",
    licence: { spdx: "Apache-2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" },
    repo: "onnx-community/Qwen3-Embedding-0.6B-ONNX",
    revision: "c25a394dd583836952667c12f008335071b3f43d",
    model: { name: "onnx/model_quantized.onnx", bytes: 613_527_631, sha256: "87cd124e0ef1fd1f223ebc283efccbaeac386d0b08344701c46975d0657b591f" },
    tokenizer: { name: "tokenizer.json", bytes: 11_423_705, sha256: "def76fb086971c7867b829c23a26261e38d9d74e02139253b38aeb9df8b4b50a" },
    tokenizerConfig: { name: "tokenizer_config.json", bytes: 9_731, sha256: "977648852447cb6587327ff3205b0a84cf2fc9f05621d6c8e88a497caafab2e1" },
    dim: 1024,
    pooling: "last",
    maxTokens: 512,
    queryPrefix: QWEN3_QUERY,
    referenceChunksPerSecond: 0.4,
    hint: "slow-on-phones",
  },
];

export const DEFAULT_EMBEDDING_MODEL_ID = "granite-r2-97m";

export function embeddingModel(id: string): EmbeddingModelSpec | undefined {
  return EMBEDDING_MODELS.find((spec) => spec.id === id);
}

/** Every file of a package, in download order (the model last: it is the long one). */
export function embeddingPackageFiles(spec: EmbeddingModelSpec): EmbeddingPackageFile[] {
  return [spec.tokenizerConfig, spec.tokenizer, spec.model];
}

export function embeddingPackageBytes(spec: EmbeddingModelSpec): number {
  return embeddingPackageFiles(spec).reduce((sum, file) => sum + file.bytes, 0);
}

/** The pinned download address of one file — a fixed commit, never a moving branch. */
export function embeddingFileUrl(spec: EmbeddingModelSpec, file: EmbeddingPackageFile): string {
  return `https://huggingface.co/${spec.repo}/resolve/${spec.revision}/${file.name}`;
}

/**
 * The engine id vectors are stored under: model and revision. A new revision
 * is a new vector space — its vectors never mix with the old ones.
 */
export function embeddingEngineId(spec: EmbeddingModelSpec): string {
  return `plainva:${spec.id}@${spec.revision.slice(0, 12)}`;
}
