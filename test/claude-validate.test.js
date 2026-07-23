import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const wrapper = new URL(
  "../.github/scripts/claude-validate.sh",
  import.meta.url,
).pathname;

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "claude-validate-"));
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "src", "ok.js"), "const ok = true;\n");
  const outside = join(
    mkdtempSync(join(tmpdir(), "claude-outside-")),
    "outside.js",
  );
  writeFileSync(outside, "const outside = true;\n");
  symlinkSync(outside, join(dir, "src", "escape.js"));
  writeFileSync(
    join(dir, "bin", "bwrap"),
    `#!/usr/bin/env bash
if printf '%s\\n' "$@" | grep -qx -- network-probe; then exit 7; fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --setenv) export "$2=$3"; shift 3 ;;
    --unshare-net|--die-with-parent) shift ;;
    --dev-bind) shift 3 ;;
    --proc|--tmpfs) shift 2 ;;
    *) exec "$@" ;;
  esac
done
`,
  );
  chmodSync(join(dir, "bin", "bwrap"), 0o755);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ scripts: { lint: "echo lint" } }),
  );
  return dir;
}

function run(args, cwd) {
  return spawnSync("bash", [wrapper, ...args], {
    cwd,
    env: {
      ...process.env,
      GITHUB_WORKSPACE: cwd,
      PATH: `${join(cwd, "bin")}:${process.env.PATH}`,
    },
    encoding: "utf8",
  });
}

describe("claude validation wrapper", () => {
  it("rejects unsafe operations and arguments", () => {
    const dir = fixture();
    expect(run(["unknown"], dir).status).not.toBe(0);
    expect(run(["lint", "--", "extra"], dir).status).not.toBe(0);
    expect(run(["lint; npx evil"], dir).status).not.toBe(0);
    expect(run(["npx", "vitest"], dir).status).not.toBe(0);
    expect(
      run(["install-playwright-artifacts", "--with-deps"], dir).status,
    ).not.toBe(0);
  });

  it("runs node --check -- only for regular in-workspace JavaScript files", () => {
    const dir = fixture();
    expect(run(["node-check", "src/ok.js"], dir).status).toBe(0);
    expect(run(["node-check", "../outside.js"], dir).status).not.toBe(0);
    expect(run(["node-check", "src/escape.js"], dir).status).not.toBe(0);
    expect(run(["node-check", "-e"], dir).status).not.toBe(0);
    expect(run(["node-check", "--require"], dir).status).not.toBe(0);
    expect(
      run(["node-check", "src/ok.js", "--require", "x"], dir).status,
    ).not.toBe(0);
    expect(run(["node-check", "src/ok.js; node -e evil"], dir).status).not.toBe(
      0,
    );
  });

  it("fails outbound probes inside the same network boundary", () => {
    const dir = fixture();
    expect(run(["network-probe"], dir).status).not.toBe(0);
  });
});

describe("claude workflow trust boundaries", () => {
  const workflow = new URL("../.github/workflows/claude.yml", import.meta.url)
    .pathname;
  const readWorkflow = () =>
    spawnSync("cat", [workflow], { encoding: "utf8" }).stdout;

  it("installs the trusted wrapper before PR checkout and uses immutable head_sha", () => {
    const text = readWorkflow();
    expect(text).toContain("ref: ${{ github.workflow_sha }}");
    expect(
      text.indexOf("trusted-workflow/.github/scripts/claude-validate.sh"),
    ).toBeLessThan(text.indexOf("Checkout same-repository PR commit"));
    expect(text).toContain("ref: ${{ needs.authorize.outputs.head_sha }}");
    expect(text).not.toContain(["needs.authorize.outputs", "head_ref"].join("."));
  });

  it("does not execute the PR-checkout wrapper or mutate runner-wide firewall policy", () => {
    const text = readWorkflow();
    expect(text).not.toContain([".github/scripts/claude-validate.sh", "lint"].join(" "));
    expect(text).not.toContain(
      [".github/scripts/claude-validate.sh", "prepare-deps"].join(" "),
    );
    expect(text).not.toContain(["iptables", "-P", "OUTPUT"].join(" "));
    expect(text).toContain("/usr/local/bin/jobbot-claude-validate lint");
  });

  it("covers trusted, unauthorized, and fork authorization paths", () => {
    const text = readWorkflow();
    expect(text).toContain("REPOSITORY_OWNER");
    expect(text).toContain("TRUSTED_CLAUDE_ACTORS");
    expect(text).toContain("Ignoring @claude request from untrusted actor");
    expect(text).toContain(
      "Refusing to run executable Claude tooling for fork PR",
    );
    expect(text).toContain("tolower($0)");
    expect(text).toContain("trusted_actors=${trusted_actors}");
  });
});
