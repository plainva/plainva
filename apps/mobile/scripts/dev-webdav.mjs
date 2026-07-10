// Local WebDAV test server for the mobile sync roundtrip (M3, dev only).
//   node scripts/dev-webdav.mjs
// Serves ./.webdav-data on http://0.0.0.0:1900 with Basic auth
// plainva / test. From the Android emulator use http://10.0.2.2:1900
// (cleartext http is allowed in DEBUG builds only).
import { mkdirSync } from "node:fs";
import { v2 as webdav } from "webdav-server";

const ROOT = new URL("../.webdav-data", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
mkdirSync(ROOT, { recursive: true });

const users = new webdav.SimpleUserManager();
const user = users.addUser("plainva", "test", false);
const privileges = new webdav.SimplePathPrivilegeManager();
privileges.setRights(user, "/", ["all"]);

const server = new webdav.WebDAVServer({
  port: 1900,
  hostname: "0.0.0.0",
  httpAuthentication: new webdav.HTTPBasicAuthentication(users, "plainva"),
  privilegeManager: privileges,
});

server.setFileSystem("/", new webdav.PhysicalFileSystem(ROOT), () => {
  server.start(() => {
    console.log("WebDAV test server: http://localhost:1900  (user: plainva / pass: test)");
    console.log(`Serving ${ROOT}`);
    console.log("Android emulator URL: http://10.0.2.2:1900");
  });
});
