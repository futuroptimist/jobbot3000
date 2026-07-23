import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const repoRoot = path.resolve(import.meta.dirname, "..");
const workflowPath = path.join(repoRoot, ".github/workflows/claude.yml");
const settingsPath = path.join(repoRoot, ".github/claude-code-settings.json");
const wrapperPath = path.join(
  repoRoot,
  ".github/scripts/jobbot-claude-validate.sh",
);

async function readWorkflow() {
  return parseYaml(await readFile(workflowPath, "utf8"));
}

function runWrapper(args, workspace) {
  return spawnSync(wrapperPath, args, {
    cwd: workspace,
    env: {
      ...process.env,
      GITHUB_WORKSPACE: workspace,
      PATH: process.env.PATH,
    },
    encoding: "utf8",
  });
}

describe("Claude workflow hardening", () => {
  it("uses explicit trusted actors before checkout or secret-bearing Claude steps", async () => {
    const workflowText = await readFile(workflowPath, "utf8");
    const workflow = await readWorkflow();
    const steps = workflow.jobs.claude.steps;

    expect(workflowText).toContain("vars.CLAUDE_TRUSTED_ACTORS");
    expect(workflowText).toContain("github.repository_owner");
    expect(workflowText).not.toContain('"OWNER", "MEMBER", "COLLABORATOR"');
    expect(steps[0].name).toBe("Authorize trusted Claude actor");
    expect(
      steps.findIndex((step) => step.name === "Checkout repository"),
    ).toBeGreaterThan(0);
    expect(
      steps.findIndex((step) => step.name === "Run Claude Code"),
    ).toBeGreaterThan(
      steps.findIndex((step) => step.name === "Reject fork pull requests"),
    );
    expect(workflowText).toContain("include_comments_by_actor:");
    expect(workflowText).toContain("github-actions[bot],claude[bot]");
  });

  it("keeps privileged Claude permissions narrow and sensitive output disabled", async () => {
    const workflow = await readWorkflow();
    const job = workflow.jobs.claude;
    const runClaude = job.steps.find((step) => step.name === "Run Claude Code");

    expect(job.permissions).toMatchObject({
      contents: "read",
      "pull-requests": "read",
      issues: "read",
      actions: "read",
      "id-token": "write",
    });
    expect(runClaude.uses).toBe(
      "anthropics/claude-code-action@fa7e2f0a29a126f0b81cdcf360561b36e44cf608",
    );
    expect(runClaude.with.use_commit_signing).toBe(true);
    expect(runClaude.with.display_report).toBe("false");
    expect(runClaude.with.show_full_output).toBe("false");
  });

  it("allows only the trusted validation wrapper and denies generic interpreters", async () => {
    const workflowText = await readFile(workflowPath, "utf8");
    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    const allowed = settings.permissions.allow.join("\n");
    const denied = `${workflowText}\n${settings.permissions.deny.join("\n")}`;

    for (const op of [
      "prepare",
      "lint",
      "format-check",
      "typecheck",
      "test-ci",
      "build",
    ]) {
      expect(allowed).toContain(`Bash(/tmp/jobbot-claude-validate ${op})`);
    }
    expect(allowed).toContain("Bash(/tmp/jobbot-claude-validate node-check *)");
    for (const forbidden of [
      "Bash(npm ci)",
      "Bash(npm run lint)",
      "Bash(npx vitest run",
      "Bash(node --check *)",
      "Bash(node -e",
      "--dangerously-skip-permissions",
      "bypassPermissions",
      "Bash(curl *)",
      "Bash(wget *)",
    ]) {
      expect(allowed).not.toContain(forbidden);
    }
    for (const deniedTool of [
      "Bash(npm *)",
      "Bash(npx *)",
      "Bash(node *)",
      "WebFetch",
      "WebSearch",
    ]) {
      expect(denied).toContain(deniedTool);
    }
  });

  it("configures strict sandboxing and credential containment", async () => {
    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(settings.sandbox).toMatchObject({
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: false,
    });
    expect(settings.sandbox.network.allowedDomains).toEqual([]);
    expect(settings.sandbox.network.deniedDomains).toEqual(["*"]);
    expect(settings.sandbox.filesystem.denyRead).toEqual(
      expect.arrayContaining([
        "~/",
        "/home/runner/.ssh",
        "/home/runner/work/_temp/_github_home",
      ]),
    );
    expect(settings.sandbox.credentials.envVars).toEqual(
      expect.arrayContaining([
        { name: "GITHUB_TOKEN", mode: "deny" },
        { name: "CLAUDE_CODE_OAUTH_TOKEN", mode: "deny" },
        { name: "ACTIONS_ID_TOKEN_REQUEST_TOKEN", mode: "deny" },
      ]),
    );
  });
});

