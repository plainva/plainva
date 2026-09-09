import { describe, expect, it, vi } from "vitest";
import { parseMultistatus, WebDavSyncTarget } from "../../src/sync/WebDavSyncTarget.js";
import { parseCalDavMultistatus, parseCalDavSyncCollection } from "../../src/pim/CalDavPimTarget.js";
import { S3SyncTarget } from "../../src/sync/S3SyncTarget.js";

describe("a failed inventory must never become an empty one", () => {
  const invalidDav = [
    "<html><body>Please sign in</body></html>",
    "<error><message>Unavailable</message></error>",
    "<wrapper><multistatus/></wrapper>",
    "<multistatus>sign in</multistatus>",
    "<multistatus><html/></multistatus>",
    "<multistatus><response><propstat/></response></multistatus>",
    "<multistatus><response>",
  ];
  for (const [name, parse] of [["WebDAV", parseMultistatus], ["CalDAV", parseCalDavMultistatus], ["CalDAV changes", parseCalDavSyncCollection]] as const) {
    it.each(invalidDav)(`${name} rejects %s`, (xml) => { expect(() => parse(xml)).toThrow(); });
    it(`${name} accepts an explicitly empty namespaced multistatus`, () => {
      const result = parse('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"/>');
      expect(result).toEqual(name === "CalDAV changes" ? { changed: [], removed: [], token: "" } : []);
    });
  }

  it("WebDAV pull propagates a login page as an error", async () => {
    const target = new WebDavSyncTarget({ url: "https://dav.example/", user: "test", pass: "test" }, async () => new Response(invalidDav[0], { status: 207 }));
    await expect(target.pull()).rejects.toThrow();
  });

  const s3 = (body: string) => new S3SyncTarget({ endpoint: "https://s3.example", bucket: "test", region: "test", accessKeyId: "fixture", secretAccessKey: "fixture" }, async () => new Response(body));
  it.each([
    invalidDav[0],
    "<ListBucketResult>",
    "<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>",
    "<ListBucketResult><IsTruncated>false</IsTruncated><Contents><ETag>x</ETag></Contents></ListBucketResult>",
    "<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>lost.md</Key></Contents></ListBucketResult>",
  ])("S3 refuses an incomplete inventory for both files and folders: %s", async (xml) => {
    await expect(s3(xml).pull()).rejects.toThrow();
    await expect(s3(xml).listFolders("")).rejects.toThrow();
  });

  it("S3 reads namespaced entries and entities without dropping numeric names", async () => {
    const target = s3('<s:ListBucketResult xmlns:s="urn:s3"><s:IsTruncated>false</s:IsTruncated><s:Contents><s:Key>123&amp;.md</s:Key><s:ETag>&quot;456&quot;</s:ETag></s:Contents></s:ListBucketResult>');
    expect((await target.pull()).etagMap).toEqual(new Map([["123&.md", "456"]]));
    expect((await s3("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>").pull()).etagMap.size).toBe(0);
  });

  it("S3 fails a repeated page token instead of finishing a partial inventory", async () => {
    const target = s3("<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>again</NextContinuationToken></ListBucketResult>");
    await expect(target.pull()).rejects.toThrow("repeated continuation token");
  });

  it("S3 does not delete anything after an invalid child listing", async () => {
    const fetch = vi.fn(async () => new Response(invalidDav[0]));
    const target = new S3SyncTarget({ endpoint: "https://s3.example", bucket: "test", region: "test", accessKeyId: "fixture", secretAccessKey: "fixture" }, fetch);
    await expect(target.push({ id: 1, file_path: "folder", operation: "delete", retry_count: 0, next_retry_at: 0, queued_at: 0 })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
