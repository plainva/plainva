import { describe, expect, it } from "vitest";
import {
  appendWorkspaceDocumentSignature,
  createWorkspaceCatalog,
  encodeWorkspaceDocument,
  fromHex,
  generateHpkeKeyPair,
  generateSigningKeyPair,
  normalizeVaultPath,
  openWorkspaceCatalog,
  parseWorkspaceDocument,
  signWorkspaceDocument,
  toBase64,
  utf8Encode,
  verifyWorkspaceDocumentSignatures,
  workspaceDocumentHash,
} from "../src/index.js";

const workspaceId = "01".repeat(16);
const ownerId = "10".repeat(16);
const recoveryId = "20".repeat(16);
const memberId = "30".repeat(16);
const groupId = "40".repeat(16);
const zeroHash = "00".repeat(32);
const owner = generateSigningKeyPair(fromHex("11".repeat(32)));
const recovery = generateSigningKeyPair(fromHex("22".repeat(32)));

async function makeGenesis() {
  const ownerHpke = await generateHpkeKeyPair(fromHex("33".repeat(32)));
  const first = signWorkspaceDocument({
    kind: "genesis" as const,
    protocolVersion: 1 as const,
    workspaceId,
    payload: {
      createdAt: "2026-07-22T08:00:00.000Z",
      minimumClientVersion: "0.1.0",
      algorithmSuites: [1],
      initialOwnerMember: { memberId, displayName: "Owner" },
      initialOwnerDevice: {
        deviceId: ownerId,
        memberId,
        displayName: "Desktop",
        platform: "desktop" as const,
        signingPublicKey: toBase64(owner.publicKey),
        hpkePublicKey: toBase64(ownerHpke.publicKey),
      },
      recovery: { recoveryId, signingPublicKey: toBase64(recovery.publicKey) },
      initialPolicyHash: zeroHash,
    },
  }, { algorithm: "Ed25519", signerId: ownerId, signerKind: "device" }, owner.privateKey);
  return appendWorkspaceDocumentSignature(
    first,
    { algorithm: "Ed25519", signerId: recoveryId, signerKind: "recovery" },
    recovery.privateKey
  );
}

