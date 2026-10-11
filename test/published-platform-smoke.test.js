import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = fileURLToPath(new URL("../", import.meta.url));
const workflow = parse(
  readFileSync(join(root, ".github/workflows/ci-image.yml"), "utf8"),
);
const steps = workflow.jobs.publish.steps;
const smoke = steps.find(
  (step) => step.name === "Smoke test published multi-arch digest",
);
const image = `example.invalid/synthetic@sha256:${"a".repeat(64)}`;

// Model the classic Docker store's immutable digest-to-image binding. Execute the
// real workflow shell AND smoke-container.sh; no Docker daemon or network is used.
function execute(failure = "", source = smoke.run) {
  const state = mkdtempSync(join(tmpdir(), "jobbot-platform-smoke-"));
  const script = `
    docker() {
      case "$1" in
        run)
          platform="$DOCKER_DEFAULT_PLATFORM"
          printf 'run %s %s\\n' "$platform" "\${@: -1}" >> "$STATE/events"
          if [ -f "$STATE/platform" ] && [ "$(cat "$STATE/platform")" != "$platform" ]; then
            echo 'cannot overwrite digest' >&2
            return 125
          fi
          [ "$FAILURE" != "run:$platform" ] || return 125
          printf '%s' "$platform" > "$STATE/platform"
          touch "$STATE/container"
          ;;
        rm)
          printf 'container-rm\\n' >> "$STATE/events"
          rm -f "$STATE/container"
          ;;
        logs) : ;;
        image)
          [ "$2" = rm ] && [ "$#" = 3 ] && [ "$3" = "$EXPECTED_IMAGE" ] || return 91
          [ ! -f "$STATE/container" ] || return 92
          printf 'image-rm %s\\n' "$3" >> "$STATE/events"
          [ "$FAILURE" != cleanup ] || return 73
          rm "$STATE/platform"
          ;;
        *) return 93 ;;
      esac
    }
    curl() { return 0; }
    npm() {
      printf 'smoke %s\\n' "$DOCKER_DEFAULT_PLATFORM" >> "$STATE/events"
      [ "$FAILURE" != "smoke:$DOCKER_DEFAULT_PLATFORM" ] || return 42
    }
    export -f docker curl npm
    ${source
      .replaceAll(
        "${{ needs.build-and-smoke.outputs.repository }}",
        "example.invalid/synthetic",
      )
      .replaceAll(
        "${{ steps.image.outputs.digest }}",
        `sha256:${"a".repeat(64)}`,
      )}
    printf 'record\\n' >> "$STATE/events"
  `;
  try {
    const result = spawnSync("bash", ["-e", "-c", script], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        STATE: state.replaceAll("\\", "/"),
        EXPECTED_IMAGE: image,
        FAILURE: failure,
      },
    });
    if (result.error) throw result.error;
    return {
      status: result.status,
      events: readFileSync(join(state, "events"), "utf8").trim().split("\n"),
      stderr: result.stderr,
    };
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
}
const success = (platform) => [
  `run ${platform} ${image}`,
  `smoke ${platform}`,
  "container-rm",
  `image-rm ${image}`,
];

describe("published multi-platform smoke", () => {
  it("smokes both platforms and removes only the tested local reference after each", () => {
    const result = execute();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.events).toEqual([
      ...success("linux/amd64"),
      ...success("linux/arm64"),
      "record",
    ]);
  });

  it("reproduces the digest collision when reference cleanup is omitted", () => {
    const result = execute(
      "",
      smoke.run.replace(/^.*docker image rm.*\n?/gm, ""),
    );
    expect(result.status).toBe(125);
    expect(result.stderr).toContain("cannot overwrite digest");
    expect(result.events).not.toContain("record");
  });

  it.each(["linux/amd64", "linux/arm64"])(
    "stops on %s smoke failure without recording success",
    (platform) => {
      const result = execute(`smoke:${platform}`);
      expect(result.status).toBe(42);
      expect(result.events).toEqual([
        ...(platform === "linux/arm64" ? success("linux/amd64") : []),
        `run ${platform} ${image}`,
        `smoke ${platform}`,
        "container-rm",
      ]);
    },
  );

  it("preserves a container-start failure and never reaches the next platform", () => {
    const result = execute("run:linux/amd64");
    expect(result.status).toBe(125);
    expect(result.events).toEqual([`run linux/amd64 ${image}`, "container-rm"]);
  });

  it("fails closed when exact-reference removal fails", () => {
    const result = execute("cleanup");
    expect(result.status).toBe(73);
    expect(result.events).toEqual(success("linux/amd64"));
  });

  it("keeps evidence gated on successful smoke and the original main-push attempt", () => {
    expect(smoke["continue-on-error"]).toBeUndefined();
    for (const name of [
      "Record verified main image for later release",
      "Upload immutable main image record",
    ]) {
      const step = steps.find((entry) => entry.name === name);
      expect(steps.indexOf(step)).toBeGreaterThan(steps.indexOf(smoke));
      expect(step.if).toBe(
        "github.event_name == 'push' && github.ref == 'refs/heads/main' && github.run_attempt == 1",
      );
    }
  });
});
