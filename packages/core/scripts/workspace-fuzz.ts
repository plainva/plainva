import { randomBytes } from "node:crypto";
import { fuzzParseWorkspaceFrame } from "../src/workspace/pvo1.js";

const parsedIterations = Number.parseInt(process.argv[2] ?? "100000", 10);
if (!Number.isSafeInteger(parsedIterations) || parsedIterations < 1 || parsedIterations > 10_000_000) {
  throw new Error("usage: pnpm fuzz:workspace [iterations: 1..10000000]");
}

let acceptedPvo1 = 0;
let acceptedPvc1 = 0;
for (let index = 0; index < parsedIterations; index += 1) {
  const length = randomBytes(2).readUint16BE(0) % 8_192;
  const outcome = fuzzParseWorkspaceFrame(randomBytes(length));
  if (outcome === "pvo1") acceptedPvo1 += 1;
  if (outcome === "pvc1") acceptedPvc1 += 1;
}

process.stdout.write(JSON.stringify({ iterations: parsedIterations, acceptedPvo1, acceptedPvc1 }) + "\n");
