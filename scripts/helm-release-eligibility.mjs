import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chartMetadata } from "./helm-publication-contract.mjs";

export function chartRelease(previous, current, changed) {
  const oldChart = chartMetadata(previous);
  const newChart = chartMetadata(current);
  if (changed && oldChart.version === newChart.version) {
    throw new Error(
      "Chart bytes changed: choose a new chart version before publication",
    );
  }
  return oldChart.version !== newChart.version;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const before = process.argv[2];
  if (!/^[a-f0-9]{40}$/.test(before ?? "") || /^0+$/.test(before)) {
    throw new Error(
      "A valid previous main SHA is required for chart publication",
    );
  }
  const previous = execFileSync(
    "git",
    ["show", `${before}:charts/jobbot3000/Chart.yaml`],
    { encoding: "utf8" },
  );
  const current = readFileSync("charts/jobbot3000/Chart.yaml", "utf8");
  const changed =
    execFileSync(
      "git",
      ["diff", "--name-only", before, "HEAD", "--", "charts/jobbot3000"],
      { encoding: "utf8" },
    ).trim() !== "";
  console.log(chartRelease(previous, current, changed));
}
