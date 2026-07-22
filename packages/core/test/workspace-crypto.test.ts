import { describe, expect, it } from "vitest";
import {
  createWorkspaceGrant,
  createWorkspaceGroupKeyEpoch,
  createWorkspaceRecoveryIdentity,
  fromHex,
  generateHpkeKeyPair,
  generateSigningKeyPair,
  grantContainsKey,
  hpkeOpen,
  hpkeSeal,
  openWorkspaceGrant,
  probeWorkspaceCryptoRuntime,
  signWorkspaceBytes,
  toHex,
  utf8Encode,
  verifyWorkspaceDocumentSignatures,
  verifyWorkspaceSignature,
} from "../src/index.js";

const ED25519 = {
  seed: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
  publicKey: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
  signature: "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155" +
    "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
};

const HPKE = {
  info: "4f6465206f6e2061204772656369616e2055726e",
  recipientPublicKey: "4310ee97d88cc1f088a5576c77ab0cf5c3ac797f3d95139c6c84b5429c59662a",
  recipientPrivateKey: "8057991eef8f1f1af18f4a9491d16a1ce333f695d4db8e38da75975c4478e0fb",
  ephemeralPublicKey: "1afa08d3dec047a643885163f1180476fa7ddb54c6a8029ea33f95796bf2ac4a",
  ephemeralPrivateKey: "f4ec9b33b792c372c1d2c2063507b684ef925b8c75a42dbcbf57d63ccd381600",
  plaintext: "4265617574792069732074727574682c20747275746820626561757479",
  aad: "436f756e742d30",
  ciphertext: "1c5250d8034ec2b784ba2cfd69dbdb8af406cfe3ff938e131f0def8c8b60b4db" +
    "21993c62ce81883d2dd1b51a28",
};

describe("encrypted workspace cryptography", () => {
  it("matches the RFC 8032 Ed25519 test vector and rejects tampering", () => {
    const pair = generateSigningKeyPair(fromHex(ED25519.seed));
    const signature = signWorkspaceBytes(pair.privateKey, new Uint8Array());

    expect(toHex(pair.publicKey)).toBe(ED25519.publicKey);
    expect(toHex(signature)).toBe(ED25519.signature);
    expect(verifyWorkspaceSignature(pair.publicKey, new Uint8Array(), signature)).toBe(true);
    signature[0] ^= 1;
    expect(verifyWorkspaceSignature(pair.publicKey, new Uint8Array(), signature)).toBe(false);
  });

  it("matches RFC 9180 A.2.1 base-mode sequence 0 exactly", async () => {
    const sealed = await hpkeSeal(
      fromHex(HPKE.recipientPublicKey),
      fromHex(HPKE.plaintext),
      fromHex(HPKE.info),
      fromHex(HPKE.aad),
      {
        ephemeralKeyPair: {
          publicKey: fromHex(HPKE.ephemeralPublicKey),
          privateKey: fromHex(HPKE.ephemeralPrivateKey),
        },
      }
    );

    expect(toHex(sealed.enc)).toBe(HPKE.ephemeralPublicKey);
    expect(toHex(sealed.ciphertext)).toBe(HPKE.ciphertext);
    await expect(hpkeOpen(
      fromHex(HPKE.recipientPrivateKey),
      sealed.enc,
      sealed.ciphertext,
      fromHex(HPKE.info),
      fromHex(HPKE.aad)
    )).resolves.toEqual(fromHex(HPKE.plaintext));
  });

  it("runs the complete shared runtime portability probe", async () => {
    await expect(probeWorkspaceCryptoRuntime()).resolves.toEqual({
      secureRandom: true,
      ed25519: true,
      hpke: true,
      xchacha20poly1305: true,
    });
  });

  it("creates a signed, recipient-bound HPKE group-key grant", async () => {
    const issuer = generateSigningKeyPair(fromHex("11".repeat(32)));
    const recipient = await generateHpkeKeyPair(fromHex("22".repeat(32)));
    const wrongRecipient = await generateHpkeKeyPair(fromHex("23".repeat(32)));
    const key = fromHex("42".repeat(32));
    const issuerId = "10".repeat(16);
    const document = await createWorkspaceGrant({
      workspaceId: "01".repeat(16),
      recipientDeviceId: "20".repeat(16),
      recipientPublicKey: recipient.publicKey,
      issuerDeviceId: issuerId,
      issuerPrivateSigningKey: issuer.privateKey,
      policyHash: "30".repeat(32),
      purpose: "group-content",
      groupId: "40".repeat(16),
      keyEpoch: 7,
      key,
      keyHint: fromHex("50".repeat(8)),
      createdAt: "2026-07-22T10:00:00.000Z",
      hpkeTesting: {
        ephemeralKeyPair: await generateHpkeKeyPair(fromHex("33".repeat(32))),
      },
    });

    expect(verifyWorkspaceDocumentSignatures(document, (signer) => signer.signerId === issuerId ? issuer.publicKey : null)).toBe(true);
    expect(grantContainsKey(await openWorkspaceGrant(document, recipient.privateKey), key)).toBe(true);
    await expect(openWorkspaceGrant(document, wrongRecipient.privateKey)).rejects.toMatchObject({ code: "crypto" });

    const tampered = structuredClone(document);
    tampered.payload.keyEpoch = 8;
    expect(verifyWorkspaceDocumentSignatures(tampered, () => issuer.publicKey)).toBe(false);
    await expect(openWorkspaceGrant(tampered, recipient.privateKey)).rejects.toMatchObject({ code: "crypto" });
  });

  it("derives deterministic HPKE key pairs and separates seeds", async () => {
    const first = await generateHpkeKeyPair(fromHex("a1".repeat(32)));
    const repeated = await generateHpkeKeyPair(fromHex("a1".repeat(32)));
    const second = await generateHpkeKeyPair(fromHex("a2".repeat(32)));
    expect(first).toEqual(repeated);
    expect(toHex(first.publicKey)).not.toBe(toHex(second.publicKey));
    expect(utf8Encode("workspace").length).toBe(9);
  });

  it("creates isolated recovery and per-epoch group key material", async () => {
    const recovery = createWorkspaceRecoveryIdentity({
      recoveryId: "91".repeat(16),
      signingSeed: fromHex("92".repeat(32)),
      rootKey: fromHex("93".repeat(32)),
    });
    const group = await createWorkspaceGroupKeyEpoch({
      groupId: "94".repeat(16),
      keyEpoch: 2,
      hpkeSeed: fromHex("95".repeat(32)),
      catalogKey: fromHex("96".repeat(32)),
    });
    expect(recovery.publicIdentity).toMatchObject({ recoveryId: "91".repeat(16) });
    expect(recovery.signing.privateKey).toHaveLength(32);
    expect(recovery.rootKey).toEqual(fromHex("93".repeat(32)));
    expect(group).toMatchObject({ groupId: "94".repeat(16), keyEpoch: 2 });
    expect(group.hpke.privateKey).toHaveLength(32);
    expect(group.catalogKey).toEqual(fromHex("96".repeat(32)));
    expect(toHex(recovery.rootKey)).not.toBe(toHex(group.catalogKey));
  });
});
