// Loopback-only Node adapter for testing the generated Worker without deployment.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const output = path.resolve(process.env.JOBBOT_SITE_DIR ?? "site-artifact");
const source = await readFile(path.join(output, "dist/server/index.js"));
const { default: worker } = await import(
  `data:text/javascript;base64,${source.toString("base64")}`
);
const server = createServer(async (req, res) => {
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const response = await worker.fetch(
      new Request(new URL(req.url, origin), { method: req.method }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500).end();
  }
});
server.listen(Number(process.env.PORT ?? 0), "127.0.0.1", () => {
  console.log(
    `jobbot static tracker listening on http://127.0.0.1:${server.address().port}`,
  );
});
