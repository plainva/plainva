import { describe, it, expect } from "vitest";
import { signS3Request, sha256Hex, encodeS3Key, rfc3986Encode } from "../../src/sync/sigv4.js";

/**
 * The four official AWS SigV4 examples for S3 ("Examples of the Complete Version 4
 * Signing Process", examplebucket, 2013-05-24). Reproducing their published
 * signatures verifies the whole chain: canonical request, string-to-sign, signing
 * key derivation and header assembly.
 */
const CREDS = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
};
const NOW = new Date(Date.UTC(2013, 4, 24, 0, 0, 0));
const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("sigv4", () => {
  it("reproduces the official GET-object example (extra signed range header)", async () => {
    const { headers } = await signS3Request({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      canonicalUri: "/test.txt",
      headers: { range: "bytes=0-9" },
      payloadHash: EMPTY_HASH,
      credentials: CREDS,
      now: NOW,
    });
    expect(headers["x-amz-date"]).toBe("20130524T000000Z");
    expect(headers["Authorization"]).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
    );
  });

  it("reproduces the official GET-bucket-lifecycle example (empty query value)", async () => {
    const { headers } = await signS3Request({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      canonicalUri: "/",
      queryParams: { lifecycle: "" },
      payloadHash: EMPTY_HASH,
      credentials: CREDS,
      now: NOW,
    });
    expect(headers["Authorization"]).toContain(
      "Signature=fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543"
    );
  });

  it("reproduces the official list-objects example (sorted multi-param query)", async () => {
    const { headers } = await signS3Request({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      canonicalUri: "/",
      queryParams: { "max-keys": "2", prefix: "J" },
      payloadHash: EMPTY_HASH,
      credentials: CREDS,
      now: NOW,
    });
    expect(headers["Authorization"]).toContain(
      "Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7"
    );
  });

  it("reproduces the official PUT-object example ($ in key, extra headers, payload hash)", async () => {
    const payload = "Welcome to Amazon S3.";
    const payloadHash = await sha256Hex(payload);
    expect(payloadHash).toBe("44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072");

    const { headers } = await signS3Request({
      method: "PUT",
      host: "examplebucket.s3.amazonaws.com",
      canonicalUri: "/" + encodeS3Key("test$file.text"),
      headers: {
        date: "Fri, 24 May 2013 00:00:00 GMT",
        "x-amz-storage-class": "REDUCED_REDUNDANCY",
      },
      payloadHash,
      credentials: CREDS,
      now: NOW,
    });
    expect(headers["Authorization"]).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, " +
        "Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd"
    );
  });

  it("percent-encodes keys per RFC 3986 (segments only, slash kept)", () => {
    expect(encodeS3Key("test$file.text")).toBe("test%24file.text");
    expect(encodeS3Key("a folder/über (1)*.md")).toBe("a%20folder/%C3%BCber%20%281%29%2A.md");
    expect(rfc3986Encode("a b!c'd(e)f*g~h-i_j.k")).toBe("a%20b%21c%27d%28e%29f%2Ag~h-i_j.k");
  });
});
