import { useState, useSyncExternalStore } from "react";
import { customEndpointId, normalizeBaseUrl, providerById, type ProviderInfo } from "@plainva/core/ai";
import { aiFailureText, failureRecipient } from "./aiSettingsModel";
import { aiSetupOffer, aiSetupStart, type AiSetupKind, type AiSetupOffer } from "./aiSetup";
import { startAiConversation } from "./aiStart";
import type { AiSession, AiState } from "./aiSession";

type T = (key: string, options?: Record<string, unknown>) => string;

export type AiSetupFlowStep = 1 | 2 | 3;

/**
 * The setup in three steps (plan Oberfläche O7, T9; mockup M7), as a state both shells draw (plan Umsetzung 0.9.x,
 * B7): the phone as a sheet, the desktop as a dialog. What the AI computes with — the device's own model, a provider
 * with a key of one's own, or an own server —, the way in, and a first "Hello" whose answer arrives in the
 * conversation. Nothing is stored before "Next" of the step that stores it: a key goes into the device's secure store,
 * an address through the system's own confirmation, as on the settings page.
 */
export interface AiSetupFlow {
  state: AiState;
  offer: AiSetupOffer;
  step: AiSetupFlowStep;
  kind: AiSetupKind;
  setKind(kind: AiSetupKind): void;
  cloudId: string;
  setCloudId(id: string): void;
  cloud: ProviderInfo | null;
  key: string;
  setKey(key: string): void;
  address: string;
  setAddress(address: string): void;
  /** The provider this pass set up or began with: whose model step 3 chooses. */
  provider: ProviderInfo | null;
  test: AiState["tests"][string] | undefined;
  busy: boolean;
  problem: string | null;
  /** Something typed would be lost by closing: a key, or an address no stored server has. */
  dirty: boolean;
  /** Step 2 has what it needs. */
  ready: boolean;
  /** The system's model can be loaded first (Android: "Load model"). */
  deviceLoadable: boolean;
  next(): Promise<void>;
  back(): void;
  /** The first Hello: a new conversation with one word; the setup's end. */
  sayHello(onClose: () => void): void;
  loadDeviceModel(download: () => Promise<unknown>): Promise<void>;
}

