import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A number a call carries reaches an Android plugin as an Integer when it
 * fits one (org.json), and `PluginCall.getLong` answers anything but a Long
 * with its default. So a byte offset or a size below 2 GB was lost:
 * `WebDavHttpPlugin` streamed every part of a chunked upload from byte 0
 * (since 0.6.5), `LocalModelPlugin` refused every model file under 2 GB.
 * A plugin reads a whole number with `call.getData().optLong(...)`, which
 * takes both; `getLong` is not used.
 */
describe("the Android plugins read whole numbers as they arrive", () => {
  const folder = new URL("../android/app/src/main/java/com/plainva/app/", import.meta.url);
  const sources = readdirSync(folder).filter((name) => name.endsWith(".java"));

  it("finds the plugins", () => {
    expect(sources).toEqual(expect.arrayContaining(["WebDavHttpPlugin.java", "LocalModelPlugin.java", "AtomicFilePlugin.java"]));
  });

  it.each(sources)("%s does not read a number with call.getLong", (name) => {
    expect(readFileSync(new URL(name, folder), "utf8")).not.toMatch(/\bcall\.getLong\(/);
  });

  it("the streamed upload's range and the model size are read with optLong", () => {
    const http = readFileSync(new URL("WebDavHttpPlugin.java", folder), "utf8");
    expect(http).toMatch(/optLong\("bodyOffset", 0L\)/);
    expect(http).toMatch(/optLong\("bodyLength"/);
    expect(readFileSync(new URL("LocalModelPlugin.java", folder), "utf8")).toMatch(/optLong\("bytes", 0L\)/);
  });
});
