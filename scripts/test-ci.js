import { existsSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");
const env = { ...process.env, NO_PROXY: appendNoProxy(process.env.NO_PROXY) };
const browsersCache = process.env.PLAYWRIGHT_BROWSERS_PATH
  ? path.resolve(process.env.PLAYWRIGHT_BROWSERS_PATH)
  : path.join(__dirname, "../.cache/ms-playwright");
const preparedPlaywrightMode = process.env.JOBBOT_PREPARED_PLAYWRIGHT === "1";

function appendNoProxy(current = "") {
  const entries = new Set(current ? current.split(",") : []);
  ["localhost", "127.0.0.1", "::1"].forEach((entry) => entries.add(entry));
  return Array.from(entries).join(",");
}

function runStep(name, command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...env, ...options.env },
    cwd: options.cwd ?? projectRoot,
  });

  if (result.status !== 0) {
    const code = result.status ?? 1;
    console.error(`Step "${name}" failed with exit code ${code}.`);
    process.exit(code);
  }
}

async function mirrorDownloadAndInstall() {
  const browsers = (
    await import("../node_modules/playwright-core/browsers.json", {
      with: { type: "json" },
    })
  ).default.browsers;
  const artifacts = expectedPlaywrightArtifacts(browsers);

  if (preparedPlaywrightMode) {
    verifyPreparedPlaywrightArtifacts(artifacts);
    return { browsersPath: browsersCache };
  }

  for (const { id, archive, remotePath, targetDir } of artifacts) {
    const archivePath = path.join(os.tmpdir(), `playwright-${archive}`);
    const downloadUrl =
      "https://playwright.download.prss.microsoft.com/dbazure/download/playwright/builds" +
      `/${remotePath}`;

    if (!existsSync(targetDir)) {
      if (!existsSync(archivePath)) {
        mkdirSync(path.dirname(archivePath), { recursive: true });
        runStep(`download ${id} archive`, "curl", [
          "-fL",
          "-o",
          archivePath,
          downloadUrl,
        ]);
      }

      rmSync(targetDir, { recursive: true, force: true });
      mkdirSync(targetDir, { recursive: true });
      runStep(`extract ${id}`, "unzip", ["-q", archivePath, "-d", targetDir]);
    }
  }

  runStep("playwright install-deps", "npx", [
    "playwright",
    "install-deps",
    "chromium",
  ]);
  return { browsersPath: browsersCache };
}

function expectedPlaywrightArtifacts(browsers) {
  const chromium = browsers.find((browser) => browser.name === "chromium");
  const headlessShell = browsers.find(
    (browser) => browser.name === "chromium-headless-shell",
  );
  if (!chromium || !headlessShell) {
    throw new Error(
      "Unable to locate Chromium and headless-shell metadata for Playwright.",
    );
  }

  return [
    {
      id: "chromium",
      archive: `chromium-${chromium.revision}.zip`,
      remotePath: `chromium/${chromium.revision}/chromium-linux.zip`,
      targetDir: path.join(browsersCache, `chromium-${chromium.revision}`),
    },
    {
      id: "chromium-headless-shell",
      archive: `chromium-headless-shell-${headlessShell.revision}.zip`,
      remotePath: `chromium/${headlessShell.revision}/chromium-headless-shell-linux.zip`,
      targetDir: path.join(
        browsersCache,
        `chromium_headless_shell-${headlessShell.revision}`,
      ),
    },
  ];
}

function verifyPreparedPlaywrightArtifacts(artifacts) {
  const missing = artifacts.filter(({ targetDir }) => !existsSync(targetDir));
  if (missing.length > 0) {
    throw new Error(
      `Prepared Playwright artifacts are missing beneath ${browsersCache}: ` +
        missing.map(({ id, targetDir }) => `${id} at ${targetDir}`).join(", "),
    );
  }
}

const [maybeInstallOnly] = process.argv.slice(2);
const installOnly = maybeInstallOnly === "install";

const { browsersPath } = await mirrorDownloadAndInstall();

const testEnv = {
  PLAYWRIGHT_BROWSERS_PATH: browsersPath,
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
};

if (!installOnly) {
  runStep("vitest", "vitest", ["run"], { env: testEnv });
  runStep("playwright tests", "playwright", ["test"], { env: testEnv });
}
