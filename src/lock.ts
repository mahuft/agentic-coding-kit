// lock.ts — Lock 文件的读写与解析。
//
// Lock 文件是整个同步系统的"状态锚点"。它记录了上一次成功同步后，
// 文件系统上有哪些 symlink 是由本系统管理的。planner.ts 读取 lock 来做
// 增量对比（新增、删除、重链接），sync.ts 在同步完成后写入新的 lock。
//
// 这个模块的职责边界很清晰：
// - 读：从磁盘反序列化 JSON，做严格的字段校验，输出类型安全的 LockFile
// - 写：把 LockFile 序列化为格式化的 JSON 写入磁盘
// - 创建：把 config + entries 组装成新的 LockFile 结构
//
// 新手注意：readLock 支持读取 v1 和 v2 两种版本的 lock 文件（向前兼容），
// 但 createLockFile 始终输出 v2 格式。这意味着每次同步都会把旧版 lock 升级。

import { readFile, writeFile } from "node:fs/promises";
import type { AgentId } from "./agents";
import type { LockEntry, LockFile, ResolvedDistributionConfig, UserRootSource } from "./types";

// 与 config.ts 中相同的工具函数。这里重复定义而不是共享，
// 是因为两个模块对这个工具的需求是独立的，保持各自的自包含性。
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

// 规范化单条 lock entry。
// 唯一的处理是对 contributingAgents 排序，确保同一条目无论写入和读取多少次，
// 内容都是确定性的。这对于 lock 文件的 diff 比对很重要。
function normalizeLockEntry(entry: LockEntry): LockEntry {
  return {
    ...entry,
    contributingAgents: [...entry.contributingAgents].sort(compareStrings),
  };
}

// 解析 userRootSource 字段。
// 与 types.ts 中定义的 UserRootSource 联合类型对应，只接受两个合法字符串值。
// null/undefined 被映射为 null（project scope 下的条目不会有这个字段）。
// 其他值一律报错——宁可误杀也不放过，因为这个字段如果被错误填充，
// 会导致 planner 在下次同步时选择错误的根路径策略。
function parseUserRootSource(value: unknown, label: string): UserRootSource | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value === "default-home" || value === "agent-override") {
    return value;
  }
  throw new Error(`${label} 非法。`);
}

// ── 单条 LockEntry 的解析与校验 ─────────────────────────────
//
// 这是一个严格的前置校验器。对于每个字段，它检查类型和基本的非空约束。
// 所有错误消息都包含 label 参数（如 "lock.entries[3].skillId"），
// 让用户能精确定位问题所在的 JSON 路径。
function parseLockEntry(value: unknown, label: string): LockEntry {
  if (!isPlainObject(value)) {
    throw new Error(`${label} 必须是对象。`);
  }

  const {
    skillId,
    sourcePath,
    scopeType,
    projectRoot,
    effectiveUserRoot,
    userRootSource,
    contributingAgents,
    normalizedRelativeSkillsDir,
    targetSkillsRoot,
    targetPath,
  } = value;

  if (typeof skillId !== "string" || !skillId) {
    throw new Error(`${label}.skillId 非法。`);
  }
  if (typeof sourcePath !== "string" || !sourcePath) {
    throw new Error(`${label}.sourcePath 非法。`);
  }
  if (scopeType !== "user" && scopeType !== "project") {
    throw new Error(`${label}.scopeType 非法。`);
  }
  // projectRoot 允许 null、undefined（统一化为 null）和非空字符串。
  // 不允许空字符串，因为空字符串不是一个合法的路径。
  if (projectRoot !== null && projectRoot !== undefined && typeof projectRoot !== "string") {
    throw new Error(`${label}.projectRoot 非法。`);
  }
  if (effectiveUserRoot !== null && effectiveUserRoot !== undefined && typeof effectiveUserRoot !== "string") {
    throw new Error(`${label}.effectiveUserRoot 非法。`);
  }
  if (!Array.isArray(contributingAgents) || contributingAgents.some((agent) => typeof agent !== "string")) {
    throw new Error(`${label}.contributingAgents 非法。`);
  }
  if (typeof normalizedRelativeSkillsDir !== "string" || !normalizedRelativeSkillsDir) {
    throw new Error(`${label}.normalizedRelativeSkillsDir 非法。`);
  }
  if (typeof targetSkillsRoot !== "string" || !targetSkillsRoot) {
    throw new Error(`${label}.targetSkillsRoot 非法。`);
  }
  if (typeof targetPath !== "string" || !targetPath) {
    throw new Error(`${label}.targetPath 非法。`);
  }

  return normalizeLockEntry({
    skillId,
    sourcePath,
    scopeType,
    // null/undefined 统一为 null。这确保 LockEntry 中 projectRoot 和
    // effectiveUserRoot 的值只有两种可能：null 或非空字符串。
    projectRoot: projectRoot ?? null,
    effectiveUserRoot: effectiveUserRoot ?? null,
    userRootSource: parseUserRootSource(userRootSource, `${label}.userRootSource`),
    contributingAgents: contributingAgents as AgentId[],
    normalizedRelativeSkillsDir,
    targetSkillsRoot,
    targetPath,
  });
}

