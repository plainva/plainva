import { describe, expect, it } from "vitest";
import {
  fromHex,
  fuzzParseWorkspaceFrame,
  generateHpkeKeyPair,
  openPvc1Chunk,
  openPvo1Frame,
  parsePvc1Chunk,
  parsePvo1Frame,
  sealChunkedPvo1,
  sealInlinePvo1,
  splitPvo1Chunks,
  verifyChunkedPlaintextHash,
  workspaceSha256Hex,
} from "../src/index.js";

const workspaceId = "01".repeat(16);
const objectId = "02".repeat(16);
const revisionId = "03".repeat(16);
const groupId = "04".repeat(16);

const metadata = {
  path: "Projects/Protocol.md",
  mime: "text/markdown",
  parentObjectId: null,
  createdAt: "2026-07-22T09:00:00.000Z",
  modifiedAt: "2026-07-22T09:01:00.000Z",
  contentKind: "text" as const,
};

async function deterministicRecipient() {
  const recipient = await generateHpkeKeyPair(fromHex("10".repeat(32)));
  const ephemeral = await generateHpkeKeyPair(fromHex("20".repeat(32)));
  return {
    recipient,
    envelope: {
      groupId,
      keyEpoch: 3,
      publicKey: recipient.publicKey,
      keyHint: fromHex("30".repeat(8)),
      hpkeTesting: { ephemeralKeyPair: ephemeral },
    },
    reader: { groupId, keyEpoch: 3, privateKey: recipient.privateKey },
  };
}

