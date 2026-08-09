#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve4 } from "node:dns/promises";
import { createServer as createHttpServer } from "node:http";
import { request as requestHttps } from "node:https";
import { connect as connectTcp, isIP } from "node:net";
import { resolve } from "node:path";
import { checkServerIdentity } from "node:tls";
import { fileURLToPath } from "node:url";

const DEFAULT_ALLOWLIST = "/etc/adw/allowed-domains.txt";
const DEFAULT_AGENT_TOOLS = "/etc/adw/agent-tools";
const DEFAULT_WEB_ACCESS = "/etc/adw/web-access";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 18080;
const MAX_CLIENT_HELLO = 65_536;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const WEB_FETCH_TIMEOUT_MS = 20_000;
const WEB_FETCH_DNS_TIMEOUT_MS = 5_000;
const MAX_WEB_FETCH_BYTES = 20 * 1024 * 1024;
const MAX_WEB_FETCH_URL_BYTES = 16_384;
const MAX_CONCURRENT_WEB_FETCHES = 8;
const DNS_NAME = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const CLAUDE_WEB_FETCH_USER_AGENT = /^Claude-User \([^\r\n]+\)$/;
const PRIVATE_IPV4_NETWORKS = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
];

function normalizeDnsName(value) {
  const name = String(value ?? "").toLowerCase().replace(/\.$/, "");
  if (!DNS_NAME.test(name) || !name.includes(".") || name.includes("..") || isIP(name) !== 0) return null;
  return name;
}

export function loadAllowedDomains(path = DEFAULT_ALLOWLIST) {
  const domains = new Set();
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const domain = normalizeDnsName(line);
    if (!domain) throw new Error(`invalid allowed domain: ${JSON.stringify(line)}`);
    domains.add(domain);
  }
  if (domains.size === 0) throw new Error("the egress allowlist is empty");
  return domains;
}

export function loadAgentTools(path = DEFAULT_AGENT_TOOLS) {
  const value = readFileSync(path, "utf8").trim();
  if (!["codex", "claude", "both"].includes(value)) throw new Error(`invalid agent tools profile: ${JSON.stringify(value)}`);
  return value;
}

export function loadWebAccess(path = DEFAULT_WEB_ACCESS) {
  const value = readFileSync(path, "utf8").trim();
  if (!["hosted-only", "public-pages"].includes(value)) throw new Error(`invalid web access profile: ${JSON.stringify(value)}`);
  return value;
}

export function parseConnectAuthority(authority) {
  const match = /^([^:@/\s]+):(\d{1,5})$/.exec(authority ?? "");
  if (!match) return null;
  const host = normalizeDnsName(match[1]);
  const port = Number(match[2]);
  if (!host || port < 1 || port > 65_535) return null;
  return { host, port };
}

function readUInt16(buffer, offset) {
  if (offset + 2 > buffer.length) return null;
  return buffer.readUInt16BE(offset);
}

function clientHelloPayload(raw) {
  const chunks = [];
  let payloadLength = 0;
  let offset = 0;
  while (offset + 5 <= raw.length) {
    if (raw[offset] !== 22) return { invalid: "first TLS flight is not a handshake" };
    const recordLength = readUInt16(raw, offset + 3);
    if (recordLength === null || recordLength === 0) return { invalid: "invalid TLS record" };
    if (offset + 5 + recordLength > raw.length) return { incomplete: true };
    chunks.push(raw.subarray(offset + 5, offset + 5 + recordLength));
    payloadLength += recordLength;
    const payload = Buffer.concat(chunks, payloadLength);
    if (payload.length >= 4) {
      if (payload[0] !== 1) return { invalid: "first TLS handshake is not ClientHello" };
      const helloLength = payload.readUIntBE(1, 3);
      if (helloLength + 4 > MAX_CLIENT_HELLO) return { invalid: "TLS ClientHello is too large" };
      if (payload.length >= helloLength + 4) return { payload: payload.subarray(4, helloLength + 4) };
    }
    offset += 5 + recordLength;
  }
  return { incomplete: true };
}

