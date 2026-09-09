// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useCommentShell } from "./useCommentShell";
import type { MobileVault } from "../services/vaultService";

vi.mock("./useCommentNotifierDeps", () => ({ useCommentNotifierDeps() {} }));
vi.mock("./useCommentMoves", () => ({ useCommentMoves() {} }));
vi.mock("./useCommentFaults", () => ({ useCommentFaults() {} }));
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); });

it("routes workspace keys separately from the older history and follows a vault change", async () => {
  const navigate = vi.fn();
  function Harness({ vault }: { vault: MobileVault }) { useCommentShell(vault, navigate); return null; }
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  const workspace = { workspaceState: {} } as MobileVault;
  await act(async () => root!.render(<Harness vault={workspace} />));
  window.dispatchEvent(new CustomEvent("m-comments-unlock"));
  expect(navigate).toHaveBeenLastCalledWith({ kind: "settingsArea", path: "security" });
  window.dispatchEvent(new CustomEvent("m-comments-unlock", { detail: { legacy: true } }));
  expect(navigate).toHaveBeenLastCalledWith({ kind: "sync", path: "" });
  await act(async () => root!.render(<Harness vault={{ workspaceState: null } as MobileVault} />));
  window.dispatchEvent(new CustomEvent("m-comments-unlock"));
  expect(navigate).toHaveBeenLastCalledWith({ kind: "sync", path: "" });
  expect(navigate).toHaveBeenCalledTimes(3);
});
