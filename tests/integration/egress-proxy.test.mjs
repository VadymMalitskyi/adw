import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  clientHelloMatchesHost,
  extractClientHelloSni,
  loadAllowedDomains,
  parseConnectAuthority,
} from "../../plugin/templates/devcontainer/egress-proxy.mjs";

function uint24(value) {
  const output = Buffer.alloc(3);
  output.writeUIntBE(value, 0, 3);
  return output;
}

function clientHello(hostname) {
  const name = Buffer.from(hostname, "ascii");
  const serverName = Buffer.concat([Buffer.from([0]), Buffer.from([name.length >> 8, name.length & 0xff]), name]);
  const serverNameList = Buffer.concat([Buffer.from([serverName.length >> 8, serverName.length & 0xff]), serverName]);
  const extension = Buffer.concat([Buffer.from([0, 0, serverNameList.length >> 8, serverNameList.length & 0xff]), serverNameList]);
  const body = Buffer.concat([
    Buffer.from([3, 3]),
    Buffer.alloc(32),
    Buffer.from([0]),
    Buffer.from([0, 2, 0x13, 0x01]),
    Buffer.from([1, 0]),
    Buffer.from([extension.length >> 8, extension.length & 0xff]),
    extension,
  ]);
  const handshake = Buffer.concat([Buffer.from([1]), uint24(body.length), body]);
  return Buffer.concat([Buffer.from([22, 3, 1, handshake.length >> 8, handshake.length & 0xff]), handshake]);
}

test("egress proxy accepts only exact DNS CONNECT authorities", () => {
  assert.deepEqual(parseConnectAuthority("api.openai.com:443"), { host: "api.openai.com", port: 443 });
  assert.deepEqual(parseConnectAuthority("API.OPENAI.COM.:443"), { host: "api.openai.com", port: 443 });
  assert.equal(new Set(["api.openai.com"]).has(parseConnectAuthority("openai.com.evil.example:443").host), false);
  for (const authority of ["127.0.0.1:443", "[::1]:443", "api.openai.com:0", "user@api.openai.com:443", "api.openai.com:443/path"]) {
    assert.equal(parseConnectAuthority(authority), null, authority);
  }
});

test("egress proxy rejects invalid allowlists and normalizes exact hostnames", () => {
  const root = mkdtempSync(join(tmpdir(), "adw-egress-"));
  const valid = join(root, "valid.txt");
  writeFileSync(valid, "# selected service\nAPI.OPENAI.COM.\napi.openai.com\n");
  assert.deepEqual([...loadAllowedDomains(valid)], ["api.openai.com"]);
  const invalid = join(root, "invalid.txt");
  writeFileSync(invalid, "*.openai.com\n");
  assert.throws(() => loadAllowedDomains(invalid), /invalid allowed domain/);
});

test("TLS ClientHello parsing binds a tunnel to its exact SNI", () => {
  const hello = clientHello("api.openai.com");
  assert.deepEqual(extractClientHelloSni(hello), { sni: "api.openai.com" });
  assert.equal(clientHelloMatchesHost(hello, "api.openai.com"), true);
  assert.equal(clientHelloMatchesHost(hello, "example.com"), false);
  assert.deepEqual(extractClientHelloSni(hello.subarray(0, 20)), { incomplete: true });
  const noHandshake = Buffer.from(hello);
  noHandshake[0] = 23;
  assert.match(extractClientHelloSni(noHandshake).invalid, /not a handshake/);
});
