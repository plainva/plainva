import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebDavSyncTarget } from "../../src/sync/WebDavSyncTarget.js";

describe("WebDavSyncTarget", () => {
  let target: WebDavSyncTarget;
  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn();
    target = new WebDavSyncTarget({
      url: "https://cloud.example.com/remote.php/webdav",
      user: "testuser",
      pass: "testpass"
    }, mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should push write operations correctly", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "ETag": '"abcdef"' })
    });

    const res = await target.push({
      id: 1,
      file_path: "folder/test.md",
      operation: "write",
      content: new Uint8Array([1, 2, 3]),
      retry_count: 0,
      next_retry_at: 0,
      queued_at: 0
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://cloud.example.com/remote.php/webdav/folder/test.md");
    expect(mockFetch.mock.calls[0][1].method).toBe("PUT");
    expect(res).toEqual({ etag: "abcdef" });
  });

  it("creates missing parent collections and retries when PUT answers 404", async () => {
    // Some servers answer 404 (not the RFC's 409) when the parent collection
    // is missing — the maintainer's Nextcloud does. Expect MKCOL + retry.
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: "Not Found" });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 201, statusText: "Created" });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "ETag": '"retry"' })
    });

    const res = await target.push({
      id: 1,
      file_path: "folder/test.md",
      operation: "write",
      content: new Uint8Array([1]),
      retry_count: 0,
      next_retry_at: 0,
      queued_at: 0
    });

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls[1][0]).toBe("https://cloud.example.com/remote.php/webdav/folder/");
    expect(mockFetch.mock.calls[1][1].method).toBe("MKCOL");
    expect(mockFetch.mock.calls[2][1].method).toBe("PUT");
    expect(res).toEqual({ etag: "retry" });
  });

  it("should ignore .CONFLICT files on push", async () => {
    await target.push({
      id: 2,
      file_path: "folder/test.CONFLICT-123.md",
      operation: "write",
      retry_count: 0,
      next_retry_at: 0,
      queued_at: 0
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should parse PROPFIND correctly in pull", async () => {
    const mockXml = `<d:multistatus xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
        <d:response>
          <d:href>/remote.php/webdav/test.md</d:href>
          <d:propstat>
            <d:prop>
              <d:getetag>"12345"</d:getetag>
            </d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
        </d:response>
        <d:response>
          <d:href>/remote.php/webdav/folder/</d:href>
          <d:propstat>
            <d:prop>
              <d:resourcetype><d:collection/></d:resourcetype>
            </d:prop>
          </d:propstat>
        </d:response>
        <d:response>
          <d:href>/remote.php/webdav/folder/ignored.CONFLICT-1.md</d:href>
          <d:propstat>
            <d:prop>
              <d:getetag>"9999"</d:getetag>
            </d:prop>
          </d:propstat>
        </d:response>
      </d:multistatus>
    `;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => mockXml
    });

    const pullRes = await target.pull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][1].method).toBe("PROPFIND");
    expect(mockFetch.mock.calls[0][1].headers.Depth).toBe("infinity");

    expect(pullRes.etagMap.size).toBe(1);
    expect(pullRes.etagMap.get("test.md")).toBe("12345");
  });

  it("ignores the optional cursor argument and always returns a full listing", async () => {
    const mockXml = `<d:multistatus xmlns:d="DAV:">
        <d:response>
          <d:href>/remote.php/webdav/note.md</d:href>
          <d:propstat><d:prop><d:getetag>"aaa"</d:getetag></d:prop></d:propstat>
        </d:response>
      </d:multistatus>`;

    mockFetch.mockResolvedValueOnce({ ok: true, text: async () => mockXml });

    // Passing a cursor must not change behaviour: still a full PROPFIND, and the
    // cursor-only fields (deleted/nextCursor) stay undefined for WebDAV.
    const pullRes = await target.pull("some-opaque-cursor");
    expect(mockFetch.mock.calls[0][1].method).toBe("PROPFIND");
    expect(pullRes.etagMap.get("note.md")).toBe("aaa");
    expect(pullRes.deleted).toBeUndefined();
    expect(pullRes.nextCursor).toBeUndefined();
  });

  // P1.5 — the former regex scan missed exactly these server-dependent shapes.
  // A missed entry feeds the worker's "mirror remote deletions" path, so the
  // parser must survive hostile-but-valid multistatus bodies.
  describe("PROPFIND parsing robustness (real XML parser)", () => {
    const pullWith = async (xml: string) => {
      mockFetch.mockResolvedValueOnce({ ok: true, text: async () => xml });
      return target.pull();
    };

    it("decodes XML entities in hrefs (files with & in the name)", async () => {
      // With the regex parser the key stayed "a&amp;b.md" and never matched the
      // local path — the file then looked remote-deleted on every cycle.
      const res = await pullWith(`<d:multistatus xmlns:d="DAV:">
        <d:response>
          <d:href>/remote.php/webdav/a&amp;b.md</d:href>
          <d:propstat><d:prop><d:getetag>"e1"</d:getetag></d:prop></d:propstat>
        </d:response>
      </d:multistatus>`);
      expect(res.etagMap.get("a&b.md")).toBe("e1");
    });

    it("handles UPPERCASE and mixed namespace prefixes", async () => {
      const res = await pullWith(`<D:multistatus xmlns:D="DAV:" xmlns:lp1="DAV:">
        <D:response>
          <D:href>/remote.php/webdav/upper.md</D:href>
          <D:propstat><D:prop><lp1:getetag>"e2"</lp1:getetag></D:prop></D:propstat>
        </D:response>
      </D:multistatus>`);
      expect(res.etagMap.get("upper.md")).toBe("e2");
    });

    it("handles CDATA-wrapped etags and default-namespace bodies", async () => {
      const res = await pullWith(`<multistatus xmlns="DAV:">
        <response>
          <href>/remote.php/webdav/cdata.md</href>
          <propstat><prop><getetag><![CDATA["e3"]]></getetag></prop></propstat>
        </response>
      </multistatus>`);
      expect(res.etagMap.get("cdata.md")).toBe("e3");
    });

    it("keeps a numeric-looking etag as a string", async () => {
      const res = await pullWith(`<d:multistatus xmlns:d="DAV:">
        <d:response>
          <d:href>/remote.php/webdav/n.md</d:href>
          <d:propstat><d:prop><d:getetag>00123</d:getetag></d:prop></d:propstat>
        </d:response>
      </d:multistatus>`);
      expect(res.etagMap.get("n.md")).toBe("00123");
    });

    it("skips collections even when the resourcetype sits in a second propstat", async () => {
      const res = await pullWith(`<d:multistatus xmlns:d="DAV:">
        <d:response>
          <d:href>/remote.php/webdav/dir/</d:href>
          <d:propstat><d:prop><d:getetag>"dir-etag"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
          <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
        </d:response>
      </d:multistatus>`);
      expect(res.etagMap.size).toBe(0);
    });

    it("throws a descriptive error on an unparseable body instead of returning an empty map", async () => {
      // An empty map from garbage input would look like "remote is empty" —
      // the safe reaction is a sync error, never a silent empty listing.
      mockFetch.mockResolvedValueOnce({ ok: true, text: async () => "<d:multistatus><unclosed" });
      await expect(target.pull()).rejects.toThrow(/unparseable/i);
    });
  });
});