export function extractClientHelloSni(raw) {
  const result = clientHelloPayload(raw);
  if (!result.payload) return result;
  const hello = result.payload;
  let offset = 2 + 32;
  if (offset + 1 > hello.length) return { invalid: "truncated TLS ClientHello" };
  offset += 1 + hello[offset];
  const cipherLength = readUInt16(hello, offset);
  if (cipherLength === null) return { invalid: "truncated TLS cipher suites" };
  offset += 2 + cipherLength;
  if (offset + 1 > hello.length) return { invalid: "truncated TLS compression methods" };
  offset += 1 + hello[offset];
  const extensionsLength = readUInt16(hello, offset);
  if (extensionsLength === null || offset + 2 + extensionsLength > hello.length) return { invalid: "truncated TLS extensions" };
  offset += 2;
  const extensionsEnd = offset + extensionsLength;
  while (offset + 4 <= extensionsEnd) {
    const type = readUInt16(hello, offset);
    const length = readUInt16(hello, offset + 2);
    offset += 4;
    if (length === null || offset + length > extensionsEnd) return { invalid: "truncated TLS extension" };
    if (type === 0) {
      const listEnd = offset + length;
      const listLength = readUInt16(hello, offset);
      offset += 2;
      if (listLength === null || offset + listLength !== listEnd) return { invalid: "invalid TLS server-name list" };
      while (offset + 3 <= listEnd) {
        const nameType = hello[offset];
        const nameLength = readUInt16(hello, offset + 1);
        offset += 3;
        if (nameLength === null || offset + nameLength > listEnd) return { invalid: "truncated TLS server name" };
        if (nameType === 0) {
          const sni = normalizeDnsName(hello.subarray(offset, offset + nameLength).toString("ascii"));
          return sni ? { sni } : { invalid: "invalid TLS server name" };
        }
        offset += nameLength;
      }
      return { invalid: "TLS ClientHello has no DNS server name" };
    }
    offset += length;
  }
  return { invalid: "TLS ClientHello has no SNI extension" };
}

export function clientHelloMatchesHost(raw, expectedHost) {
  const result = extractClientHelloSni(raw);
  return result.sni === normalizeDnsName(expectedHost);
}

function ipv4Number(address) {
  if (isIP(address) !== 4) return null;
  return address.split(".").reduce((value, octet) => (value * 256) + Number(octet), 0) >>> 0;
}

export function isPublicIpv4(address) {
  const value = ipv4Number(address);
  if (value === null) return false;
  return !PRIVATE_IPV4_NETWORKS.some(([network, prefix]) => {
    const base = ipv4Number(network);
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (base & mask);
  });
}

export function parseClaudeWebFetchRequest({ method, url, headers = {} } = {}) {
  if (method !== "GET" && method !== "HEAD") return null;
  const userAgent = String(headers["user-agent"] ?? headers["User-Agent"] ?? "");
  const accept = String(headers.accept ?? headers.Accept ?? "");
  const acceptedMedia = new Set(accept.split(",").map((part) => part.split(";", 1)[0].trim().toLowerCase()));
  if (!CLAUDE_WEB_FETCH_USER_AGENT.test(userAgent) || (!acceptedMedia.has("text/markdown") && !acceptedMedia.has("text/html"))) return null;
  if (typeof url !== "string" || Buffer.byteLength(url, "utf8") > MAX_WEB_FETCH_URL_BYTES) return null;
  let target;
  try { target = new URL(url); }
  catch { return null; }
  const host = normalizeDnsName(target.hostname);
  if (target.protocol !== "https:" || target.username || target.password || (target.port && target.port !== "443") || !host || isIP(host) !== 0) return null;
  target.hostname = host;
  target.port = "";
  target.hash = "";
  return { method, url: target, host, userAgent, accept };
}

export async function resolvePublicIpv4(host, resolveDns = resolve4) {
  let timeout;
  const records = await Promise.race([
    resolveDns(host, { ttl: true }),
    new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`web fetch DNS resolution timed out: ${host}`)), WEB_FETCH_DNS_TIMEOUT_MS); }),
  ]).finally(() => clearTimeout(timeout));
  const addresses = records.map((record) => typeof record === "string" ? record : record.address);
  if (addresses.length === 0 || addresses.some((address) => !isPublicIpv4(address))) {
    throw new Error(`web fetch target did not resolve exclusively to public IPv4 addresses: ${host}`);
  }
  return addresses[0];
}

export function safeRedirectLocation(statusCode, location, originalUrl) {
  if (statusCode < 300 || statusCode > 399 || location === undefined) return location;
  const raw = Array.isArray(location) ? location[0] : location;
  let target;
  try { target = new URL(raw, originalUrl); }
  catch { return null; }
  if (target.protocol !== "https:" || normalizeDnsName(target.hostname) !== normalizeDnsName(originalUrl.hostname) || (target.port && target.port !== "443")) return null;
  return raw;
}

