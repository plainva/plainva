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
    expect(sources).toEqual(expect.arrayContaining(["WebDavHttpPlugin.java", "LocalModelPlugin.java", "AtomicFilePlugin.java", "DevicePimPlugin.java", "JsNumbers.java"]));
  });

  it.each(sources)("%s reads a number a call carries only through JsNumbers", (name) => {
    const source = readFileSync(new URL(name, folder), "utf8");
    // getInt, getLong, getDouble and getFloat each answer every other kind of number with their default:
    // a time in milliseconds is a Long, an offset below 2 GB an Integer (F55).
    expect(source).not.toMatch(/\bcall\.get(?:Int|Long|Double|Float)\(/);
    expect(source).not.toMatch(/\bcall\.getData\(\)\.opt(?:Int|Long|Double)\(/);
  });

  it("the reader takes every kind of number and says when there is none", () => {
    const reader = readFileSync(new URL("JsNumbers.java", folder), "utf8");
    expect(reader).toMatch(/if \(!\(value instanceof Number\)\) return null;/);
    expect(reader).toMatch(/d != Math\.rint\(d\)/);
  });

  it("the streamed upload's range, the model size and the calendar's times go through it", () => {
    const http = readFileSync(new URL("WebDavHttpPlugin.java", folder), "utf8");
    expect(http).toMatch(/JsNumbers\.whole\(call, "bodyOffset", 0L\)/);
    expect(http).toMatch(/JsNumbers\.whole\(call, "bodyLength"/);
    expect(readFileSync(new URL("LocalModelPlugin.java", folder), "utf8")).toMatch(/JsNumbers\.whole\(call, "bytes"\)/);
    const pim = readFileSync(new URL("DevicePimPlugin.java", folder), "utf8");
    expect(pim).toMatch(/JsNumbers\.whole\(call, "fromTs"\)/);
  });

  it("deleting one occurrence whose time cannot be read deletes nothing, never the whole series", () => {
    const pim = readFileSync(new URL("DevicePimPlugin.java", folder), "utf8");
    const body = pim.slice(pim.indexOf("public void deleteEvent("));
    expect(body.indexOf('call.reject("occurrenceStartTs must be a whole number")')).toBeGreaterThan(-1);
    expect(body.indexOf('call.reject("occurrenceStartTs must be a whole number")')).toBeLessThan(body.indexOf("cr.delete("));
  });
});