describe("trusted Claude validation wrapper", () => {
  async function fixtureWorkspace() {
    const dir = mkdtempSync(path.join(os.tmpdir(), "jobbot-claude-wrapper-"));
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ scripts: {} }),
    );
    await mkdir(path.join(dir, "src"));
    await writeFile(path.join(dir, "src/ok.js"), "const ok = true;\n");
    await writeFile(path.join(dir, "src/not-js.txt"), "text\n");
    return dir;
  }

  it("rejects unsafe operations and arguments", async () => {
    const workspace = await fixtureWorkspace();
    try {
      for (const args of [
        ["unknown"],
        ["lint", "--", "--fix"],
        ["lint;echo pwned"],
        ["node-check", "../outside.js"],
        ["node-check", "-e"],
        ["node-check", "--require"],
        ["node-check", "src/not-js.txt"],
        ["npx", "vitest", "run"],
      ]) {
        const result = runWrapper(args, workspace);
        expect(result.status).not.toBe(0);
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("uses node --check with an option terminator for repository JS files", async () => {
    const workspace = await fixtureWorkspace();
    try {
      const nodePath = path.join(workspace, "node");
      writeFileSync(
        nodePath,
        '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > node-argv.txt\n',
        { mode: 0o755 },
      );
      const result = spawnSync(wrapperPath, ["node-check", "src/ok.js"], {
        cwd: workspace,
        env: {
          ...process.env,
          GITHUB_WORKSPACE: workspace,
          PATH: `${workspace}:${process.env.PATH}`,
        },
        encoding: "utf8",
      });
      expect(result.status).toBe(0);
      const argv = execFileSync(
        "cat",
        [path.join(workspace, "node-argv.txt")],
        {
          encoding: "utf8",
        },
      )
        .trimEnd()
        .split("\n");
      expect(argv.slice(0, 2)).toEqual(["--check", "--"]);
      expect(argv[2]).toBe(path.join(workspace, "src/ok.js"));
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("rejects symlinks that resolve outside the workspace", async () => {
    const workspace = await fixtureWorkspace();
    const outside = path.join(os.tmpdir(), `outside-${process.pid}.js`);
    try {
      await writeFile(outside, "const outside = true;\n");
      await symlink(outside, path.join(workspace, "src/link.js"));
      const result = runWrapper(["node-check", "src/link.js"], workspace);
      expect(result.status).not.toBe(0);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(outside, { force: true });
    }
  });

  it("keeps the workflow copyable to immutable runner temp storage", async () => {
    const workspace = await fixtureWorkspace();
    try {
      await mkdir(path.join(workspace, ".github/scripts"), { recursive: true });
      await cp(
        wrapperPath,
        path.join(workspace, ".github/scripts/jobbot-claude-validate.sh"),
      );
      const result = spawnSync("install", [
        "-m",
        "0755",
        path.join(workspace, ".github/scripts/jobbot-claude-validate.sh"),
        path.join(workspace, "jobbot-claude-validate"),
      ]);
      expect(result.status).toBe(0);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
