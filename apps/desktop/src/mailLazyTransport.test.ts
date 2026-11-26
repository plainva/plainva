import { describe, expect, it } from "vitest";
import { createLazySocketMailTransport, createSocketMailTransport, SOCKET_TRANSPORT_METHODS } from "@plainva/ui/mail";

/**
 * The phone's IMAP/SMTP transport loads with its first call (performance plan L5). It must offer exactly the methods
 * of the socket transport: the mail client asks for an optional one (`bulkAction`) by its presence, and a method the
 * stand-in lacked would quietly switch a feature off.
 */
describe("the lazily loaded socket transport", () => {
  it("offers exactly the methods of the socket transport", () => {
    expect.hasAssertions();
    expect([...SOCKET_TRANSPORT_METHODS].sort()).toEqual(Object.keys(createSocketMailTransport()).sort());
    expect(Object.keys(createLazySocketMailTransport()).sort()).toEqual([...SOCKET_TRANSPORT_METHODS].sort());
  });

});
