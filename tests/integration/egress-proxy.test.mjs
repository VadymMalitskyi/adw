import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import test from "node:test";
import {
  clientHelloMatchesHost,
  extractClientHelloSni,
  isPublicIpv4,
  loadAgentTools,
  loadAllowedDomains,
  loadWebAccess,
  parseClaudeWebFetchRequest,
  parseConnectAuthority,
  proxyWebFetch,
  resolvePublicIpv4,
  safeRedirectLocation,
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

  const agents = join(root, "agents.txt");
  writeFileSync(agents, "both\n");
  assert.equal(loadAgentTools(agents), "both");
  writeFileSync(agents, "other\n");
  assert.throws(() => loadAgentTools(agents), /invalid agent tools profile/);
  writeFileSync(agents, "public-pages\n");
  assert.equal(loadWebAccess(agents), "public-pages");
  writeFileSync(agents, "open\n");
  assert.throws(() => loadWebAccess(agents), /invalid web access profile/);
});

test("Claude WebFetch forward requests are limited to public HTTPS GET and HEAD", () => {
  const headers = {
    "user-agent": "Claude-User (claude-code/2.1.222; +https://support.anthropic.com/)",
    accept: "text/markdown, text/html, */*",
  };
  const parsed = parseClaudeWebFetchRequest({ method: "GET", url: "https://Docs.Example.com:443/guide?q=one#ignored", headers });
  assert.equal(parsed.host, "docs.example.com");
  assert.equal(parsed.url.toString(), "https://docs.example.com/guide?q=one");
  assert.equal(parseClaudeWebFetchRequest({ method: "HEAD", url: "https://docs.example.com/", headers }).method, "HEAD");
  assert.equal(parseClaudeWebFetchRequest({ method: "GET", url: "https://docs.example.com/", headers: { ...headers, accept: "text/markdown;q=0.9, text/html;q=0.8" } }).method, "GET");
  for (const input of [
    { method: "POST", url: "https://docs.example.com/", headers },
    { method: "GET", url: "http://docs.example.com/", headers },
    { method: "GET", url: "https://user:secret@docs.example.com/", headers },
    { method: "GET", url: "https://docs.example.com:8443/", headers },
    { method: "GET", url: "https://127.0.0.1/", headers },
    { method: "GET", url: "https://docs.example.com/", headers: { ...headers, "user-agent": "curl/8" } },
    { method: "GET", url: "https://docs.example.com/", headers: { ...headers, accept: "application/octet-stream" } },
  ]) assert.equal(parseClaudeWebFetchRequest(input), null, JSON.stringify(input));
});

test("Claude WebFetch permits only same-origin HTTPS redirects", () => {
  const original = new URL("https://docs.example.com/guide");
  assert.equal(safeRedirectLocation(302, "/next", original), "/next");
  assert.equal(safeRedirectLocation(301, "https://docs.example.com:443/next", original), "https://docs.example.com:443/next");
  assert.equal(safeRedirectLocation(302, "https://other.example.com/next", original), null);
  assert.equal(safeRedirectLocation(302, "http://docs.example.com/next", original), null);
  assert.equal(safeRedirectLocation(200, "https://other.example.com/next", original), "https://other.example.com/next");
});

test("Claude WebFetch DNS pinning rejects private, reserved, mixed, and IPv6 destinations", async () => {
  for (const address of ["1.1.1.1", "8.8.8.8", "93.184.216.34"]) assert.equal(isPublicIpv4(address), true, address);
  for (const address of ["0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1", "192.0.2.1", "192.168.1.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::1"]) {
    assert.equal(isPublicIpv4(address), false, address);
  }
  assert.equal(await resolvePublicIpv4("docs.example.com", async () => [{ address: "93.184.216.34", ttl: 60 }]), "93.184.216.34");
  await assert.rejects(resolvePublicIpv4("private.example.com", async () => [{ address: "10.0.0.1", ttl: 60 }]), /exclusively to public IPv4/);
  await assert.rejects(resolvePublicIpv4("mixed.example.com", async () => [{ address: "93.184.216.34", ttl: 60 }, { address: "127.0.0.1", ttl: 60 }]), /exclusively to public IPv4/);
  await assert.rejects(resolvePublicIpv4("empty.example.com", async () => []), /exclusively to public IPv4/);
});

test("Claude WebFetch proxy pins TLS and strips request and response credentials", async () => {
  let upstreamOptions;
  const httpsRequest = (options, callback) => {
    upstreamOptions = options;
    const request = new EventEmitter();
    request.destroy = () => {};
    queueMicrotask(() => {
      const response = Readable.from(["page body"]);
      response.statusCode = 200;
      response.headers = { "content-type": "text/html", "set-cookie": "secret=one", "x-private": "drop" };
      callback(response);
    });
    return request;
  };
  const headers = {
    "user-agent": "Claude-User (claude-code/2.1.222; +https://support.anthropic.com/)",
    accept: "text/markdown, text/html, */*",
    authorization: "Bearer must-not-leave",
    cookie: "must-not-leave=one",
    "x-untrusted": "must-not-leave",
  };
  const target = parseClaudeWebFetchRequest({ method: "GET", url: "https://docs.example.com/guide?q=one", headers });
  const request = new EventEmitter();
  const response = new PassThrough();
  const chunks = [];
  response.statusCode = null;
  response.headers = {};
  response.writeHead = (statusCode, outputHeaders) => {
    response.statusCode = statusCode;
    response.headers = outputHeaders;
  };
  response.on("data", (chunk) => chunks.push(chunk));
  proxyWebFetch(request, response, target, { resolveHost: async () => "93.184.216.34", httpsRequest });
  await once(response, "finish");

  assert.equal(response.statusCode, 200);
  assert.equal(Buffer.concat(chunks).toString("utf8"), "page body");
  assert.equal(response.headers["content-type"], "text/html");
  assert.equal(response.headers["set-cookie"], undefined);
  assert.equal(response.headers["x-private"], undefined);
  assert.deepEqual(upstreamOptions.headers, {
    Host: "docs.example.com",
    Accept: "text/markdown, text/html, */*",
    "Accept-Encoding": "identity",
    "User-Agent": headers["user-agent"],
  });
  assert.equal(upstreamOptions.hostname, "93.184.216.34");
  assert.equal(upstreamOptions.servername, "docs.example.com");
  assert.equal(upstreamOptions.path, "/guide?q=one");
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
