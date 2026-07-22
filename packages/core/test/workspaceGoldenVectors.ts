import {
  appendWorkspaceDocumentSignature,
  encodeWorkspaceDocument,
  fromHex,
  generateHpkeKeyPair,
  generateSigningKeyPair,
  sealChunkedPvo1,
  sealInlinePvo1,
  signWorkspaceDocument,
  toBase64,
  toHex,
  workspaceDocumentHash,
  workspaceSha256Hex,
} from "../src/index.js";

const ids = {
  workspace: "01".repeat(16),
  ownerDevice: "10".repeat(16),
  recovery: "20".repeat(16),
  member: "30".repeat(16),
  group: "40".repeat(16),
  object: "50".repeat(16),
  revision: "60".repeat(16),
};

function documentVector(document: Parameters<typeof encodeWorkspaceDocument>[0]) {
  const bytes = encodeWorkspaceDocument(document);
  return { canonicalUtf8Hex: toHex(bytes), sha256: workspaceDocumentHash(document) };
}

export async function buildWorkspaceGoldenVectors() {
  const owner = generateSigningKeyPair(fromHex("11".repeat(32)));
  const recovery = generateSigningKeyPair(fromHex("22".repeat(32)));
  const ownerHpke = await generateHpkeKeyPair(fromHex("33".repeat(32)));
  const groupHpke = await generateHpkeKeyPair(fromHex("44".repeat(32)));
  const envelopeEphemeral = await generateHpkeKeyPair(fromHex("55".repeat(32)));

  const policy = signWorkspaceDocument({
    kind: "policy" as const,
    protocolVersion: 1 as const,
    workspaceId: ids.workspace,
    payload: {
      policyVersion: 1,
      previousPolicyHash: null,
      minimumClientVersion: "0.1.0",
      algorithmSuites: [1],
      members: [{ memberId: ids.member, displayName: "Owner", state: "active" }],
      devices: [{
        deviceId: ids.ownerDevice,
        memberId: ids.member,
        displayName: "Desktop",
        platform: "desktop",
        signingPublicKey: toBase64(owner.publicKey),
        hpkePublicKey: toBase64(ownerHpke.publicKey),
        state: "active",
        addedAt: "2026-07-22T08:00:00.000Z",
        revokedAt: null,
      }],
      groups: [{ groupId: ids.group, name: "Owners", keyEpoch: 1, hpkePublicKey: toBase64(groupHpke.publicKey) }],
      assignments: [{
        assignmentId: "70".repeat(16),
        subjectKind: "member",
        subjectId: ids.member,
        role: "owner",
        capabilities: ["content.read", "content.write", "workspace.manage"],
        scopeKind: "workspace",
        scopeId: null,
      }],
      slices: [],
      objectOverrides: [],
      revocations: [],
    },
  }, { algorithm: "Ed25519", signerId: ids.ownerDevice, signerKind: "device" }, owner.privateKey);

  const genesisOwner = signWorkspaceDocument({
    kind: "genesis" as const,
    protocolVersion: 1 as const,
    workspaceId: ids.workspace,
    payload: {
      createdAt: "2026-07-22T08:00:00.000Z",
      minimumClientVersion: "0.1.0",
      algorithmSuites: [1],
      initialOwnerMember: { memberId: ids.member, displayName: "Owner" },
      initialOwnerDevice: {
        deviceId: ids.ownerDevice,
        memberId: ids.member,
        displayName: "Desktop",
        platform: "desktop" as const,
        signingPublicKey: toBase64(owner.publicKey),
        hpkePublicKey: toBase64(ownerHpke.publicKey),
      },
      recovery: { recoveryId: ids.recovery, signingPublicKey: toBase64(recovery.publicKey) },
      initialPolicyHash: workspaceDocumentHash(policy),
    },
  }, { algorithm: "Ed25519", signerId: ids.ownerDevice, signerKind: "device" }, owner.privateKey);
  const genesis = appendWorkspaceDocumentSignature(
    genesisOwner,
    { algorithm: "Ed25519", signerId: ids.recovery, signerKind: "recovery" },
    recovery.privateKey
  );

  const operation = signWorkspaceDocument({
    kind: "operation" as const,
    protocolVersion: 1 as const,
    workspaceId: ids.workspace,
    payload: {
      operationId: "09".repeat(16),
      deviceId: ids.ownerDevice,
      memberId: ids.member,
      sequence: 1,
      previousDeviceOperationHash: null,
      policyHash: workspaceDocumentHash(policy),
      capability: "content.create" as const,
      operation: "create" as const,
      objectId: ids.object,
      revisionId: ids.revision,
      parentRevisionIds: [],
      payloadHash: "80".repeat(32),
      createdAt: "2026-07-22T08:02:00.000Z",
    },
  }, { algorithm: "Ed25519", signerId: ids.ownerDevice, signerKind: "device" }, owner.privateKey);

  const recipient = {
    groupId: ids.group,
    keyEpoch: 1,
    publicKey: groupHpke.publicKey,
    keyHint: fromHex("66".repeat(8)),
    hpkeTesting: { ephemeralKeyPair: envelopeEphemeral },
  };
  const metadata = {
    path: "Projects/Golden.md",
    mime: "text/markdown",
    parentObjectId: null,
    createdAt: "2026-07-22T08:01:00.000Z",
    modifiedAt: "2026-07-22T08:02:00.000Z",
    contentKind: "text" as const,
  };
  const inline = await sealInlinePvo1({
    workspaceId: ids.workspace,
    objectId: ids.object,
    revisionId: ids.revision,
    recipients: [recipient],
    metadata,
    plaintext: new TextEncoder().encode("Plainva golden inline vector\n"),
    testing: {
      dataKey: fromHex("77".repeat(32)),
      metadataNonce: fromHex("88".repeat(24)),
      payloadNonce: fromHex("99".repeat(24)),
    },
  });
  const chunked = await sealChunkedPvo1({
    workspaceId: ids.workspace,
    objectId: ids.object,
    revisionId: ids.revision,
    recipients: [recipient],
    metadata,
    chunks: [new TextEncoder().encode("abcd"), new TextEncoder().encode("ef")],
    testing: {
      dataKey: fromHex("aa".repeat(32)),
      metadataNonce: fromHex("bb".repeat(24)),
      payloadNonce: fromHex("cc".repeat(24)),
      chunkNonces: [fromHex("dd".repeat(24)), fromHex("ee".repeat(24))],
    },
  });

  return {
    protocolVersion: 1,
    rfc8032: {
      seed: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
      publicKey: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
      message: "",
      signature: "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
    },
    rfc9180A2_1: {
      info: "4f6465206f6e2061204772656369616e2055726e",
      recipientPublicKey: "4310ee97d88cc1f088a5576c77ab0cf5c3ac797f3d95139c6c84b5429c59662a",
      recipientPrivateKey: "8057991eef8f1f1af18f4a9491d16a1ce333f695d4db8e38da75975c4478e0fb",
      ephemeralPublicKey: "1afa08d3dec047a643885163f1180476fa7ddb54c6a8029ea33f95796bf2ac4a",
      ephemeralPrivateKey: "f4ec9b33b792c372c1d2c2063507b684ef925b8c75a42dbcbf57d63ccd381600",
      plaintext: "4265617574792069732074727574682c20747275746820626561757479",
      aad: "436f756e742d30",
      ciphertext: "1c5250d8034ec2b784ba2cfd69dbdb8af406cfe3ff938e131f0def8c8b60b4db21993c62ce81883d2dd1b51a28",
    },
    documents: {
      genesis: documentVector(genesis),
      policy: documentVector(policy),
      operation: documentVector(operation),
    },
    pvo1: {
      inline: { bytesHex: toHex(inline), sha256: workspaceSha256Hex(inline) },
      chunked: { bytesHex: toHex(chunked.object), sha256: workspaceSha256Hex(chunked.object) },
      pvc1: chunked.chunks.map((bytes) => ({ bytesHex: toHex(bytes), sha256: workspaceSha256Hex(bytes) })),
    },
  };
}
