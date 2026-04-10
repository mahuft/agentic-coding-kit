import { expect, test } from "bun:test";
import { realpath } from "node:fs/promises";
import { chdir } from "node:process";
import { getDefaultConfigPath } from "../src/cli";
import { makeTempDir } from "./helpers";

test("getDefaultConfigPath resolves to current working directory", async () => {
  const originalCwd = process.cwd();
  const tempDir = await makeTempDir("cwd");

  try {
    chdir(tempDir);
    const realCwd = await realpath(process.cwd());
    expect(getDefaultConfigPath()).toBe(`${realCwd}/skills-distribution.json`);
  } finally {
    chdir(originalCwd);
  }
});