export function useAiSetupFlow(session: AiSession, t: T, platformOs: "ios" | "android" | null): AiSetupFlow {
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const offer = aiSetupOffer(state, platformOs);
  const [start] = useState(() => aiSetupStart(session.getState()));
  const [step, setStep] = useState<AiSetupFlowStep>(start.step);
  const [kind, setKind] = useState<AiSetupKind>(() => {
    const first = start.providerId ? providerById(start.providerId, session.getState().settings.custom) : null;
    return first?.kind === "platform-device" ? "device" : first?.custom ? "server" : first ? "cloud" : offer.kinds[0]!;
  });
  const [cloudId, setCloudId] = useState(() => (start.providerId && offer.cloud.some((p) => p.id === start.providerId) ? start.providerId : (offer.cloud[0]?.id ?? "")));
  const [key, setKey] = useState("");
  // A server that is set up but cannot answer is shown with its address, to be corrected (review O7, O2).
  const [address, setAddress] = useState(() => (start.providerId ? (session.getState().settings.custom.find((c) => c.id === start.providerId)?.baseUrl ?? "") : ""));
  const [providerId, setProviderId] = useState<string | null>(start.providerId);
  const [busy, setBusy] = useState(false);
  // Begun at a provider that failed: what went wrong stands there from the start.
  const [problem, setProblem] = useState<string | null>(() => {
    const failed = start.providerId ? session.getState().tests[start.providerId] : undefined;
    const info = start.providerId ? providerById(start.providerId, session.getState().settings.custom) : null;
    return failed?.state === "failed" && failed.failure && info ? aiFailureText(t, failed.failure, failureRecipient(info)) : null;
  });
  const settings = state.settings;
  // The server this setup added itself, in this pass — the only one a corrected address may replace (review O7, fourth
  // round): a server that was there when it opened stays, and a new address beside it is a server of its own.
  const [madeHere, setMadeHere] = useState<string | null>(null);
  const server = madeHere ? (settings.custom.find((c) => c.id === madeHere) ?? null) : null;
  // A key typed, or an address no stored server has, is asked about before the setup goes (review O7, second round): a
  // server's own address shown to be corrected is nothing unsaved.
  const typedAddress = address.trim() ? (normalizeBaseUrl(address)?.baseUrl ?? address.trim()) : "";
  const dirty = Boolean(key.trim() || (typedAddress && !settings.custom.some((c) => c.baseUrl === typedAddress)));

  const provider = providerId ? (providerById(providerId, settings.custom) ?? null) : null;
  const test = providerId ? state.tests[providerId] : undefined;
  const cloud = offer.cloud.find((p) => p.id === cloudId) ?? null;

  /** Tests the provider that step 2 set up; on success the setup goes on to the first Hello. */
  const tested = async (id: string) => {
    setProviderId(id);
    const result = await session.testProvider(id);
    const info = providerById(id, session.getState().settings.custom);
    if (result.state === "ok") {
      setProblem(null);
      setStep(3);
    } else if (result.failure && info) {
      setProblem(aiFailureText(t, result.failure, failureRecipient(info)));
    }
  };

  const next = async () => {
    setProblem(null);
    if (step === 1) {
      setStep(2);
      if (kind === "device" && offer.device) {
        // The system's model needs nothing typed: it is put on the list and asked whether it is there.
        await session.addProvider(offer.device.id);
        void tested(offer.device.id);
      }
      return;
    }
    if (step !== 2) return;
    setBusy(true);
    try {
      if (kind === "device" && offer.device) await tested(offer.device.id);
      else if (kind === "cloud" && cloud) {
        await session.addProvider(cloud.id);
        if (cloud.endpoint.needsKey && key.trim()) await session.setKey(cloud.id, key);
        setKey("");
        await tested(cloud.id);
      } else if (kind === "server") {
        const normalized = normalizeBaseUrl(address);
        if (!normalized) {
          setProblem(t("ai.add.invalidUrl"));
          return;
        }
        // A server at this address is there already — the one this setup works on, or another —: asked again, never
        // added a second time.
        const same = settings.custom.find((c) => c.baseUrl === normalized.baseUrl);
        if (same) {
          await tested(same.id);
          return;
        }
        // A corrected address replaces the server this setup added for it (review O7, second and fourth round).
        const id = server?.id ?? customEndpointId(settings.custom.map((c) => c.id));
        // The system's own confirmation names the address before anything can go there (as on the settings page).
        const added = await session.addCustom(new URL(normalized.baseUrl).host, normalized.baseUrl, id, normalized.local);
        if (!added) return;
        setMadeHere(id);
        // The address stays in the field: if the server cannot answer, it is there to be corrected.
        await tested(id);
      }
    } catch (error) {
      // The secure store refused the key: said, never with the key in it.
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    setProblem(null);
    setStep(step === 3 ? 2 : 1);
  };

  const sayHello = (onClose: () => void) => {
    onClose();
    // An answer still under way says so instead (Befunde 06.11., B6); the hello waits for the person then.
    if (startAiConversation(session, t)) void session.sendGreeting(t("ai.setup.helloMessage"));
  };

  const loadDeviceModel = async (download: () => Promise<unknown>) => {
    const device = offer.device;
    if (!device) return;
    setBusy(true);
    try {
      await download();
    } catch {
      setProblem(t("ai.settings.loadPlatformFailed", { provider: device.label }));
    } finally {
      setBusy(false);
    }
    void tested(device.id);
  };

  const ready = kind === "device" ? test?.state === "ok" : kind === "cloud" ? Boolean(cloud && (!cloud.endpoint.needsKey || key.trim() || state.keys[cloud.id])) : Boolean(address.trim());
  const deviceLoadable = kind === "device" && test?.state === "failed" && test.failure?.kind === "platform_unavailable" && test.failure.reason === "downloadable";

  return {
    state,
    offer,
    step,
    kind,
    setKind,
    cloudId,
    setCloudId,
    cloud,
    key,
    setKey,
    address,
    setAddress,
    provider,
    test,
    busy,
    problem,
    dirty,
    ready,
    deviceLoadable,
    next,
    back,
    sayHello,
    loadDeviceModel,
  };
}
