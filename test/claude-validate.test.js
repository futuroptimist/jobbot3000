import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
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
printf '%s\n' "$@" >> "\${BWRAP_LOG:-/dev/null}"
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

function testCiFixture() {
  const dir = mkdtempSync(join(tmpdir(), "test-ci-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "node_modules", "playwright-core"), { recursive: true });
  mkdirSync(join(dir, "bin"), { recursive: true });
  copyFileSync(
    new URL("../scripts/test-ci.js", import.meta.url),
    join(dir, "scripts", "test-ci.js"),
  );
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(
    join(dir, "node_modules", "playwright-core", "browsers.json"),
    JSON.stringify({
      browsers: [
        { name: "chromium", revision: "111" },
        { name: "chromium-headless-shell", revision: "222" },
      ],
    }),
  );
  for (const command of ["curl", "unzip", "npx", "vitest", "playwright"]) {
    writeFileSync(
      join(dir, "bin", command),
      `#!/usr/bin/env bash
echo ${command}:$* >> ${join(dir, "commands.log")}
exit 0
`,
    );
    chmodSync(join(dir, "bin", command), 0o755);
  }
  return dir;
}

function runTestCi(dir, env = {}) {
  const childEnv = { ...process.env };
  delete childEnv.PLAYWRIGHT_BROWSERS_PATH;
  delete childEnv.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD;
  delete childEnv.JOBBOT_PREPARED_PLAYWRIGHT;
  return spawnSync(process.execPath, [join(dir, "scripts", "test-ci.js")], {
    cwd: dir,
    env: {
      ...childEnv,
      PATH: `${join(dir, "bin")}:${process.env.PATH}`,
      ...env,
    },
    encoding: "utf8",
  });
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

describe("test-ci prepared Playwright mode", () => {
  it("rejects missing prepared browser artifacts", () => {
    const dir = testCiFixture();
    const result = runTestCi(dir, { JOBBOT_PREPARED_PLAYWRIGHT: "1" });
    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toContain(
      "Prepared Playwright artifacts are missing",
    );
  });

  it("uses prepared artifacts without downloads, npx, or install-deps", () => {
    const dir = testCiFixture();
    mkdirSync(join(dir, ".cache", "ms-playwright", "chromium-111"), {
      recursive: true,
    });
    mkdirSync(
      join(dir, ".cache", "ms-playwright", "chromium_headless_shell-222"),
      { recursive: true },
    );

    const result = runTestCi(dir, { JOBBOT_PREPARED_PLAYWRIGHT: "1" });
    expect(result.status).toBe(0);
    const log = readFileSync(join(dir, "commands.log"), "utf8");
    expect(log).toContain("vitest:run");
    expect(log).toContain("playwright:test");
    expect(log).not.toContain("curl:");
    expect(log).not.toContain("unzip:");
    expect(log).not.toContain("npx:");
    expect(log).not.toContain("install-deps");
  });

  it("retains the normal preparation path outside prepared mode", () => {
    const dir = testCiFixture();
    const result = runTestCi(dir);
    expect(result.status).toBe(0);
    const log = readFileSync(join(dir, "commands.log"), "utf8");
    expect(log).toContain("curl:-fL");
    expect(log).toContain("unzip:-q");
    expect(log).toContain("npx:playwright install-deps chromium");
    expect(log).toContain("vitest:run");
    expect(log).toContain("playwright:test");
  });
});

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

  it("constructs prepared-mode environment for contained test-ci only", () => {
    const dir = fixture();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { "test:ci": "echo test-ci" } }),
    );
    const bwrapLog = join(dir, "bwrap.log");
    const result = run(["test-ci"], dir, { BWRAP_LOG: bwrapLog });
    expect(result.status).toBe(0);
    const log = readFileSync(bwrapLog, "utf8");
    expect(log).toContain("JOBBOT_PREPARED_PLAYWRIGHT");
    expect(log).toContain("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD");
    expect(run(["test-ci", "--prepared"], dir).status).not.toBe(0);
    expect(run(["test-ci; npm run evil"], dir).status).not.toBe(0);
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

  it("publishes prepared artifacts before fallible validation operations", () => {
    const text = readWorkflow();
    const publish = text.indexOf("Publish prepared dependency artifact");
    expect(publish).toBeGreaterThan(
      text.indexOf("Install Playwright artifacts before network lockdown"),
    );
    for (const step of [
      "Prove validation sandbox denies outbound network",
      "- name: Lint",
      "- name: Format check",
      "- name: Typecheck",
      "- name: Test CI",
      "- name: Build",
    ]) {
      expect(publish).toBeLessThan(text.indexOf(step));
    }
    expect(text).toContain("if-no-files-found: error");
    expect(text).toContain(
      "name: claude-prepared-deps-${{ needs.authorize.outputs.head_sha }}",
    );
  });

  it("allows authorized Claude sessions after validation completes", () => {
    const text = readWorkflow();
    const claudeJob = text.indexOf("  claude:");
    const condition = text.slice(
      claudeJob,
      text.indexOf("    runs-on:", claudeJob),
    );
    expect(condition).toContain("needs: [authorize, claude-validation]");
    expect(condition).toContain(
      "if: always() && needs.authorize.outputs.authorized == 'true'",
    );
    expect(condition).not.toContain("claude-validation.result == 'success'");
    expect(text).toContain(
      "A successful Claude action conclusion alone is not proof that validation ran.",
    );
  });

  it("warns when prepared artifacts are missing without failing", () => {
    const text = readWorkflow();
    const restore = text.indexOf("Restore prepared dependency artifact");
    const warning = text.indexOf(
      "Warn when prepared dependencies are unavailable",
    );
    expect(restore).toBeGreaterThanOrEqual(0);
    expect(warning).toBeGreaterThan(restore);
    expect(text.slice(restore, warning)).toContain("id: restore-prepared-deps");
    expect(text.slice(restore, warning)).toContain("continue-on-error: true");
    expect(text).toContain("steps.restore-prepared-deps.outcome == 'failure'");
    expect(text).toContain("Prepared dependencies are unavailable");
    expect(text).toContain(
      "separate Claude validation commands check remains authoritative",
    );
  });

  it("keeps validation operations fail-closed", () => {
    const text = readWorkflow();
    const validationJob = text.slice(
      text.indexOf("  claude-validation:"),
      text.indexOf("  claude:"),
    );
    expect(validationJob).not.toContain("continue-on-error");
    for (const step of [
      "Prove validation sandbox denies outbound network",
      "- name: Lint",
      "- name: Format check",
      "- name: Typecheck",
      "- name: Test CI",
      "- name: Build",
    ]) {
      const stepIndex = validationJob.indexOf(step);
      expect(stepIndex).toBeGreaterThanOrEqual(0);
      const nextStep = validationJob.indexOf("\n      - name:", stepIndex + 1);
      const stepText = validationJob.slice(
        stepIndex,
        nextStep === -1 ? validationJob.length : nextStep,
      );
      expect(stepText).not.toContain("continue-on-error");
    }
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
    expect(text).toContain("ACTOR: ${{ github.actor }}");
    expect(text).toContain("issues:");
    expect(text).toContain("types: [opened, assigned]");
    expect(text).not.toContain("github.event.issue.user.login");
    expect(text).toContain(
      "authorized_actor: ${{ steps.auth.outputs.authorized_actor }}",
    );
    expect(text).toContain(
      'echo "authorized_actor=${ACTOR}" >> "$GITHUB_OUTPUT"',
    );
    expect(text).toContain("Ignoring @claude request from untrusted actor");
    expect(text).toContain(
      "Refusing to run executable Claude tooling for fork PR",
    );
    expect(text).toContain("tolower($0)");
    expect(text).toContain("trusted_actors=${trusted_actors}");
  });

  it("passes the gated actor and short-lived App token to the pinned Claude action", () => {
    const text = readWorkflow();
    const tokenStep = text.indexOf("Mint Claude GitHub App token");
    const checkout = text.indexOf("Checkout repository", tokenStep);
    const action = text.indexOf(
      "uses: anthropics/claude-code-action@",
      checkout,
    );
    const actionBlock = text.slice(
      action,
      text.indexOf("          claude_args:", action),
    );

    expect(tokenStep).toBeGreaterThanOrEqual(0);
    expect(tokenStep).toBeLessThan(checkout);
    expect(text).toContain("audience=claude-code-github-action");
    expect(text).toContain("github-app-token-exchange");
    expect(text).toContain('"contents":"write"');
    expect(text).toContain('"pull_requests":"write"');
    expect(text).toContain('"issues":"write"');
    expect(text).toContain('"actions":"read"');
    expect(text).toContain('data.get("token") or data.get("app_token")');
    expect(text).toContain("::add-mask::$oidc_token");
    expect(text).toContain("::add-mask::$app_token");
    expect(text).toContain('echo "token=${app_token}" >> "$GITHUB_OUTPUT"');
    expect(text).not.toContain("OVERRIDE_GITHUB_TOKEN");
    expect(text).not.toContain("secrets.GITHUB_TOKEN");
    expect(text).not.toContain("github_token: ${{ github.token }}");

    expect(actionBlock).toContain(
      "github_token: ${{ steps.claude-app-token.outputs.token }}",
    );
    expect(actionBlock).toContain(
      "allowed_non_write_users: ${{ needs.authorize.outputs.authorized_actor }}",
    );
    expect(actionBlock).toContain(
      "include_comments_by_actor: ${{ needs.authorize.outputs.trusted_actors }}",
    );
    expect(actionBlock).toContain("use_commit_signing: true");
  });
});
