import { expect, test } from "bun:test";
import { lstat, mkdir, readlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { readLock } from "../src/lock";
import { runSync } from "../src/sync";
import { createConfigWorkspace, createManagedSymlink, createSkill, makeTempDir, writeJson, writeText } from "./helpers";

async function expectDirSymlink(targetPath: string, sourcePath: string): Promise<void> {
  const stats = await lstat(targetPath);
  expect(stats.isSymbolicLink()).toBe(true);
  const linkTarget = await readlink(targetPath);
  expect(resolve(dirname(targetPath), linkTarget)).toBe(sourcePath);
}

test("runSync creates user-level symlinks under injected home dir", async () => {
  const { configPath, sourceRoot } = await createConfigWorkspace();
  const homeDir = await makeTempDir("home");
  const skillRoot = await createSkill(sourceRoot, "teach-code-comments");

  await writeJson(configPath, {
    version: 1,
    rules: [
      {
        source: { type: "skill", path: "skills/teach-code-comments" },
        agents: ["claude-code", "codex", "cursor"],
        scope: { type: "user" },
      },
    ],
  });

  const result = await runSync(configPath, {
    homeDir,
    generatedAt: "2026-04-10T00:00:00.000Z",
    logger: () => {},
  });

  await expectDirSymlink(join(homeDir, ".claude/skills/teach-code-comments"), skillRoot);
  await expectDirSymlink(join(homeDir, ".agents/skills/teach-code-comments"), skillRoot);
  expect(result.plan.deduped).toHaveLength(1);
});

test("runSync uses agentUserRoots to distribute one agent into multiple override config dirs", async () => {
  const { configPath, sourceRoot } = await createConfigWorkspace();
  const homeDir = await makeTempDir("home");
  const skillRoot = await createSkill(sourceRoot, "teach-code-comments");

  await writeJson(configPath, {
    version: 1,
    agentUserRoots: {
      "claude-code": [".claude_a", ".claude_b"],
    },
    rules: [
      {
        source: { type: "skill", path: "skills/teach-code-comments" },
        agents: ["claude-code"],
        scope: { type: "user" },
      },
    ],
  });

  await runSync(configPath, { homeDir, logger: () => {} });

  await expectDirSymlink(join(homeDir, ".claude_a/skills/teach-code-comments"), skillRoot);
  await expectDirSymlink(join(homeDir, ".claude_b/skills/teach-code-comments"), skillRoot);
  expect(lstat(join(homeDir, ".claude/skills/teach-code-comments"))).rejects.toThrow();
});

test("runSync creates project-level symlinks for multiple project roots", async () => {
  const { configPath, sourceRoot } = await createConfigWorkspace();
  const projectA = await makeTempDir("project-a");
  const projectB = await makeTempDir("project-b");
  const skillRoot = await createSkill(sourceRoot, "analyze-codebase-workflow/clarify-and-plan");

  await writeJson(configPath, {
    version: 1,
    rules: [
      {
        source: { type: "group", path: "skills/analyze-codebase-workflow" },
        agents: ["claude-code"],
        scope: { type: "project", projectRoots: [projectA, projectB] },
      },
    ],
  });

  await runSync(configPath, { homeDir: await makeTempDir("unused-home"), logger: () => {} });

  await expectDirSymlink(
    join(projectA, ".claude/skills/analyze-codebase-workflow/clarify-and-plan"),
    skillRoot,
  );
  await expectDirSymlink(
    join(projectB, ".claude/skills/analyze-codebase-workflow/clarify-and-plan"),
    skillRoot,
  );
});

test("runSync migrates scope from project to user and prunes empty directories", async () => {
  const { configPath, sourceRoot } = await createConfigWorkspace();
  const homeDir = await makeTempDir("home");
  const projectRoot = await makeTempDir("project");
  const skillRoot = await createSkill(sourceRoot, "analyze-codebase-workflow/clarify-and-plan");

  await writeJson(configPath, {
    version: 1,
    rules: [
      {
        source: { type: "group", path: "skills/analyze-codebase-workflow" },
        agents: ["claude-code"],
        scope: { type: "project", projectRoots: [projectRoot] },
      },
    ],
  });

  await runSync(configPath, { homeDir, logger: () => {} });

  await writeJson(configPath, {
    version: 1,
    rules: [
      {
        source: { type: "group", path: "skills/analyze-codebase-workflow" },
        agents: ["claude-code"],
        scope: { type: "user" },
      },
    ],
  });

  await runSync(configPath, { homeDir, logger: () => {} });

  await expectDirSymlink(
    join(homeDir, ".claude/skills/analyze-codebase-workflow/clarify-and-plan"),
    skillRoot,
  );
  expect(lstat(join(projectRoot, ".claude/skills/analyze-codebase-workflow/clarify-and-plan"))).rejects.toThrow();
  expect(lstat(join(projectRoot, ".claude/skills/analyze-codebase-workflow"))).rejects.toThrow();
});

test("runSync removes stale links from previous lock when source selection shrinks", async () => {
  const { configPath, sourceRoot } = await createConfigWorkspace();
  const homeDir = await makeTempDir("home");
  await createSkill(sourceRoot, "teach-code-comments");
  const staleSkillRoot = await createSkill(sourceRoot, "pdd-prompt-refiner");

  await writeJson(configPath, {
    version: 1,
    rules: [
      {
        source: { type: "skill", path: "skills/teach-code-comments" },
        agents: ["claude-code"],
        scope: { type: "user" },
      },
      {
        source: { type: "skill", path: "skills/pdd-prompt-refiner" },
        agents: ["claude-code"],
        scope: { type: "user" },
      },
    ],
  });

  await runSync(configPath, { homeDir, logger: () => {} });

  await writeJson(configPath, {
    version: 1,
    rules: [
      {
        source: { type: "skill", path: "skills/teach-code-comments" },
        agents: ["claude-code"],
        scope: { type: "user" },
      },
    ],
  });

  await runSync(configPath, { homeDir, logger: () => {} });

  expect(lstat(join(homeDir, ".claude/skills/pdd-prompt-refiner"))).rejects.toThrow();
  expect(staleSkillRoot.endsWith("pdd-prompt-refiner")).toBe(true);
  const lock = await readLock(join(dirname(configPath), "skills-distribution.lock"));
  expect(lock?.entries.map((entry) => entry.skillId)).toEqual(["teach-code-comments"]);
});

test("runSync removes stale links when agent override dirs shrink", async () => {
  const { configPath, sourceRoot } = await createConfigWorkspace();
  const homeDir = await makeTempDir("home");
  const skillRoot = await createSkill(sourceRoot, "teach-code-comments");

  await writeJson(configPath, {
    version: 1,
    agentUserRoots: {
      "claude-code": [".claude_a", ".claude_b"],
    },
    rules: [
      {
        source: { type: "skill", path: "skills/teach-code-comments" },
        agents: ["claude-code"],
        scope: { type: "user" },
      },
    ],
  });

  await runSync(configPath, { homeDir, logger: () => {} });

  await writeJson(configPath, {
    version: 1,
    agentUserRoots: {
      "claude-code": [".claude_a"],
    },
    rules: [
      {
        source: { type: "skill", path: "skills/teach-code-comments" },
        agents: ["claude-code"],
        scope: { type: "user" },
      },
    ],
  });

  await runSync(configPath, { homeDir, logger: () => {} });

  await expectDirSymlink(join(homeDir, ".claude_a/skills/teach-code-comments"), skillRoot);
  expect(lstat(join(homeDir, ".claude_b/skills/teach-code-comments"))).rejects.toThrow();
});

test("runSync fails safely when target path is occupied by unmanaged content", async () => {
  const { configPath, sourceRoot } = await createConfigWorkspace();
  const homeDir = await makeTempDir("home");
  await createSkill(sourceRoot, "teach-code-comments");
  await mkdir(join(homeDir, ".claude/skills/teach-code-comments"), { recursive: true });
  await writeText(join(homeDir, ".claude/skills/teach-code-comments/file.txt"), "owned\n");

  await writeJson(configPath, {
    version: 1,
    rules: [
      {
        source: { type: "skill", path: "skills/teach-code-comments" },
        agents: ["claude-code"],
        scope: { type: "user" },
      },
    ],
  });

  expect(runSync(configPath, { homeDir, logger: () => {} })).rejects.toThrow("未管理内容占用");
});

test("runSync fails when unmanaged symlink already occupies target path", async () => {
  const { configPath, sourceRoot } = await createConfigWorkspace();
  const homeDir = await makeTempDir("home");
  const skillRoot = await createSkill(sourceRoot, "teach-code-comments");
  const otherSource = await makeTempDir("other-source");
  await createManagedSymlink(join(homeDir, ".claude/skills/teach-code-comments"), otherSource);

  await writeJson(configPath, {
    version: 1,
    rules: [
      {
        source: { type: "skill", path: "skills/teach-code-comments" },
        agents: ["claude-code"],
        scope: { type: "user" },
      },
    ],
  });

  expect(skillRoot.endsWith("teach-code-comments")).toBe(true);
  expect(runSync(configPath, { homeDir, logger: () => {} })).rejects.toThrow("未管理 symlink 占用");
});

test("runSync fails when one override dir is occupied by unmanaged content", async () => {
  const { configPath, sourceRoot } = await createConfigWorkspace();
  const homeDir = await makeTempDir("home");
  await createSkill(sourceRoot, "teach-code-comments");
  await mkdir(join(homeDir, ".claude_b/skills/teach-code-comments"), { recursive: true });
  await writeText(join(homeDir, ".claude_b/skills/teach-code-comments/file.txt"), "owned\n");

  await writeJson(configPath, {
    version: 1,
    agentUserRoots: {
      "claude-code": [".claude_a", ".claude_b"],
    },
    rules: [
      {
        source: { type: "skill", path: "skills/teach-code-comments" },
        agents: ["claude-code"],
        scope: { type: "user" },
      },
    ],
  });

  expect(runSync(configPath, { homeDir, logger: () => {} })).rejects.toThrow("未管理内容占用");
});
