import { describe, expect, it, vi } from "vitest";
// @ts-expect-error -- a plain Node script without type declarations
import { releaseToExternalTesters } from "../scripts/testflight-what-to-test.mjs";

/**
 * Handing a TestFlight build to the testers outside the team.
 *
 * Release 0.8.4: the workflow put build 125 into the public group, but nobody
 * submitted it for Apple's beta review, so it sat at READY_FOR_BETA_SUBMISSION
 * and reached no one until it was submitted by hand. The flag now does both,
 * in the order Apple needs — and this is the only place that order can be
 * checked without a real upload.
 */

type Call = [method: string, path: string, body?: unknown];

function connect(state: string | null, groups = [{ id: "g1", attributes: { name: "Preview", publicLinkEnabled: false } }, { id: "g2", attributes: { name: "Public Preview", publicLinkEnabled: true } }]) {
  const calls: Call[] = [];
  const request = vi.fn(async (method: string, path: string, body?: unknown): Promise<unknown> => {
    calls.push(body === undefined ? [method, path] : [method, path, body]);
    if (method === "GET" && path.startsWith("/betaGroups")) return { data: groups };
    if (method === "GET" && path.endsWith("/buildBetaDetail")) return { data: { attributes: { externalBuildState: state } } };
    return null;
  });
  return { request, calls };
}

describe("the public group flag", () => {
  it("adds the build to every external group first, then submits it for beta review", async () => {
    const asc = connect("READY_FOR_BETA_SUBMISSION");
    const result = await releaseToExternalTesters(asc.request, "app1", "build1", "126", () => {});
    expect(asc.calls.map(([method, path]) => `${method} ${path}`)).toEqual([
      "GET /betaGroups?filter[app]=app1&filter[isInternalGroup]=false",
      "POST /betaGroups/g1/relationships/builds",
      "POST /betaGroups/g2/relationships/builds",
      "GET /builds/build1/buildBetaDetail",
      "POST /betaAppReviewSubmissions",
    ]);
    expect(asc.calls[asc.calls.length - 1][2]).toEqual({ data: { type: "betaAppReviewSubmissions", relationships: { build: { data: { type: "builds", id: "build1" } } } } });
    expect(result).toEqual({ groups: ["g1", "g2"], submitted: true, state: "READY_FOR_BETA_SUBMISSION" });
  });

  it.each(["WAITING_FOR_BETA_REVIEW", "IN_BETA_REVIEW", "BETA_APPROVED", "IN_BETA_TESTING", "PROCESSING", null])(
    "does not submit a build that is %s, and says so",
    async (state) => {
      const asc = connect(state);
      const said: string[] = [];
      const result = await releaseToExternalTesters(asc.request, "app1", "build1", "126", (line: string) => said.push(line));
      expect(asc.calls.some(([method, path]) => method === "POST" && path === "/betaAppReviewSubmissions")).toBe(false);
      expect(result.submitted).toBe(false);
      expect(said[said.length - 1]).toContain("not submitted for beta review");
    },
  );

  it("submits nothing when there is no external group to review the build for", async () => {
    const asc = connect("READY_FOR_BETA_SUBMISSION", []);
    const result = await releaseToExternalTesters(asc.request, "app1", "build1", "126", () => {});
    expect(asc.calls).toHaveLength(1);
    expect(result).toEqual({ groups: [], submitted: false, state: null });
  });

  it("lets a refusal by Apple fail the step instead of reporting a release that did not happen", async () => {
    const asc = connect("READY_FOR_BETA_SUBMISSION");
    asc.request.mockImplementation(async (method: string, path: string) => {
      if (method === "GET" && path.startsWith("/betaGroups")) return { data: [{ id: "g1", attributes: { name: "Preview" } }] };
      if (method === "GET") return { data: { attributes: { externalBuildState: "READY_FOR_BETA_SUBMISSION" } } };
      if (path === "/betaAppReviewSubmissions") throw new Error("POST /betaAppReviewSubmissions -> 409 ENTITY_ERROR");
      return null;
    });
    await expect(releaseToExternalTesters(asc.request, "app1", "build1", "126", () => {})).rejects.toThrow("409");
  });
});
