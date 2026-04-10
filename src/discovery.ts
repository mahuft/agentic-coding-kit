// discovery.ts — Skill 发现阶段：递归扫描源目录。
//
// 这个模块回答一个核心问题："sourceRoot 下有哪些 skill 和 group？"
// 它通过文件系统递归遍历来发现所有包含 SKILL.md 文件的目录（即 skill），
// 并自动推导出 group（包含子 skill 的中间目录）。
//
// 输出是 DiscoveryResult，被 planner.ts 消费。planner 根据 rule.source.type
// 决定是从 skillsById 取单个 skill，还是从 groupDescendants 展开整组。
//
// 发现规则很简单：如果某个目录下直接存在 SKILL.md 文件，它就是一个 skill；
// 它的所有非 skill 祖先目录自动成为 group。

import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { DiscoveredSkill, DiscoveryResult } from "./types";

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

// 过滤掉 macOS 的 .DS_Store 和所有以 "." 开头的隐藏文件/目录。
// 这保证了 discovery 不会把版本控制目录（.git）、IDE 配置（.vscode）等
// 误识别为 skill 或 group 的一部分。
function shouldIgnoreEntry(name: string): boolean {
  return name === ".DS_Store" || name.startsWith(".");
}

// ── 主入口：发现所有 skill ──────────────────────────────────
//
// 执行一次从 sourceRoot 开始的深度优先递归遍历。
// 内部用闭包引用 skillsById / groups / groupDescendants 三个可变集合，
// 避免在递归调用间来回传递这些累加器。
export async function discoverSkills(sourceRoot: string): Promise<DiscoveryResult> {
  const normalizedSourceRoot = resolve(sourceRoot);
  const skillsById = new Map<string, DiscoveredSkill>();
  const groups = new Set<string>();
  const groupDescendants = new Map<string, string[]>();

  // 递归遍历函数。currentPath 是当前正在扫描的绝对路径，
  // relativePath 是相对于 sourceRoot 的路径（空字符串表示根目录）。
  // 返回值是当前目录及其所有子目录中发现的 skill ID 列表。
  async function walk(currentPath: string, relativePath: string): Promise<string[]> {
    const entries = (await readdir(currentPath, { withFileTypes: true }))
      .filter((entry) => !shouldIgnoreEntry(entry.name))
      // 排序保证遍历顺序是确定性的，不受文件系统返回顺序影响。
      .sort((left, right) => compareStrings(left.name, right.name));

    // 判定当前目录是否是 skill 的唯一标准：是否存在 SKILL.md 文件。
    // 这意味着 skill 的身份完全由文件系统中的一个约定文件决定，
    // 不需要在配置里额外声明。
    const hasSkill = entries.some((entry) => entry.isFile() && entry.name === "SKILL.md");

    if (hasSkill) {
      // 如果根目录本身就是 skill，这是一个配置错误——
      // 因为 group 和 skill 不能占据同一路径空间。
      if (!relativePath) {
        throw new Error(`Source root ${normalizedSourceRoot} 不能直接是 concrete skill 根目录。`);
      }

      // skill 的 id 就是相对路径（如 "my-group/my-skill"），
      // sourcePath 是绝对路径，后续 fs-safe.ts 用它作为 symlink 的目标。
      const skill = {
        id: relativePath,
        sourcePath: resolve(currentPath),
      } satisfies DiscoveredSkill;

      skillsById.set(skill.id, skill);
      // 返回当前 skill 的 id，让父目录知道自己的 descendant 列表。
      return [skill.id];
    }

    // 当前目录不是 skill，继续向子目录递归。
    const descendants: string[] = [];

    for (const entry of entries) {
      // 跳过非目录项（普通文件、符号链接等）。
      // 只有目录才可能包含 skill 或成为 group。
      if (!entry.isDirectory()) {
        continue;
      }

      const childRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      const childPath = join(currentPath, entry.name);
      const childDescendants = await walk(childPath, childRelativePath);
      descendants.push(...childDescendants);
    }

    descendants.sort(compareStrings);

    // 如果当前目录有 relativePath（不是根目录）且包含 descendant，
    // 它自动成为一个 group。这意味着 group 不是用户显式声明的，
    // 而是由文件系统结构隐式推导出来的——新手容易忽略这个隐含约定。
    if (relativePath && descendants.length > 0) {
      groups.add(relativePath);
      groupDescendants.set(relativePath, [...descendants]);
    }

    return descendants;
  }

  // 从根目录开始遍历。空字符串表示根目录自身没有 relativePath。
  await walk(normalizedSourceRoot, "");

  return {
    sourceRoot: normalizedSourceRoot,
    skillsById,
    groups,
    groupDescendants,
  };
}
