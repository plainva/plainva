import { describe, it, expect } from "vitest";
import { isInsecurePublicUrl } from "@plainva/ui";

/**
 * The warning must fire on exactly one case: plain http to a host outside the
 * user's own network. Everything else stays quiet — a warning that also fires
 * on `http://192.168.1.5` is a warning people learn to ignore, and then it is
 * worth nothing on the day it matters (issue #48).
 */
describe("isInsecurePublicUrl", () => {
  it("warns about plain http to a public host", () => {
    expect(isInsecurePublicUrl("http://cloud.example.com/remote.php/dav/")).toBe(true);
    expect(isInsecurePublicUrl("http://203.0.113.9:8080/dav")).toBe(true);
  });

  it("stays quiet on https, whatever the host", () => {
    expect(isInsecurePublicUrl("https://cloud.example.com")).toBe(false);
    expect(isInsecurePublicUrl("https://192.168.1.5:8443")).toBe(false);
  });

  it("stays quiet inside a private network — that is the case we deliberately allow", () => {
    for (const u of [
      "http://192.168.1.5:8082/plainva",
      "http://10.0.0.4/dav",
      "http://172.16.5.9/dav",
      "http://172.31.255.254/dav",
      "http://127.0.0.1:9000",
      "http://localhost:8080",
      "http://nas.local/webdav",
      "http://truenas.lan:8080",
      "http://caddy/plainva", // bare hostname: cannot be public
      "http://[::1]:8080",
      "http://[fd12:3456::1]/dav",
      "http://100.71.4.2:8080", // CGNAT range — Tailscale and friends
    ]) {
      expect(isInsecurePublicUrl(u), u).toBe(false);
    }
  });

  it("does not mistake a neighbouring range for a private one", () => {
    // 172.15 and 172.32 sit just outside 172.16/12; 11.x is not 10.x.
    expect(isInsecurePublicUrl("http://172.15.0.1/dav")).toBe(true);
    expect(isInsecurePublicUrl("http://172.32.0.1/dav")).toBe(true);
    expect(isInsecurePublicUrl("http://11.0.0.1/dav")).toBe(true);
    expect(isInsecurePublicUrl("http://100.128.0.1/dav")).toBe(true); // above CGNAT
  });

  it("says nothing while the address is still being typed", () => {
    for (const u of ["", "   ", "http:/", "cloud.example.com", "htt"]) {
      expect(isInsecurePublicUrl(u), JSON.stringify(u)).toBe(false);
    }
  });
});
