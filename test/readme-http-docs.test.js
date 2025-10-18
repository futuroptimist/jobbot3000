import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const README_PATH = path.resolve("README.md");

describe("README documentation", () => {
  it("documents createHttpClient usage with a runnable example", () => {
    const contents = fs.readFileSync(README_PATH, "utf8");
    const patternParts = [
      "import \\{ createHttpClient \\} from [\"']\\.\\/src\\/services\\/http\\.js[\"'];",
      "[\\s\\S]+const client = createHttpClient\\(",
    ];
    const examplePattern = new RegExp(patternParts.join(""), "m");
    expect(contents).toMatch(examplePattern);
  });
});
