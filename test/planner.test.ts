import { expect, test } from "bun:test";
import { buildSyncPlan } from "../src/planner";
import type { DiscoveryResult, LockFile, ResolvedDistributionConfig } from "../src/types";

function makeConfig(): ResolvedDistributionConfig {
  return {
    version: 1,
    configPath: "/tmp/skills-distribution.json",
    configDir: "/tmp",
    configHash: "hash",
    sourceRoot: "/tmp/skills",
    lockPath: "/tmp/skills-distribution.lock",
    rules: [
      {
        source: { type: "skill", path: "teach-code-comments" },
        agents: ["codex", "cursor", "claude-code"],
        scope: { type: "user" },
      },
      {
        source: { type: "group", path: "analyze-codebase-workflow" },
        agents: ["claude-code"],
        scope: { type: "project", projectRoots: ["/projects/a"] },
      },
    ],
    agentUserRoots: {},
  };
}

function makeDiscovery(): DiscoveryResult {
  const skillsById = new Map([
    ["teach-code-comments", { id: "teach-code-comments", sourcePath: "/repo/skills/teach-code-comments" }],
    [
      "analyze-codebase-workflow/clarify-and-plan",
      {
        id: "analyze-codebase-workflow/clarify-and-plan",
        sourcePath: "/repo/skills/analyze-codebase-workflow/clarify-and-plan",
      },
    ],
  ]);

  return {
    sourceRoot: "/repo/skills",
    skillsById,
    groups: new Set(["analyze-codebase-workflow"]),
    groupDescendants: new Map([
      ["analyze-codebase-workflow", ["analyze-codebase-workflow/clarify-and-plan"]],
    ]),
  };
}

test("buildSyncPlan dedupes agents that share the same target skills dir", () => {
  const plan = buildSyncPlan(makeConfig(), makeDiscovery(), null, { homeDir: "/home/test" });
  const sharedEntry = plan.desiredEntries.find((entry) => entry.targetPath.includes(".agents/skills/teach-code-comments"));

  expect(sharedEntry?.contributingAgents).toEqual(["codex", "cursor"]);
  expect(plan.deduped).toHaveLength(1);
});

test("buildSyncPlan removes stale lock entries and detects relinks", () => {
  const previousLock: LockFile = {
    version: 2,
    configPath: "/tmp/skills-distribution.json",
    configHash: "old",
    generatedAt: new Date().toISOString(),
    entries: [
      {
        skillId: "teach-code-comments",
        sourcePath: "/old/source",
        scopeType: "user",
        projectRoot: null,
        effectiveUserRoot: "/home/test",
        userRootSource: "default-home",
        contributingAgents: ["claude-code"],
        normalizedRelativeSkillsDir: ".claude/skills",
        targetSkillsRoot: "/home/test/.claude/skills",
        targetPath: "/home/test/.claude/skills/teach-code-comments",
      },
      {
        skillId: "obsolete",
        sourcePath: "/old/obsolete",
        scopeType: "user",
        projectRoot: null,
        effectiveUserRoot: "/home/test",
        userRootSource: "default-home",
        contributingAgents: ["claude-code"],
        normalizedRelativeSkillsDir: ".claude/skills",
        targetSkillsRoot: "/home/test/.claude/skills",
        targetPath: "/home/test/.claude/skills/obsolete",
      },
    ],
  };

  const plan = buildSyncPlan(makeConfig(), makeDiscovery(), previousLock, { homeDir: "/home/test" });

  expect(plan.relinks).toHaveLength(1);
  expect(plan.removes.map((entry) => entry.targetPath)).toEqual(["/home/test/.claude/skills/obsolete"]);
});

test("buildSyncPlan expands one agent to multiple override config dirs", () => {
  const config = makeConfig();
  config.rules = [
    {
      source: { type: "skill", path: "teach-code-comments" },
      agents: ["claude-code"],
      scope: { type: "user" },
    },
  ];
  config.agentUserRoots = {
    "claude-code": [".claude_alt", ".claude_shared"],
  };

  const plan = buildSyncPlan(config, makeDiscovery(), null, { homeDir: "/home/test" });

  expect(plan.desiredEntries.map((entry) => entry.targetPath)).toEqual([
    "/home/test/.claude_alt/skills/teach-code-comments",
    "/home/test/.claude_shared/skills/teach-code-comments",
  ]);
  expect(plan.desiredEntries.every((entry) => entry.userRootSource === "agent-override")).toBe(true);
});