describe("PVO1 and PVC1 encrypted workspace objects", () => {
  it("round-trips a deterministic inline PVO1 frame", async () => {
    const keys = await deterministicRecipient();
    const plaintext = new TextEncoder().encode("# Encrypted workspace\n\nOpaque on every provider.\n");
    const frame = await sealInlinePvo1({
      workspaceId,
      objectId,
      revisionId,
      recipients: [keys.envelope],
      metadata,
      plaintext,
      testing: {
        dataKey: fromHex("40".repeat(32)),
        metadataNonce: fromHex("50".repeat(24)),
        payloadNonce: fromHex("60".repeat(24)),
      },
    });
    const parsed = parsePvo1Frame(frame);
    const opened = await openPvo1Frame(frame, [keys.reader]);

    expect(new TextDecoder().decode(frame.subarray(0, 4))).toBe("PVO1");
    expect(parsed).toMatchObject({ workspaceId, objectId, revisionId, flags: 0, chunkCount: 0, plaintextLength: plaintext.length });
    expect(opened.metadata).toMatchObject(metadata);
    expect(opened.plaintext).toEqual(plaintext);
    expect(workspaceSha256Hex(frame)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("round-trips deterministic chunk objects and verifies their aggregate hash", async () => {
    const keys = await deterministicRecipient();
    const plaintext = new TextEncoder().encode("abcdefghij");
    const chunks = splitPvo1Chunks(plaintext, 4);
    const sealed = await sealChunkedPvo1({
      workspaceId,
      objectId,
      revisionId,
      recipients: [keys.envelope],
      metadata,
      chunks,
      testing: {
        dataKey: fromHex("41".repeat(32)),
        metadataNonce: fromHex("51".repeat(24)),
        payloadNonce: fromHex("61".repeat(24)),
        chunkNonces: [fromHex("71".repeat(24)), fromHex("72".repeat(24)), fromHex("73".repeat(24))],
      },
    });
    const opened = await openPvo1Frame(sealed.object, [keys.reader]);
    const openedChunks = sealed.chunks.map((bytes, index) => openPvc1Chunk({
      bytes,
      expected: opened.manifest!.chunks[index],
      frame: opened,
    }));

    expect(opened.manifest).toEqual(sealed.manifest);
    expect(openedChunks).toEqual(chunks);
    expect(verifyChunkedPlaintextHash(opened, openedChunks)).toBe(true);
    expect(parsePvc1Chunk(sealed.chunks[2])).toMatchObject({ index: 2, plaintextLength: 2, workspaceId, objectId, revisionId });
  });

  it("binds every envelope to workspace, object, revision, group and epoch", async () => {
    const keys = await deterministicRecipient();
    const frame = await sealInlinePvo1({
      workspaceId,
      objectId,
      revisionId,
      recipients: [keys.envelope],
      metadata,
      plaintext: new Uint8Array([1, 2, 3]),
      testing: {
        dataKey: fromHex("40".repeat(32)),
        metadataNonce: fromHex("50".repeat(24)),
        payloadNonce: fromHex("60".repeat(24)),
      },
    });

    await expect(openPvo1Frame(frame, [{ ...keys.reader, groupId: "ff".repeat(16) }])).rejects.toMatchObject({ code: "crypto" });
    await expect(openPvo1Frame(frame, [{ ...keys.reader, keyEpoch: 4 }])).rejects.toMatchObject({ code: "crypto" });

    const wrongWorkspace = new Uint8Array(frame);
    wrongWorkspace[8] ^= 1;
    await expect(openPvo1Frame(wrongWorkspace, [keys.reader])).rejects.toMatchObject({ code: "crypto" });

    const wrongRevision = new Uint8Array(frame);
    wrongRevision[40] ^= 1;
    await expect(openPvo1Frame(wrongRevision, [keys.reader])).rejects.toMatchObject({ code: "crypto" });

    const wrongGroup = new Uint8Array(frame);
    wrongGroup[80] ^= 1;
    await expect(openPvo1Frame(wrongGroup, [{ ...keys.reader, groupId: `${(Number.parseInt(groupId.slice(0, 2), 16) ^ 1).toString(16).padStart(2, "0")}${groupId.slice(2)}` }])).rejects.toMatchObject({ code: "crypto" });

    const wrongEpoch = new Uint8Array(frame);
    new DataView(wrongEpoch.buffer, wrongEpoch.byteOffset).setUint32(96, 4, false);
    await expect(openPvo1Frame(wrongEpoch, [{ ...keys.reader, keyEpoch: 4 }])).rejects.toMatchObject({ code: "crypto" });
  });

  it("rejects duplicate recipients, unknown flags, truncation and chunk corruption", async () => {
    const keys = await deterministicRecipient();
    await expect(sealInlinePvo1({
      workspaceId,
      objectId,
      revisionId,
      recipients: [keys.envelope, { ...keys.envelope, keyHint: fromHex("31".repeat(8)) }],
      metadata,
      plaintext: new Uint8Array(),
    })).rejects.toMatchObject({ code: "canonical" });

    const sealed = await sealChunkedPvo1({
      workspaceId,
      objectId,
      revisionId,
      recipients: [keys.envelope],
      metadata,
      chunks: [new Uint8Array([1, 2, 3])],
      testing: {
        dataKey: fromHex("42".repeat(32)),
        metadataNonce: fromHex("52".repeat(24)),
        payloadNonce: fromHex("62".repeat(24)),
        chunkNonces: [fromHex("72".repeat(24))],
      },
    });
    const unknownFlags = new Uint8Array(sealed.object);
    unknownFlags[7] |= 0x80;
    expect(() => parsePvo1Frame(unknownFlags)).toThrow(/flags/i);
    expect(() => parsePvo1Frame(sealed.object.subarray(0, 79))).toThrow();

    const opened = await openPvo1Frame(sealed.object, [keys.reader]);
    const corruptChunk = new Uint8Array(sealed.chunks[0]);
    corruptChunk[corruptChunk.length - 1] ^= 1;
    expect(() => openPvc1Chunk({ bytes: corruptChunk, expected: opened.manifest!.chunks[0], frame: opened })).toThrow(/hash/i);
  });

  it("keeps the prepared parser fuzz entry total over arbitrary frames", () => {
    let state = 0x6d2b79f5;
    for (let sample = 0; sample < 1_000; sample += 1) {
      state = Math.imul(state ^ (state >>> 15), 1 | state);
      const length = Math.abs(state) % 512;
      const bytes = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) {
        state = Math.imul(state ^ (state >>> 13), 1 | state);
        bytes[index] = state & 0xff;
      }
      expect(["pvo1", "pvc1", "unknown"]).toContain(fuzzParseWorkspaceFrame(bytes));
    }
  });
});
