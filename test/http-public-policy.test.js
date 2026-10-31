import { describe, it, expect, vi } from "vitest";
import { Headers } from "node-fetch";
import {
  admitUrl,
  admitRecords,
  isPublicAddress,
  samePeer,
  admitOptions,
  redirectHeaders,
} from "../src/shared/http/public-policy.js";
import {
  IPV4_DENY,
  IPV6_DENY,
} from "../src/shared/http/public-address-ranges.js";

describe("public address admission (synthetic, no network)", () => {
  it.each([
    "file:///tmp/a",
    "ftp://example.test",
    "http://user:pass@example.test",
    "http://localhost",
    "http://a.localhost.",
    "http://127.1",
    "http://0x7f000001",
    "http://2130706433",
    "http://[fe80::1%25eth0]",
    "http://example.test:0",
    "http://example.test:65536",
    "http://[::ffff:93.184.216.34]",
  ])("rejects URL %s", (url) => {
    expect(() => admitUrl(url)).toThrow();
  });
  it("canonicalizes IDNA, default ports, case, trailing dots and fragments", () => {
    expect(
      admitUrl("HTTPS://BÜCHER.example.:443/a?q=a%2Fb#fragment").href,
    ).toBe("https://xn--bcher-kva.example/a?q=a%2Fb");
  });
  it.each([...IPV4_DENY, ...IPV6_DENY])("rejects table prefix %s", (cidr) => {
    expect(isPublicAddress(cidr.split("/")[0])).toBe(false);
  });
  it.each([
    "::",
    "::1",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
    "64:ff9b:1::1",
    "100::1",
    "100:0:0:1::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "5f00::1",
    "2001:1::1",
    "2001:20::1",
    "3fff:fff::1",
    "not-an-ip",
  ])("denies special %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
  it.each([
    "93.184.216.34",
    "8.8.8.8",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
  ])("admits ordinary injected address %s", (ip) =>
    expect(isPublicAddress(ip)).toBe(true),
  );
  it.each([
    [],
    null,
    [{}],
    [{ address: "8.8.8.8", family: 6 }],
    [
      { address: "8.8.8.8", family: 4 },
      { address: "::1", family: 6 },
    ],
  ])("fails closed on malformed or mixed answers %j", (records) => {
    expect(() => admitRecords(records, 32)).toThrow();
  });
  it("freezes copies and bounds answer count", () => {
    const records = [{ address: "8.8.8.8", family: 4 }];
    const admitted = admitRecords(records, 32);
    records[0].address = "127.0.0.1";
    expect(admitted[0].address).toBe("8.8.8.8");
    expect(Object.isFrozen(admitted)).toBe(true);
    expect(Object.isFrozen(admitted[0])).toBe(true);
    expect(() => admitRecords(Array(33).fill(admitted[0]), 32)).toThrow();
  });
  it("normalizes mapped OS peers without admitting mapped URL inputs", () => {
    expect(samePeer("::ffff:93.184.216.34", "93.184.216.34")).toBe(true);
    expect(samePeer("::ffff:127.0.0.1", "93.184.216.34")).toBe(false);
  });
  it.each([
    "agent",
    "lookup",
    "fetchImpl",
    "dispatcher",
    "socketPath",
    "createConnection",
    "rejectUnauthorized",
    "checkServerIdentity",
    "allowPrivate",
  ])("rejects %s hooks", (key) => {
    expect(() => admitOptions({ [key]: vi.fn() })).toThrow();
  });
  it.each([
    "host",
    "referer",
    "connection",
    "transfer-encoding",
    "content-length",
  ])("rejects unsafe header %s", (key) => {
    expect(() => admitOptions({ headers: { [key]: "synthetic" } })).toThrow();
  });
  it("drops resource-bound validators and preserves safe headers on CDN redirect", () => {
    const from = admitUrl("https://origin.example.test/a");
    const to = admitUrl("https://cdn.example.test/b");
    const next = redirectHeaders(
      from,
      to,
      new Headers({
        "If-None-Match": "synthetic",
        "User-Agent": "test",
        Accept: "application/json",
      }),
    );
    expect(next.has("if-none-match")).toBe(false);
    expect(next.get("accept")).toBe("application/json");
    expect(
      redirectHeaders(
        from,
        admitUrl("https://origin.example.test/b"),
        new Headers({ "If-Modified-Since": "synthetic" }),
      ).has("if-modified-since"),
    ).toBe(false);
  });
  it.each(["Authorization", "Cookie", "Proxy-Authorization", "X-Custom"])(
    "retains same-origin %s but rejects cross-origin credentials",
    (name) => {
      const from = admitUrl("https://origin.example.test/a");
      const headers = new Headers({ [name]: "synthetic" });
      expect(
        redirectHeaders(
          from,
          admitUrl("https://origin.example.test/b"),
          headers,
        ).get(name),
      ).toBe("synthetic");
      expect(() =>
        redirectHeaders(from, admitUrl("https://cdn.example.test/b"), headers),
      ).toThrow();
    },
  );
});
