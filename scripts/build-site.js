import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.resolve(
  process.env.JOBBOT_STATIC_DIR ?? path.join(root, "dist"),
);
const output = path.resolve(
  process.env.JOBBOT_SITE_DIR ?? path.join(root, "site-artifact"),
);
// Refuse stale metadata or extra files in a reusable handoff directory.
const allowedOutput = new Set([
  "dist",
  "dist/server",
  "dist/server/index.js",
  "SHA256SUMS",
]);
async function checkOutput(directory, prefix = "") {
  const entries = await fs
    .readdir(directory, { withFileTypes: true })
    .catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
  for (const entry of entries) {
    const name = prefix + entry.name;
    if (entry.isSymbolicLink() || !allowedOutput.has(name)) {
      throw new Error(
        `Use a clean Site artifact directory; unexpected output: ${name}`,
      );
    }
    if (entry.isDirectory())
      await checkOutput(path.join(directory, entry.name), name + "/");
  }
}
await checkOutput(output);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};
const assets = {};
// Explicit allowlist: only the existing production build, never CLI/data/config.
for (const file of [
  "index.html",
  "tracker.html",
  "404.html",
  "manifest.webmanifest",
  "assets/tracker.js",
  "assets/lifecycle-diagram-layout.worker.js",
  "assets/tracker.css",
  "assets/status-hub.css",
]) {
  const bytes = await fs.readFile(path.join(source, file));
  if (!bytes.length) throw new Error(`Empty static build asset: ${file}`);
  assets[`/${file}`] = {
    type: types[path.extname(file)],
    body: bytes.toString("base64"),
  };
}
for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
  assets[`/licenses/${file}`] = {
    type: "text/plain; charset=utf-8",
    body: (await fs.readFile(path.join(root, file))).toString("base64"),
  };
}
const worker = await fs.readFile(
  new URL("./site-worker.js", import.meta.url),
  "utf8",
);
const bundle = `${worker}\nexport default createSiteWorker(${JSON.stringify(assets)});\n`;
// No Site identity is emitted. The owner adds hosting metadata in a private checkout.
await fs.mkdir(path.join(output, "dist/server"), { recursive: true });
await fs.writeFile(path.join(output, "dist/server/index.js"), bundle);
await fs.writeFile(
  path.join(output, "SHA256SUMS"),
  `${createHash("sha256").update(bundle).digest("hex")}  dist/server/index.js\n`,
);
console.log(
  `Packaged ${Object.keys(assets).length} static assets into ${output}`,
);
