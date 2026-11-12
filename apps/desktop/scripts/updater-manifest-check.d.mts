/** Types for `updater-manifest-check.mjs` (the manifest check of updater-manifest.yml, R11). */
import type { KeyObject } from "node:crypto";

export declare const EXPECTED_PLATFORMS_BY_RUNNER: Record<string, string[]>;
export declare const EXPECTED_PLATFORMS: string[];
export declare function decodePublicKey(pubkey: string): { keyId: Buffer; key: KeyObject };
export declare function decodeSignature(signature: unknown): { keyId: Buffer; signature: Buffer; trustedComment: string; globalSignature: Buffer };
export declare function signedVersion(trustedComment: string): string | null;
export declare function sameVersion(signed: string, announced: string): boolean;
export declare function checkUpdaterManifest(
  manifest: unknown,
  options: { pubkey: string; version: string; expectedPlatforms?: string[] },
): string[];
