/**
 * Sync lifecycle & pre-sync guard helpers shared across Desktop and Mobile shells.
 */

export interface GenesisProbeResult {
  /** True when a remote `.pvws/genesis.pvgen` file was found. */
  encryptedGenesisFound: boolean;
  /** Error object if the probe threw a network/auth exception. */
  probeError: unknown | null;
}

/**
 * Probes a remote object store for an encrypted-workspace genesis (`.pvws/genesis.pvgen`).
 *
 * A transport/auth failure here (e.g. an expired OAuth token -> HTTP 400/401)
 * must NOT throw or abort app startup: we log the warning and return
 * `encryptedGenesisFound: false` with the `probeError` attached, allowing the
 * normal worker cycle to report the auth error as a recoverable status.
 *
 * Only a SUCCESSFUL probe that returns genesis bytes returns `encryptedGenesisFound: true`,
 * signaling that a plaintext local vault must refuse to sync until paired.
 */
export async function probeRemoteGenesis(
  getGenesisBytes: () => Promise<Uint8Array | null>
): Promise<GenesisProbeResult> {
  try {
    const bytes = await getGenesisBytes();
    if (bytes && bytes.length > 0) {
      return { encryptedGenesisFound: true, probeError: null };
    }
    return { encryptedGenesisFound: false, probeError: null };
  } catch (e) {
    return { encryptedGenesisFound: false, probeError: e };
  }
}
