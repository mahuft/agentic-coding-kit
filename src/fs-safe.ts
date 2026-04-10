// fs-safe.ts — 文件系统安全操作：symlink 的创建、删除与清理。
//
// 这个模块是 planner.ts 的"执行引擎"。planner 计算出 SyncPlan 后，
// applySyncPlan() 负责在文件系统上真正执行这些操作。
//
// "安全"体现在两个方面：
// 1. 只操作由本系统管理的 symlink——如果一个路径被非 symlink 文件占用，
//    或者被非本系统创建的 symlink 占用，一律报错而不是覆盖。
// 2. 删除 symlink 后自动清理空的父目录，但不会删除非空目录。
//
// 新手注意：这个模块的所有操作都是串行的（for 循环 + await），
// 不是并行的。这是刻意的设计——文件系统操作的顺序依赖性很强
// （必须先删除旧链接再创建新链接），并行化反而会引入竞态条件。

import { lstat, mkdir, readlink, readdir, rmdir, symlink, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ApplyResult, LockEntry, SyncPlan } from "./types";

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

// 检查路径是否存在。不使用 access() 而是 lstat()，是因为需要区分
// "路径不存在"和其他错误（如权限不足）。
async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

// ── 删除已管理的 symlink ────────────────────────────────────
//
// 删除一个 symlink 前必须验证它是本系统创建的。
// 验证方式：检查目标路径确实是 symlink 类型（而不是普通文件或目录）。
// 如果目标路径不存在（ENOENT），视为已完成，不报错——
// 这在重试场景下很有用，比如上次同步中途失败，这次重新跑。
async function ensureManagedSymlinkAbsent(entry: LockEntry): Promise<void> {
  try {
    const stats = await lstat(entry.targetPath);
    if (!stats.isSymbolicLink()) {
      // 这是一个关键的安全检查：目标路径被一个非 symlink 的东西占用了
      // （可能是用户手动创建的文件或目录）。我们不能删除它，
      // 因为那会造成数据丢失。报错让用户手动处理。
      throw new Error(`目标路径不是 symlink，拒绝删除: ${entry.targetPath}`);
    }

    await unlink(entry.targetPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }

    throw error;
  }
}

// ── 清理空目录 ──────────────────────────────────────────────
//
// 删除 symlink 后，它所在的目录可能变成了空目录。
// 这个函数从 startPath 的父目录开始向上逐级检查，删除空目录，
// 直到到达 stopPath（通常是 agent 的 skills 根目录）。
// 这避免了在用户文件系统上留下大量空目录碎片。
//
// 新手注意：使用 rmdir 而不是 rm -rf。rmdir 只能删除空目录，
// 所以即使逻辑出错，也不会误删有内容的目录。
async function pruneEmptyDirectories(startPath: string, stopPath: string): Promise<void> {
  let currentPath = dirname(startPath);
  const normalizedStopPath = resolve(stopPath);

  // 向上遍历，但不能越过 stopPath。
  // startsWith 检查确保不会意外跑到 stopPath 之外。
  while (currentPath.startsWith(normalizedStopPath) && currentPath !== normalizedStopPath) {
    const entries = await readdir(currentPath);
    if (entries.length > 0) {
      // 目录不为空，停止向上清理。
      return;
    }

    await rmdir(currentPath);
    currentPath = dirname(currentPath);
  }
}

// ── 判定 symlink 的创建或复用策略 ──────────────────────────
//
// 在创建 symlink 之前，先检查目标路径的状态：
// - 不存在 → 可以安全创建（返回 "create"）
// - 存在且是本系统管理的 symlink 且指向正确的源 → 可以复用（返回 "reuse"）
// - 存在但不是 symlink → 报错（不能覆盖用户的文件）
// - 存在且是 symlink 但不是本系统管理的 → 报错（不能覆盖用户的 symlink）
// - 存在且是本系统管理的 symlink 但指向不同的源 → 报错（这种场景不应出现在 creates 流程中）
//
// managedTargetPaths 来自 SyncPlan，包含所有历史管理过的路径。
// 这是区分"我们的 symlink"和"用户的 symlink"的唯一依据。
async function assertCanCreateOrReuse(
  entry: LockEntry,
  managedTargetPaths: Set<string>,
): Promise<"create" | "reuse"> {
  const exists = await pathExists(entry.targetPath);
  if (!exists) {
    return "create";
  }

  const stats = await lstat(entry.targetPath);
  if (!stats.isSymbolicLink()) {
    throw new Error(`目标路径已被未管理内容占用: ${entry.targetPath}`);
  }

  if (!managedTargetPaths.has(entry.targetPath)) {
    throw new Error(`目标路径已被未管理 symlink 占用: ${entry.targetPath}`);
  }

  // 读取 symlink 的实际指向，验证它是否指向预期的源路径。
  // 需要通过 resolve + dirname 处理相对路径的 symlink，
  // 因为 symlink 的内容可能是相对路径。
  const currentTarget = await readlink(entry.targetPath);
  const resolvedTarget = resolve(dirname(entry.targetPath), currentTarget);
  if (resolvedTarget !== entry.sourcePath) {
    throw new Error(`目标路径已被其他 symlink 占用: ${entry.targetPath}`);
  }

  return "reuse";
}

