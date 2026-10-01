import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { EgressChunk } from "@plainva/core";

/**
 * The system's own model (plan KI-Harness P2c): the `PlatformModel` plugin
 * (ios/App/App/PlatformModelPlugin.swift, android/…/PlatformModelPlugin.java),
 * Apple's on-device model on the iPhone, Gemini Nano on Android. It speaks
 * AiNet's request protocol, so the egress hands it every request for
 * `platform://…`; the settings ask it for its status and, on Android, ask
 * the system to load the model.
 */

export interface PlatformModelStatus {
  state: "available" | "unavailable";
  /** Why not, as the settings name it (deviceNotEligible, appleIntelligenceNotEnabled, downloadable …). */
  reason?: string;
  model?: string;
  name?: string;
  contextTokens?: number;
  /** BCP 47 identifiers, where the system names them. */
  languages?: string[];
}

export interface PlatformRequestOptions {
  requestId: string;
  endpointId: string;
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: Record<string, unknown>;
  rawBody?: { base64: string; contentType: string };
}

export interface PlatformModelNative {
  status(): Promise<PlatformModelStatus>;
  request(options: PlatformRequestOptions, callback: (chunk: EgressChunk | null, error?: unknown) => void): Promise<string>;
  cancel(options: { requestId: string }): Promise<{ cancelled: boolean }>;
  /** Android: asks the system to load the model; iOS loads its own and answers `started: false`. */
  download(): Promise<{ started: boolean }>;
  addListener(event: "platformDownload", listener: (progress: { state: string; bytes: number }) => void): Promise<PluginListenerHandle>;
}

export const PlatformModel = registerPlugin<PlatformModelNative>("PlatformModel");

/** A request for the system's own model: it never reaches the network egress. */
export function isPlatformRequest(url: string): boolean {
  return url.startsWith("platform://");
}
