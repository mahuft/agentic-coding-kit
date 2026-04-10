import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join, resolve } from "node:path";

export async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(os.tmpdir(), `${prefix}-`));
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function writeText(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

export async function createSkill(root: string, relativePath: string): Promise<string> {
  const skillRoot = resolve(root, relativePath);
  await mkdir(skillRoot, { recursive: true });
  await writeFile(join(skillRoot, "SKILL.md"), `# ${relativePath}\n`, "utf8");
  return skillRoot;
}

export async function createConfigWorkspace(): Promise<{
  workspaceDir: string;
  configPath: string;
  sourceRoot: string;
}> {
  const workspaceDir = await makeTempDir("skills-config");
  const sourceRoot = join(workspaceDir, "skills");
  await mkdir(sourceRoot, { recursive: true });

  return {
    workspaceDir,
    configPath: join(workspaceDir, "skills-distribution.json"),
    sourceRoot,
  };
}

export async function createManagedSymlink(targetPath: string, sourcePath: string): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  await symlink(sourcePath, targetPath, "dir");
}
