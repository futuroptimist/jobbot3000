import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

const wrapper = new URL(
  "../.github/scripts/claude-validate.sh",
  import.meta.url,
).pathname;

function run(args, cwd) {
  return spawnSync("bash", [wrapper, ...args], {
    cwd,
    env: { ...process.env, GITHUB_WORKSPACE: cwd, PATH: process.env.PATH },
    encoding: "utf8",
  });
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "claude-validate-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "ok.js"), "const ok = true;\n");
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ scripts: { lint: "echo lint" } }),
  );
  return dir;
}

describe("claude validation wrapper", () => {
  it("rejects unknown operations, flags, shell metacharacter payloads, and npx", () => {
    const dir = fixture();
    expect(run(["unknown"], dir).status).not.toBe(0);
    expect(run(["lint", "--", "extra"], dir).status).not.toBe(0);
    expect(run(["lint; npx evil"], dir).status).not.toBe(0);
    expect(run(["npx", "vitest"], dir).status).not.toBe(0);
    expect(
      run(["install-playwright-artifacts", "--with-deps"], dir).status,
    ).not.toBe(0);
  });

  it("runs node syntax checks only for regular in-workspace JavaScript files", () => {
    const dir = fixture();
    expect(run(["node-check", "src/ok.js"], dir).status).toBe(0);
    expect(run(["node-check", "../outside.js"], dir).status).not.toBe(0);
    expect(run(["node-check", "-e"], dir).status).not.toBe(0);
    expect(run(["node-check", "--require"], dir).status).not.toBe(0);
    expect(
      run(["node-check", "src/ok.js", "--require", "x"], dir).status,
    ).not.toBe(0);
    expect(run(["node-check", "src/ok.js; node -e evil"], dir).status).not.toBe(
      0,
    );
  });
});