export function proxyWebFetch(request, response, target, { resolveHost = resolvePublicIpv4, httpsRequest = requestHttps } = {}) {
  resolveHost(target.host).then((address) => {
    const upstream = httpsRequest({
      protocol: "https:",
      hostname: address,
      port: 443,
      servername: target.host,
      method: target.method,
      path: `${target.url.pathname}${target.url.search}`,
      headers: {
        Host: target.host,
        Accept: target.accept,
        "Accept-Encoding": "identity",
        "User-Agent": target.userAgent,
      },
      checkServerIdentity: (_hostname, certificate) => checkServerIdentity(target.host, certificate),
      timeout: WEB_FETCH_TIMEOUT_MS,
    }, (upstreamResponse) => {
      const redirect = safeRedirectLocation(upstreamResponse.statusCode ?? 502, upstreamResponse.headers.location, target.url);
      if (upstreamResponse.headers.location !== undefined && redirect === null) {
        upstreamResponse.destroy();
        response.writeHead(403, { Connection: "close" });
        response.end();
        return;
      }
      const contentLength = Number(upstreamResponse.headers["content-length"] ?? 0);
      if (Number.isFinite(contentLength) && contentLength > MAX_WEB_FETCH_BYTES) {
        upstreamResponse.destroy();
        response.writeHead(413, { Connection: "close" });
        response.end();
        return;
      }
      const headers = {};
      for (const name of ["cache-control", "content-encoding", "content-length", "content-type", "etag", "last-modified", "location"]) {
        if (upstreamResponse.headers[name] !== undefined) headers[name] = upstreamResponse.headers[name];
      }
      if (redirect !== undefined) headers.location = redirect;
      response.writeHead(upstreamResponse.statusCode ?? 502, headers);
      let bytes = 0;
      upstreamResponse.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_WEB_FETCH_BYTES) {
          upstreamResponse.destroy();
          response.destroy();
        }
      });
      upstreamResponse.pipe(response);
    });
    upstream.once("timeout", () => upstream.destroy(new Error("web fetch upstream timed out")));
    upstream.once("error", () => {
      if (!response.headersSent) response.writeHead(502, { Connection: "close" });
      response.end();
    });
    request.once("aborted", () => upstream.destroy());
    response.once("close", () => {
      if (!response.writableEnded) upstream.destroy();
    });
  }).catch(() => {
    response.writeHead(403, { Connection: "close" });
    response.end();
  });
}

function deny(socket, status = "403 Forbidden") {
  if (socket.writable) socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
}

export function createEgressProxy({ allowedDomains, allowedPorts = new Set([443]), allowClaudeWebFetch = false, connect = connectTcp, resolveHost = resolvePublicIpv4, httpsRequest = requestHttps } = {}) {
  if (!(allowedDomains instanceof Set) || allowedDomains.size === 0) throw new Error("allowedDomains must be a non-empty Set");
  let activeWebFetches = 0;
  const server = createHttpServer((request, response) => {
    const target = allowClaudeWebFetch ? parseClaudeWebFetchRequest(request) : null;
    if (!target) {
      response.writeHead(405, { Connection: "close" });
      response.end();
      return;
    }
    if (activeWebFetches >= MAX_CONCURRENT_WEB_FETCHES) {
      response.writeHead(429, { Connection: "close", "Retry-After": "1" });
      response.end();
      return;
    }
    activeWebFetches += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeWebFetches -= 1;
    };
    response.once("finish", release);
    response.once("close", release);
    proxyWebFetch(request, response, target, { resolveHost, httpsRequest });
  });
  server.on("connect", (request, client, head) => {
    const target = parseConnectAuthority(request.url);
    if (!target || !allowedDomains.has(target.host) || !allowedPorts.has(target.port)) return deny(client);
    const upstream = connect({ host: target.host, port: target.port });
    let buffered = Buffer.alloc(0);
    let decided = false;
    const closeBoth = () => {
      clearTimeout(timer);
      client.destroy();
      upstream.destroy();
    };
    const timer = setTimeout(closeBoth, HANDSHAKE_TIMEOUT_MS);
    const inspect = (chunk) => {
      if (decided) return;
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length > MAX_CLIENT_HELLO) return closeBoth();
      const result = extractClientHelloSni(buffered);
      if (result.incomplete) return;
      if (result.sni !== target.host) return closeBoth();
      decided = true;
      clearTimeout(timer);
      client.off("data", inspect);
      upstream.write(buffered);
      client.pipe(upstream).pipe(client);
    };
    upstream.once("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\nProxy-Agent: adw-egress\r\n\r\n");
      client.on("data", inspect);
      if (head.length > 0) inspect(head);
    });
    upstream.once("error", closeBoth);
    client.once("error", closeBoth);
    client.once("close", () => upstream.destroy());
  });
  return server;
}

function main() {
  const allowedDomains = loadAllowedDomains();
  const agentTools = loadAgentTools();
  const webAccess = loadWebAccess();
  const allowClaudeWebFetch = webAccess === "public-pages" && (agentTools === "claude" || agentTools === "both");
  const server = createEgressProxy({ allowedDomains, allowClaudeWebFetch });
  server.listen(DEFAULT_PORT, DEFAULT_HOST, () => {
    process.stdout.write(`[adw-egress] HTTPS proxy listening on ${DEFAULT_HOST}:${DEFAULT_PORT}; Claude WebFetch ${allowClaudeWebFetch ? "enabled" : "disabled"}\n`);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