// ── 创建 symlink（带安全检查）──────────────────────────────
//
// 先调用 assertCanCreateOrReuse 决定是创建新的还是复用已有的。
// 如果需要创建，会先递归创建所有必要的父目录（mkdir recursive），
// 然后创建 symlink。symlink 类型固定为 "dir"，
// 因为 skill 目录始终是目录。
async function createSymlink(
  entry: LockEntry,
  managedTargetPaths: Set<string>,
): Promise<"created" | "reused"> {
  const mode = await assertCanCreateOrReuse(entry, managedTargetPaths);
  if (mode === "reuse") {
    return "reused";
  }

  await mkdir(dirname(entry.targetPath), { recursive: true });
  await symlink(entry.sourcePath, entry.targetPath, "dir");
  return "created";
}

// ── 主入口：执行同步计划 ────────────────────────────────────
//
// 按照 removes → relinks → creates → desiredEntries 的顺序执行。
// 这个顺序是精心安排的：
// 1. 先删除所有需要移除的（包括 relink 的旧链接）
// 2. 再创建 relink 的新链接
// 3. 最后创建全新的链接
// 4. 处理 desiredEntries 中尚未被前面步骤覆盖的条目
//
// 执行顺序是从深到浅（按 targetPath 降序排列），
// 确保删除操作先处理子目录再处理父目录，与 pruneEmptyDirectories 的逻辑匹配。
export async function applySyncPlan(plan: SyncPlan): Promise<ApplyResult> {
  const removed: LockEntry[] = [];
  const created: LockEntry[] = [];
  const relinked: LockEntry[] = [];
  const unchanged: LockEntry[] = [];

  // ── Phase 1：删除 ─────────────────────────────────────────
  //
  // 合并 removes 和 relinks 的 previous 条目。
  // relinks 的 previous 也需要先删除，因为它们指向的源路径已经变了。
  // 按 targetPath 降序排列，确保深层路径先被处理。
  const relinkRemovals = plan.relinks.map((entry) => entry.previous);
  const removals = [...plan.removes, ...relinkRemovals].sort((left, right) =>
    compareStrings(right.targetPath, left.targetPath),
  );

  for (const entry of removals) {
    await ensureManagedSymlinkAbsent(entry);
    // 删除 symlink 后清理空的父目录，但不越过 agent 的 skills 根目录。
    await pruneEmptyDirectories(entry.targetPath, entry.targetSkillsRoot);
    removed.push(entry);
  }

  // ── Phase 2：重链接 ───────────────────────────────────────
  //
  // relink 的 previous 已经在 Phase 1 中被删除了，
  // 这里只需要创建新的 symlink。
  // 如果发现 symlink 已经存在且指向正确（reused），归入 unchanged。
  for (const relink of plan.relinks) {
    const creationMode = await createSymlink(relink.next, plan.managedTargetPaths);
    if (creationMode === "created") {
      relinked.push(relink.next);
    } else {
      unchanged.push(relink.next);
    }
  }

  // ── Phase 3：新建 ─────────────────────────────────────────
  for (const entry of plan.creates) {
    const creationMode = await createSymlink(entry, plan.managedTargetPaths);
    if (creationMode === "created") {
      created.push(entry);
    } else {
      unchanged.push(entry);
    }
  }

  // ── Phase 4：确保所有 desired entries 都被处理 ────────────
  //
  // 前面三个 phase 已经处理了 creates、relinks 和 removes。
  // 但 desiredEntries 中还有一些"既不是新建也不是重链接"的条目——
  // 它们是上次同步已经存在且这次配置没有变化的条目。
  // 遍历所有 desiredEntries，跳过已经在前面处理过的，
  // 对剩余的调用 createSymlink 确保它们确实存在。
  const changedTargets = new Set([
    ...relinked.map((entry) => entry.targetPath),
    ...created.map((entry) => entry.targetPath),
  ]);
  const plannedCreateTargets = new Set(plan.creates.map((entry) => entry.targetPath));
  const plannedRelinkTargets = new Set(plan.relinks.map((entry) => entry.next.targetPath));

  for (const entry of plan.desiredEntries) {
    if (
      changedTargets.has(entry.targetPath) ||
      plannedCreateTargets.has(entry.targetPath) ||
      plannedRelinkTargets.has(entry.targetPath)
    ) {
      continue;
    }

    // 这个条目在上次同步中应该已经存在。
    // 调用 createSymlink 做一次"确认存在"的检查：
    // 如果 symlink 还在且指向正确，返回 "reused"；
    // 如果意外丢失了，会重新创建。
    const creationMode = await createSymlink(entry, plan.managedTargetPaths);
    if (creationMode === "created") {
      created.push(entry);
    } else {
      unchanged.push(entry);
    }
  }

  return { created, removed, relinked, unchanged };
}
