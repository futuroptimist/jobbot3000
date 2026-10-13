import { isIP } from "node:net";
import { Headers } from "node-fetch";
import { IPV4_DENY, IPV6_DENY } from "./public-address-ranges.js";
import { IngestionError } from "./ingestion-budget.js";

function numeric(address) {
  const family = isIP(address);
  if (family === 4)
    return address.split(".").reduce((n, x) => (n << 8n) + BigInt(x), 0n);
  if (family !== 6 || address.includes("%")) throw new Error("Invalid address");
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const [head, tail] = canonical.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const parts =
    tail === undefined
      ? left
      : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  return parts.reduce((n, x) => (n << 16n) + BigInt(`0x${x}`), 0n);
}
function compile(table, family) {
  if (!Array.isArray(table) || !table.length)
    throw new Error("Missing address policy");
  return table.map((cidr) => {
    const [ip, prefix] = cidr.split("/");
    const bits = family === 4 ? 32 : 128;
    const count = Number(prefix);
    if (
      isIP(ip) !== family ||
      !Number.isInteger(count) ||
      count < 0 ||
      count > bits
    ) {
      throw new Error("Invalid address policy");
    }
    const shift = BigInt(bits - count);
    return { value: numeric(ip) >> shift, shift };
  });
}
const v4 = compile(IPV4_DENY, 4);
const v6 = compile(IPV6_DENY, 6);
export function isPublicAddress(address) {
  try {
    const family = isIP(address);
    if (!family || address.includes("%")) return false;
    const value = numeric(address);
    if (family === 6 && value >> 125n !== 1n) return false;
    return !(family === 4 ? v4 : v6).some(
      (entry) => value >> entry.shift === entry.value,
    );
  } catch {
    return false;
  }
}
export function samePeer(actual, expected) {
  try {
    if (isIP(actual) === 6 && isIP(expected) === 4) {
      const value = numeric(actual);
      return (
        value >> 32n === 0xffffn && (value & 0xffffffffn) === numeric(expected)
      );
    }
    return (
      isIP(actual) === isIP(expected) && numeric(actual) === numeric(expected)
    );
  } catch {
    return false;
  }
}
export function admitUrl(input) {
  try {
    if (Buffer.byteLength(String(input)) > 8192) throw new Error();
    if (/^[a-z]+:\/\/[^/?#]*@/i.test(String(input))) throw new Error();
    const url = new URL(input);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.hostname.includes("%") ||
      (url.port && (Number(url.port) < 1 || Number(url.port) > 65535))
    )
      throw new Error();
    url.hostname = url.hostname.toLowerCase().replace(/\.+$/, "");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (!host || host === "localhost" || host.endsWith(".localhost"))
      throw new Error();
    if (isIP(host) && !isPublicAddress(host)) {
      throw new IngestionError(
        "ADDRESS_POLICY",
        "Destination is not an ordinary public address",
      );
    }
    url.hash = "";
    return url;
  } catch (error) {
    if (error instanceof IngestionError) throw error;
    throw new IngestionError(
      "URL_POLICY",
      "URL does not meet public ingestion policy",
    );
  }
}
export function admitRecords(records, maximum) {
  if (!Array.isArray(records) || !records.length || records.length > maximum) {
    throw new IngestionError("DNS_UNRESOLVED", "Invalid DNS answer set");
  }
  const answers = records.map((record) => {
    if (
      !record ||
      typeof record.address !== "string" ||
      !isIP(record.address) ||
      isIP(record.address) !== record.family
    ) {
      throw new IngestionError("DNS_UNRESOLVED", "Malformed DNS answer");
    }
    if (!isPublicAddress(record.address)) {
      throw new IngestionError(
        "ADDRESS_POLICY",
        "DNS answer set is not entirely public",
      );
    }
    return Object.freeze({ address: record.address, family: record.family });
  });
  return Object.freeze(answers);
}
const forbiddenOptions = [
  "fetchImpl",
  "agent",
  "dispatcher",
  "lookup",
  "socketPath",
  "createConnection",
  "rejectUnauthorized",
  "checkServerIdentity",
  "ca",
  "cert",
  "key",
  "servername",
  "allowPrivate",
  "proxy",
];
export function admitOptions(options = {}) {
  if (
    forbiddenOptions.some((key) => options[key] !== undefined) ||
    options.body != null ||
    !["GET", "HEAD"].includes(options.method ?? "GET")
  ) {
    throw new IngestionError(
      "URL_POLICY",
      "Unsupported ingestion request option",
    );
  }
  let headers;
  try {
    headers = new Headers(options.headers);
  } catch {
    throw new IngestionError("URL_POLICY", "Invalid ingestion headers");
  }
  for (const name of [
    "host",
    "referer",
    "connection",
    "transfer-encoding",
    "content-length",
    "upgrade",
    "proxy-connection",
  ]) {
    if (headers.has(name))
      throw new IngestionError("URL_POLICY", "Unsupported request header");
  }
  headers.set("accept-encoding", "gzip, deflate, br");
  return headers;
}
const safe = new Set([
  "user-agent",
  "accept",
  "accept-language",
  "accept-encoding",
]);
const validators = new Set([
  "if-none-match",
  "if-modified-since",
  "if-match",
  "if-unmodified-since",
  "if-range",
]);
export function redirectHeaders(from, to, headers, credentialQuery = false) {
  const next = new Headers(headers);
  if (from.protocol === "https:" && to.protocol !== "https:") {
    throw new IngestionError("REDIRECT_POLICY", "HTTPS downgrade refused");
  }
  if (
    from.origin !== to.origin &&
    (credentialQuery ||
      [...headers.keys()].some(
        (name) => !safe.has(name) && !validators.has(name),
      ))
  )
    throw new IngestionError(
      "REDIRECT_POLICY",
      "Credential-bearing cross-origin redirect refused",
    );
  if (from.href !== to.href) for (const name of validators) next.delete(name);
  return next;
}
