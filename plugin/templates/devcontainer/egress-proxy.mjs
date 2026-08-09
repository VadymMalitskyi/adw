#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { connect as connectTcp, isIP } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ALLOWLIST = "/etc/adw/allowed-domains.txt";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 18080;
const MAX_CLIENT_HELLO = 65_536;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const DNS_NAME = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

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

function deny(socket, status = "403 Forbidden") {
  if (socket.writable) socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
}

export function createEgressProxy({ allowedDomains, allowedPorts = new Set([443]), connect = connectTcp } = {}) {
  if (!(allowedDomains instanceof Set) || allowedDomains.size === 0) throw new Error("allowedDomains must be a non-empty Set");
  const server = createHttpServer((_request, response) => {
    response.writeHead(405, { Connection: "close" });
    response.end();
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
  const server = createEgressProxy({ allowedDomains });
  server.listen(DEFAULT_PORT, DEFAULT_HOST, () => {
    process.stdout.write(`[adw-egress] CONNECT proxy listening on ${DEFAULT_HOST}:${DEFAULT_PORT}\n`);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
