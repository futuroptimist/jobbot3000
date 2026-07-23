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
    --unshare-net|--die-with-parent|--new-session|--clearenv) shift ;;
    --ro-bind|--bind) shift 3 ;;
    --dev|--proc|--tmpfs|--chdir) shift 2 ;;
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
  writeFileSync(
    join(dir, "package-lock.json"),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "node_modules/@playwright/test": {
          version: "1.2.3",
          resolved:
            "https://registry.npmjs.org/@playwright/test/-/test-1.2.3.tgz",
          integrity: "sha512-fixture",
        },
      },
    }),
  );
  return dir;
}

function run(args, cwd, env = {}) {
  return spawnSync("bash", [wrapper, ...args], {
    cwd,
    env: {
      ...process.env,
      GITHUB_WORKSPACE: cwd,
      PATH: `${join(cwd, "bin")}:${process.env.PATH}`,
      ...env,
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
    expect(run(["__jobbot_contained__", "lint"], dir).status).not.toBe(0);
  });

  it("uses only trusted Playwright tooling during network-enabled artifact preparation", () => {
    const dir = fixture();
    const trusted = fixture();
    mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
    mkdirSync(join(trusted, "node_modules", ".bin"), { recursive: true });
    writeFileSync(
      join(dir, "node_modules", ".bin", "playwright"),
      `#!/usr/bin/env bash
echo pr-playwright >> ${join(dir, "executed.log")}
exit 99
`,
    );
    chmodSync(join(dir, "node_modules", ".bin", "playwright"), 0o755);
    writeFileSync(
      join(trusted, "node_modules", ".bin", "playwright"),
      `#!/usr/bin/env bash
echo trusted:$* >> ${join(dir, "executed.log")}
exit 0
`,
    );
    chmodSync(join(trusted, "node_modules", ".bin", "playwright"), 0o755);

    expect(
      run(["install-playwright-artifacts"], dir, {
        TRUSTED_PLAYWRIGHT_WORKSPACE: trusted,
      }).status,
    ).toBe(0);
    const log = spawnSync("cat", [join(dir, "executed.log")], {
      encoding: "utf8",
    }).stdout;
    expect(log).toContain("trusted:install-deps chromium");
    expect(log).toContain("trusted:install chromium");
    expect(log).not.toContain("pr-playwright");
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

  it("installs trusted wrappers before event or PR checkouts and uses immutable head_sha", () => {
    const text = readWorkflow();
    const trustedInstall = [
      "sudo install -o root -g root -m 0555",
      "trusted-workflow/.github/scripts/claude-validate.sh",
      "/usr/local/bin/jobbot-claude-validate",
    ].join(" ");
    const validationInstall = text.indexOf(trustedInstall);
    const validationPrCheckout = text.indexOf(
      "Checkout same-repository PR commit",
    );
    const claudeJob = text.indexOf("  claude:");
    const claudeTrustedCheckout = text.indexOf(
      "Checkout trusted workflow revision",
      claudeJob,
    );
    const claudeInstall = text.indexOf(trustedInstall, claudeJob);
    const eventCheckout = text.indexOf("Checkout repository", claudeJob);

    expect(text).toContain("ref: ${{ github.workflow_sha }}");
    expect(validationInstall).toBeGreaterThanOrEqual(0);
    expect(validationInstall).toBeLessThan(validationPrCheckout);
    expect(claudeTrustedCheckout).toBeGreaterThanOrEqual(0);
    expect(claudeInstall).toBeGreaterThan(claudeTrustedCheckout);
    expect(claudeInstall).toBeLessThan(eventCheckout);
    expect(text).toContain("ref: ${{ needs.authorize.outputs.head_sha }}");
    expect(text).not.toContain(
      ["needs.authorize.outputs", "head_ref"].join("."),
    );
  });

  it("does not execute the PR-checkout wrapper or mutate runner-wide firewall policy", () => {
    const text = readWorkflow();
    expect(text).not.toContain(
      [".github/scripts/claude-validate.sh", "lint"].join(" "),
    );
    expect(text).not.toContain(
      [".github/scripts/claude-validate.sh", "prepare-deps"].join(" "),
    );
    expect(text).not.toContain(["iptables", "-P", "OUTPUT"].join(" "));
    expect(text).toContain("/usr/local/bin/jobbot-claude-validate lint");
    expect(text).toContain("TRUSTED_PLAYWRIGHT_WORKSPACE");
    expect(text).toContain("use_commit_signing: true");
    expect(text).toContain("Bash(/usr/local/bin/jobbot-claude-validate lint)");
  });

  it("parses fail-closed Claude settings and denies built-in credential reads", () => {
    const text = readWorkflow();
    const settingsPattern = new RegExp(
      String.raw`cat > "\$CLAUDE_SETTINGS" <<'JSON'\n(?<json>[\s\S]*?)\n {10}JSON`,
    );
    const match = text.match(settingsPattern);
    expect(match?.groups?.json).toBeTruthy();
    const settings = JSON.parse(
      match.groups.json
        .split("\n")
        .map((line) => line.replace(/^ {10}/u, ""))
        .join("\n"),
    );

    expect(settings.permissions.disableBypassPermissionsMode).toBe("disable");
    expect(settings).not.toHaveProperty("disableBypassPermissionsMode");
    expect(settings.sandbox.enabled).toBe(true);
    expect(settings.sandbox.failIfUnavailable).toBe(true);
    expect(settings.sandbox.allowUnsandboxedCommands).toBe(false);
    expect(settings.sandbox.autoAllowBashIfSandboxed).toBe(false);
    expect(settings.sandbox.network.allowedDomains).toEqual([]);
    expect(settings.sandbox.network.deniedDomains).toEqual(["*"]);
    expect(text).toContain('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1"');

    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining([
        "Read(//proc/*/environ)",
        "Read(//proc/*/task/*/environ)",
        "Read(//home/runner/.config/**)",
        "Read(//home/runner/.docker/**)",
        "Read(//home/runner/.gitconfig)",
        "Read(//home/runner/.npmrc)",
        "Read(//home/runner/.ssh/**)",
        "Read(//home/runner/.aws/**)",
        "Read(//home/runner/.azure/**)",
        "Read(//home/runner/.claude/**)",
        "Read(//home/runner/.claude.json)",
        "Read(//home/runner/.git-credentials)",
        "Read(//home/runner/work/_actions/**)",
        "Read(//home/runner/work/_temp/_github_token)",
        "Read(//home/runner/work/_temp/_runner_file_commands/**)",
      ]),
    );
    expect(settings.sandbox.filesystem.denyRead).toEqual(
      expect.arrayContaining([
        "/home/runner/.config",
        "/home/runner/.docker",
        "/home/runner/.gitconfig",
        "/home/runner/.npmrc",
        "/home/runner/.ssh",
        "/home/runner/work/_actions",
      ]),
    );
    expect(settings.sandbox.credentials.files).toEqual(
      expect.arrayContaining([
        { path: "~/.git-credentials", mode: "deny" },
        { path: "/home/runner/work/_temp/_github_token", mode: "deny" },
      ]),
    );
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
