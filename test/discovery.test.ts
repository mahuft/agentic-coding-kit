import { expect, test } from "bun:test";
import { join } from "node:path";
import { discoverSkills } from "../src/discovery";
import { createSkill, createConfigWorkspace, writeText } from "./helpers";

test("discoverSkills finds standalone and nested skills, and stops at concrete skill roots", async () => {
  const { sourceRoot } = await createConfigWorkspace();

  await createSkill(sourceRoot, "teach-code-comments");
  await createSkill(sourceRoot, "analyze-codebase-workflow/clarify-and-plan");
  await createSkill(sourceRoot, "analyze-codebase-workflow/execute-analysis");
  await writeText(join(sourceRoot, "analyze-codebase-workflow/README.md"), "group readme\n");
  await writeText(
    join(sourceRoot, "teach-code-comments/agents/openai.yaml"),
    "model: gpt\n",
  );
  await writeText(
    join(sourceRoot, "teach-code-comments/references/example.md"),
    "reference\n",
  );
  await writeText(join(sourceRoot, ".DS_Store"), "ignored\n");

  const discovery = await discoverSkills(sourceRoot);

  expect([...discovery.skillsById.keys()]).toEqual([
    "analyze-codebase-workflow/clarify-and-plan",
    "analyze-codebase-workflow/execute-analysis",
    "teach-code-comments",
  ]);
  expect(discovery.groups.has("analyze-codebase-workflow")).toBe(true);
  expect(discovery.groupDescendants.get("analyze-codebase-workflow")).toEqual([
    "analyze-codebase-workflow/clarify-and-plan",
    "analyze-codebase-workflow/execute-analysis",
  ]);
  expect(discovery.skillsById.has("teach-code-comments/agents")).toBe(false);
});
