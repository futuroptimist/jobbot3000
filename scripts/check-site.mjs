// Compare the actual packaged Worker with the unchanged production static server.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const source = path.resolve(process.env.JOBBOT_STATIC_DIR ?? "dist");
const output = path.resolve(process.env.JOBBOT_SITE_DIR ?? "site-artifact");
const bundle = await readFile(path.join(output, "dist/server/index.js"));
const { default: worker } = await import(
  `data:text/javascript;base64,${bundle.toString("base64")}`
);
const server = spawn(process.execPath, ["scripts/static-server.js"], {
  env: {
    ...process.env,
    JOBBOT_STATIC_DIR: source,
    HOST: "127.0.0.1",
    PORT: "0",
  },
  stdio: ["ignore", "pipe", "inherit"],
});
try {
  const origin = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(
      () => reject(new Error("Static server startup timed out")),
      15000,
    );
    const done = (error, origin) => {
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(origin);
    };
    server.once("error", (error) => done(error));
    server.once("exit", (code) =>
      done(new Error(`Static server exited ${code}`)),
    );
    server.stdout.on("data", (bytes) => {
      output += bytes.toString();
      const match = output.match(/listening on (http:\/\/[^\s]+)/u);
      if (match) done(null, match[1]);
    });
  });
  const files = await readdir(source, { recursive: true, withFileTypes: true });
  const routes = files
    .filter((entry) => entry.isFile())
    .map(
      (entry) =>
        "/" +
        path
          .relative(
            source,
            path.join(entry.parentPath ?? entry.path, entry.name),
          )
          .split(path.sep)
          .join("/"),
    );
  routes.push(
    "/",
    "/tracker",
    "/tracker/",
    "/healthz",
    "/livez",
    "/health",
    "/ready",
    "/missing",
  );
  for (const route of routes)
    for (const method of ["GET", "HEAD"]) {
      const expected = await fetch(origin + route, {
        method,
        headers: { "x-forwarded-proto": "https" },
      });
      const actual = await worker.fetch(
        new Request("https://example.test" + route, { method }),
      );
      assert.equal(actual.status, expected.status, `${method} ${route} status`);
      for (const header of [
        "content-type",
        "cache-control",
        "content-security-policy",
        "permissions-policy",
        "referrer-policy",
        "x-content-type-options",
        "cross-origin-opener-policy",
        "strict-transport-security",
      ]) {
        assert.equal(
          actual.headers.get(header),
          expected.headers.get(header),
          `${method} ${route}: ${header}`,
        );
      }
      assert.deepEqual(
        Buffer.from(await actual.arrayBuffer()),
        Buffer.from(await expected.arrayBuffer()),
        `${method} ${route} bytes`,
      );
    }
  for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
    const response = await worker.fetch(
      new Request(`https://example.test/licenses/${file}`),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      await readFile(file),
    );
  }
  console.log(
    `Verified packaged Worker against ${routes.length} production routes and both license notices`,
  );
} finally {
  if (server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await exited;
  }
}
