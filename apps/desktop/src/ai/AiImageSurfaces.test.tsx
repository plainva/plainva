// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { startConversation, type ConversationRecord, type EgressManifest, type ImagePart } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import { AiPicture, AiSendOverview, transcriptOf } from "@plainva/ui";

/**
 * The surfaces of "Explain image" (plan KI-Harness P4-5), shared by both
 * shells: the overview that shows the picture as it would go, the row that
 * records it afterwards, and the picture in the conversation.
 */

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(node: React.ReactElement, language = "en"): HTMLElement {
  void i18n.changeLanguage(language);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

const picture: ImagePart = { type: "image", mime: "image/jpeg", data: "QUJDRA==", name: "Whiteboard.jpg", width: 1568, height: 1045, path: "Projects/Assets/Whiteboard.jpg" };

const manifest: EgressManifest = {
  providerId: "anthropic",
  providerLabel: "Anthropic",
  model: "m-1",
  local: false,
  sources: [
    { path: "Projects/Assets/Whiteboard.jpg", title: "Whiteboard.jpg", tier: "evidence", chars: 0, reasons: ["active"], image: { width: 1568, height: 1045, bytes: 312_000 } },
    { path: "Projects/Kickoff.md", title: "Kickoff", tier: "evidence", chars: 400, reasons: ["active"] },
  ],
  dataClasses: ["situation", "notes", "images"],
  folders: ["Projects"],
  withheld: { notes: 0, links: 0, places: 0, moodProperties: 0 },
  excluded: [],
  estimatedTokens: 2600,
  tools: ["search_vault"],
  web: false,
};

describe("the send overview with a picture", () => {
  it("shows the picture as it would go, with its size, and that the file's own details stay", () => {
    const onLeaveOut = vi.fn();
    const container = mount(
      <AiSendOverview manifest={manifest} growth={[{ kind: "dataClass", dataClass: "images" }]} images={[picture]} onSend={() => undefined} onCancel={() => undefined} onLeaveOut={onLeaveOut} />,
    );
    expect(container.textContent).toContain("A new kind of data: an image");
    expect(container.textContent).toContain("image, 1,568 × 1,045 px, 305 KB");
    // The picture itself, from what the request carries — nothing is loaded from anywhere.
    const shown = container.querySelectorAll<HTMLImageElement>('[data-testid="ai-overview-pictures"] img');
    expect(shown).toHaveLength(1);
    expect(shown[0]!.getAttribute("src")).toBe("data:image/jpeg;base64,QUJDRA==");
    expect(shown[0]!.getAttribute("alt")).toBe("Whiteboard.jpg");
    expect(container.textContent).toContain("without the place, the date or the camera the file records");
    // The picture is what was asked about: it goes, or the request is cancelled. A note beside it can be left out.
    const leaveOut = Array.from(container.querySelectorAll("button")).filter((button) => (button.getAttribute("aria-label") ?? "").startsWith("Leave out"));
    expect(leaveOut.map((button) => button.getAttribute("aria-label"))).toEqual(["Leave out Kickoff"]);
    expect(container.querySelector('[data-testid="ai-overview-blind"]')).toBeNull();
  });

  it("says so where the provider's own list calls the model blind", () => {
    const container = mount(<AiSendOverview manifest={manifest} images={[picture]} blind onSend={() => undefined} onCancel={() => undefined} />);
    expect(container.querySelector('[data-testid="ai-overview-blind"]')!.textContent).toBe("According to the provider's list, m-1 reads no images. You can send it all the same.");
    // Said, never a lock: the request can still be sent.
    expect(container.querySelector<HTMLButtonElement>('[data-testid="ai-consent-send"]')!.disabled).toBe(false);
  });

  it("keeps the row as the record afterwards, without drawing the picture again", () => {
    const container = mount(<AiSendOverview manifest={manifest} />);
    expect(container.textContent).toContain("image, 1,568 × 1,045 px, 305 KB");
    expect(container.querySelector('[data-testid="ai-overview-pictures"]')).toBeNull();
  });

  it("speaks German", () => {
    const container = mount(<AiSendOverview manifest={manifest} growth={[{ kind: "dataClass", dataClass: "images" }]} images={[picture]} onSend={() => undefined} onCancel={() => undefined} />, "de");
    expect(container.textContent).toContain("Eine neue Art von Daten: ein Bild");
    expect(container.textContent).toContain("Bild, 1.568 × 1.045 px, 305 KB");
    expect(container.textContent).toContain("ohne Ort, Datum und Kamera, die die Datei festhält");
  });
});

describe("a picture in the conversation", () => {
  it("is drawn from what was sent", () => {
    const container = mount(<AiPicture picture={picture} alt={picture.name} />);
    const img = container.querySelector<HTMLImageElement>("img.pv-ai-picture")!;
    expect(img.getAttribute("src")).toBe("data:image/jpeg;base64,QUJDRA==");
    // Its proportions are known before it is decoded: the thread does not jump.
    expect([img.getAttribute("width"), img.getAttribute("height")]).toEqual(["1568", "1045"]);
    expect(img.getAttribute("draggable")).toBe("false");
  });

  it("stands with the user's question, apart from the words Plainva put before it", () => {
    const at = "2026-10-06T10:00:00Z";
    const record: ConversationRecord = {
      version: 1,
      id: "c",
      title: "Image: Whiteboard.jpg",
      createdAt: at,
      updatedAt: at,
      providerId: "anthropic",
      model: "m-1",
      conversation: {
        ...startConversation("c", "system", ["search_vault"]),
        turns: [
          { role: "user", parts: [{ type: "text", text: "The picture below is the file …", context: [] }, picture, { type: "text", text: "Explain this image." }], at },
          { role: "assistant", parts: [{ type: "text", text: "A whiteboard." }], at },
          { role: "user", parts: [{ type: "text", text: "And the second column?" }], at },
        ],
      },
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      runs: [],
      pins: [],
    };
    const [first, , third] = transcriptOf(record);
    expect(first).toEqual({ kind: "user", key: "u0", text: "Explain this image.", context: [], images: [picture] });
    // A message without a picture carries no empty list.
    expect(third).toEqual({ kind: "user", key: "u2", text: "And the second column?", context: [] });
  });
});