describe("encrypted workspace control documents", () => {
  it("round-trips a canonical dual-signed genesis and verifies both signers", async () => {
    const genesis = await makeGenesis();
    const encoded = encodeWorkspaceDocument(genesis);
    const parsed = parseWorkspaceDocument(encoded);

    expect(new TextDecoder().decode(encoded)).not.toContain("\n");
    expect(parseWorkspaceDocument(encoded)).toEqual(genesis);
    expect(workspaceDocumentHash(parsed)).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyWorkspaceDocumentSignatures(parsed, (signer) => {
      if (signer.signerId === ownerId) return owner.publicKey;
      if (signer.signerId === recoveryId) return recovery.publicKey;
      return null;
    })).toBe(true);
  });

  it("rejects non-canonical JSON, unknown fields, truncation and signature tampering", async () => {
    const encoded = encodeWorkspaceDocument(await makeGenesis());
    const text = new TextDecoder().decode(encoded);
    expect(() => parseWorkspaceDocument(utf8Encode(` ${text}`))).toThrow(/canonical/i);
    expect(() => parseWorkspaceDocument(encoded.subarray(0, encoded.length - 1))).toThrow();

    const unknown = JSON.parse(text) as Record<string, unknown>;
    unknown["unexpected"] = true;
    expect(() => parseWorkspaceDocument(utf8Encode(JSON.stringify(unknown)))).toThrow(/unknown|missing/i);

    const tampered = structuredClone(await makeGenesis());
    tampered.payload.initialOwnerMember.displayName = "Attacker";
    expect(verifyWorkspaceDocumentSignatures(tampered, () => owner.publicKey)).toBe(false);
  });

  it("validates a signed operation and fails closed for unknown operation fields", () => {
    const operation = signWorkspaceDocument({
      kind: "operation" as const,
      protocolVersion: 1 as const,
      workspaceId,
      payload: {
        operationId: "09".repeat(16),
        deviceId: ownerId,
        memberId,
        sequence: 1,
        previousDeviceOperationHash: null,
        policyHash: "ab".repeat(32),
        capability: "content.write" as const,
        operation: "write" as const,
        objectId: "50".repeat(16),
        revisionId: "60".repeat(16),
        parentRevisionIds: ["55".repeat(16)],
        payloadHash: "cd".repeat(32),
        createdAt: "2026-07-22T08:01:00.000Z",
      },
    }, { algorithm: "Ed25519", signerId: ownerId, signerKind: "device" }, owner.privateKey);
    expect(parseWorkspaceDocument(encodeWorkspaceDocument(operation))).toEqual(operation);

    const invalid = structuredClone(operation) as typeof operation & { payload: typeof operation.payload & { path?: string } };
    invalid.payload.path = "leaked/name.md";
    expect(() => encodeWorkspaceDocument(invalid)).toThrow(/unknown|missing/i);

    const mismatchedSigner = signWorkspaceDocument(
      { ...operation, payload: { ...operation.payload, deviceId: "11".repeat(16) } },
      { algorithm: "Ed25519", signerId: ownerId, signerKind: "device" },
      owner.privateKey
    );
    expect(() => encodeWorkspaceDocument(mismatchedSigner)).toThrow(/author device/i);
  });

  it("encrypts catalog membership and binds its clear metadata", () => {
    const key = fromHex("77".repeat(32));
    const catalog = createWorkspaceCatalog({
      workspaceId,
      groupId,
      keyEpoch: 3,
      catalogVersion: 1,
      previousCatalogHash: null,
      catalogKey: key,
      objectRefs: [
        { objectId: "51".repeat(16), revisionId: "61".repeat(16), payloadHash: "71".repeat(32) },
        { objectId: "52".repeat(16), revisionId: "62".repeat(16), payloadHash: "72".repeat(32) },
      ],
      signer: { algorithm: "Ed25519", signerId: ownerId, signerKind: "device" },
      signerPrivateKey: owner.privateKey,
      nonce: fromHex("88".repeat(24)),
    });
    const encodedText = new TextDecoder().decode(encodeWorkspaceDocument(catalog));
    expect(encodedText).not.toContain("51515151");
    expect(openWorkspaceCatalog(catalog, key)).toEqual({ objectRefs: [
      { objectId: "51".repeat(16), revisionId: "61".repeat(16), payloadHash: "71".repeat(32) },
      { objectId: "52".repeat(16), revisionId: "62".repeat(16), payloadHash: "72".repeat(32) },
    ] });
    expect(() => openWorkspaceCatalog(catalog, fromHex("78".repeat(32)))).toThrow(/decryption/i);

    const bound = structuredClone(catalog);
    bound.payload.catalogVersion = 2;
    expect(() => openWorkspaceCatalog(bound, key)).toThrow(/decryption/i);
  });

  it.each([
    ["Projects/Plan.md", "Projects/Plan.md"],
    ["Cafe\u0301/Notes.md", "Caf\u00e9/Notes.md"],
  ])("normalizes portable vault path %s", (input, expected) => {
    expect(normalizeVaultPath(input)).toBe(expected);
  });

  it.each(["../secret.md", "/absolute.md", "C:/secret.md", "a\\b.md", "folder//file.md", "CON/file.md", ".pvws/object"])(
    "rejects unsafe vault path %s",
    (path) => expect(() => normalizeVaultPath(path)).toThrow()
  );

  it("rejects unpaired UTF-16 surrogates before signing or encoding", () => {
    expect(() => normalizeVaultPath(`folder/${String.fromCharCode(0xd800)}.md`)).toThrow(/surrogate/i);
  });

  it("rejects calendar-invalid timestamps instead of accepting Date rollover", () => {
    expect(() => signWorkspaceDocument({
      kind: "operation" as const,
      protocolVersion: 1 as const,
      workspaceId,
      payload: {
        operationId: "09".repeat(16), deviceId: ownerId, memberId, sequence: 1,
        previousDeviceOperationHash: null, policyHash: "ab".repeat(32), capability: "content.create" as const,
        operation: "create" as const, objectId: "50".repeat(16), revisionId: "60".repeat(16),
        parentRevisionIds: [], payloadHash: "cd".repeat(32), createdAt: "2026-02-31T08:00:00.000Z",
      },
    }, { algorithm: "Ed25519", signerId: ownerId, signerKind: "device" }, owner.privateKey)).toThrow(/timestamp/i);
  });
});
