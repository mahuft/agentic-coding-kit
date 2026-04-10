import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { createConfigWorkspace, createSkill, makeTempDir, writeJson } from "./helpers";

test("loadConfig resolves relative project roots and preserves agent override dirs", async () => {
  const { workspaceDir, configPath, sourceRoot } = await createConfigWorkspace();
  const projectRoot = await makeTempDir("project-root");
  const relativeProjectRoot = join(workspaceDir, "relative-project");
  const skillRoot = await createSkill(sourceRoot, "teach-code-comments");
  await mkdir(relativeProjectRoot, { recursive: true });

  await writeJson(configPath, {
    version: 1,
    agentUserRoots: {
      "claude-code": [".claude_another", ".claude_shared", ".claude_another"],
    },
    rules: [
      {
        source: { type: "skill", path: "skills/teach-code-comments" },
        agents: ["claude-code", "codex", "codex"],
        scope: { type: "project", projectRoots: [projectRoot, "./relative-project"] },
      },
      {
        source: { type: "skill", path: skillRoot },
        agents: ["claude-code"],
        scope: { type: "user" },
      },
    ],
  });

  const config = await loadConfig(configPath);

  expect(config.rules[0]?.source.path).toBe("teach-code-comments");
  expect(config.rules[1]?.source.path).toBe("teach-code-comments");
  expect(config.rules[0]?.agents).toEqual(["claude-code", "codex"]);
  expect(config.rules[0]?.scope).toEqual({
    type: "project",
    projectRoots: [projectRoot, relativeProjectRoot].sort((a, b) => a.localeCompare(b)),
  });
  expect(config.agentUserRoots["claude-code"]).toEqual([".claude_another", ".claude_shared"]);
  expect(config.sourceRoot).toBe(sourceRoot);
});

test("loadConfig rejects unknown agent", async () => {
  const { configPath, sourceRoot } = await createConfigWorkspace();
  await createSkill(sourceRoot, "teach-code-comments");

  await writeJson(configPath, {
    version: 1,
    rules: [
      {
        source: { type: "skill", path: "skills/teach-code-comments" },
        agents: ["unknown-agent"],
        scope: { type: "user" },
      },
    ],
  });

  expect(loadConfig(configPath)).rejects.toThrow("非法");
});

test("loadConfig rejects empty agent user roots", async () => {
  const { configPath, sourceRoot } = await createConfigWorkspace();
  await createSkill(sourceRoot, "teach-code-comments");

  await writeJson(configPath, {
    version: 1,
    agentUserRoots: {
      "claude-code": [],
    },
    rules: [
      {
        source: { type: "skill", path: "skills/teach-code-comments" },
        agents: ["claude-code"],
        scope: { type: "user" },
      },
    ],
  });

  expect(loadConfig(configPath)).rejects.toThrow("非空数组");
});