// ── 读取 Lock 文件 ──────────────────────────────────────────
//
// 从磁盘读取 lock 文件并解析。返回 null 表示"不存在 lock 文件"，
// 这在首次同步时是正常的（planner 会把所有条目都当作 creates 处理）。
// 其他错误（权限不足、JSON 格式错误、字段校验失败）一律向上抛出。
export async function readLock(lockPath: string): Promise<LockFile | null> {
  let rawText: string;

  try {
    rawText = await readFile(lockPath, "utf8");
  } catch (error) {
    // ENOENT 是唯一被吞掉的错误——lock 文件不存在是合法的初始状态。
    // 其他 I/O 错误（权限、磁盘故障等）继续上抛，不在这里静默。
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new Error(`Lock JSON 解析失败: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isPlainObject(parsed)) {
    throw new Error("Lock 顶层必须是对象。");
  }

  // 向前兼容：允许读取 v1 和 v2 两种版本的 lock 文件。
  // v1 是早期格式，v2 增加了更多字段（如 userRootSource）。
  // 但不管读到的是哪个版本，输出都统一升级为 v2 格式。
  if (parsed.version !== 1 && parsed.version !== 2) {
    throw new Error("Lock version 目前只支持 1 或 2。");
  }
  if (typeof parsed.configPath !== "string") {
    throw new Error("Lock configPath 非法。");
  }
  if (typeof parsed.configHash !== "string") {
    throw new Error("Lock configHash 非法。");
  }
  if (typeof parsed.generatedAt !== "string") {
    throw new Error("Lock generatedAt 非法。");
  }
  if (!Array.isArray(parsed.entries)) {
    throw new Error("Lock entries 必须是数组。");
  }

  return {
    version: 2,
    configPath: parsed.configPath,
    configHash: parsed.configHash,
    generatedAt: parsed.generatedAt,
    entries: parsed.entries.map((entry, index) => parseLockEntry(entry, `lock.entries[${index}]`)),
  };
}

// ── 创建新的 LockFile 结构 ──────────────────────────────────
//
// 从 config 和 planner 的输出组装出一个完整的 LockFile。
// 这是一个纯计算操作，不涉及文件 I/O。
// generatedAt 参数允许外部注入时间戳（方便测试），默认使用当前时间。
export function createLockFile(
  config: ResolvedDistributionConfig,
  entries: LockEntry[],
  generatedAt = new Date().toISOString(),
): LockFile {
  return {
    version: 2,
    configPath: config.configPath,
    configHash: config.configHash,
    generatedAt,
    // 按 targetPath 排序确保 lock 文件的内容是确定性的。
    // 这意味着即使 planner 产出 entries 的顺序不同，
    // 最终写入磁盘的 lock 文件内容也是一样的——这对于版本控制友好。
    entries: [...entries]
      .map(normalizeLockEntry)
      .sort((left, right) => left.targetPath.localeCompare(right.targetPath)),
  };
}

// ── 写入 Lock 文件 ──────────────────────────────────────────
//
// 把 LockFile 序列化为格式化的 JSON 并写入磁盘。
// 使用 2 空格缩进 + 末尾换行，保证文件对人类可读且 diff 友好。
export async function writeLock(lockPath: string, lockFile: LockFile): Promise<void> {
  const serialized = `${JSON.stringify(lockFile, null, 2)}\n`;
  await writeFile(lockPath, serialized, "utf8");
}
