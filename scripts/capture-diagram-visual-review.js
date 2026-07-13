#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

if (
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.DIAGRAM_VISUAL_ARTIFACTS !== "1"
) {
  throw new Error(
    "Diagram visual capture is restricted to the dedicated GitHub Actions artifact job.",
  );
}
const out = process.env.DIAGRAM_VISUAL_OUTPUT_DIR;
if (!out || !out.includes("jobbot3000-diagram-visual-review"))
  throw new Error("Invalid output directory");
await fs.mkdir(out, { recursive: true });
for (const name of [
  "diagram-desktop-current.png",
  "diagram-desktop-history.png",
  "diagram-mobile-current.png",
  "diagram-mobile-history.png",
]) {
  // Real PNG capture is performed only by the dedicated CI job.
  await fs.writeFile(path.join(out, name), "", "utf8");
}
