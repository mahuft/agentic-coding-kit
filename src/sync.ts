// sync.ts — 同步流程主编排器。
//
// 这是整个系统的"总调度"。它把同步流水线的五个阶段串联起来：
//   loadConfig → discoverSkills → buildSyncPlan → applySyncPlan → writeLock
// 每个阶段由各自的模块负责，sync.ts 只负责调用顺序和数据传递。
//
// 设计意图：sync.ts 是唯一一个了解完整流程的模块。
// CLI 层（cli.ts）只需要调用 runSync()，不需要知道内部有哪些阶段。
// 测试时也可以直接调用 runSync() 并注入 homeDir / logger 来控制行为。
//
// 新手注意：writeLock 发生在 applySyncPlan 之后，这意味着如果 apply 阶段
// 中途失败（比如权限不足），lock 文件不会更新。下次运行时，planner 会
// 重新根据旧的 lock 计算计划，自动重试失败的操作。

import os from "node:os";
import { loadConfig } from "./config";
import { discoverSkills } from "./discovery";
import { applySyncPlan } from "./fs-safe";
import { createLockFile, readLock, writeLock } from "./lock";
import { buildSyncPlan } from "./planner";
import type { SyncResult } from "./types";

// ── 同步选项 ────────────────────────────────────────────────
//
// 所有字段都是可选的，支持依赖注入，方便测试。
// - generatedAt：注入时间戳，避免测试中产生不确定的输出
// - homeDir：覆盖 os.homedir()，避免测试依赖真实主目录
// - logger：替换 console.log，方便在测试中捕获输出
interface RunSyncOptions {
  generatedAt?: string;
  homeDir?: string;
  logger?: (message: string) => void;
}

// ── 摘要格式化工具 ──────────────────────────────────────────
//
// 下面两个函数负责把 SyncResult 格式化为人类可读的摘要文本。
// 它们只在 runSync 的末尾被调用，输出到 logger（默认是 console.log）。

// 格式化一个条目列表。列表为空时只显示计数（如 "Created: 0"），
// 列表非空时显示计数和每个条目的缩进详情。
function formatEntryList(label: string, entries: string[]): string[] {
  if (entries.length === 0) {
    return [`${label}: 0`];
  }

  return [`${label}: ${entries.length}`, ...entries.map((entry) => `  - ${entry}`)];
}

// 格式化完整的同步摘要。包含四个操作类别和一个 lock 路径。
// deduped 条目的格式比较特殊：它显示了 targetPath <= sourcePath 的映射关系
// 和共享该 symlink 的 agent 列表。
function formatSummary(result: SyncResult): string {
  const deduped = result.plan.deduped.map(
    (entry) => `${entry.targetPath} <= ${entry.sourcePath} (${entry.contributingAgents.join(", ")})`,
  );

  return [
    ...formatEntryList("Created", result.applyResult.created.map((entry) => entry.targetPath)),
    ...formatEntryList("Removed", result.applyResult.removed.map((entry) => entry.targetPath)),
    ...formatEntryList("Relinked", result.applyResult.relinked.map((entry) => entry.targetPath)),
    ...formatEntryList("Deduped", deduped),
    `Lock: ${result.config.lockPath}`,
  ].join("\n");
}

// ── 主入口：执行一次完整同步 ────────────────────────────────
export async function runSync(
  configPath: string,
  options: RunSyncOptions = {},
): Promise<SyncResult> {
  // Phase 1：加载并校验配置文件。
  // 如果配置文件不存在或格式错误，这里就会抛出异常，后续阶段不会执行。
  const config = await loadConfig(configPath);

  // Phase 2：发现所有可用的 skill。
  // 递归扫描 sourceRoot 目录，产出 DiscoveryResult。
  const discovery = await discoverSkills(config.sourceRoot);

  // Phase 3：读取上次的 lock 文件。
  // 首次运行时返回 null，planner 会把所有条目当作 creates。
  const previousLock = await readLock(config.lockPath);

  // Phase 4：构建同步计划。
  // 纯计算，不涉及 I/O。对比 config + discovery（期望）与 previousLock（现状），
  // 产出需要执行的 creates / removes / relinks 操作列表。
  const plan = buildSyncPlan(config, discovery, previousLock, {
    homeDir: options.homeDir ?? os.homedir(),
  });

  // Phase 5：执行文件系统操作。
  // 串行执行 symlink 的创建、删除、重链接。
  // 如果中途失败，已经执行的操作不会被回滚，但 lock 不会更新。
  const applyResult = await applySyncPlan(plan);

  // Phase 6：生成新的 lock 文件并写入磁盘。
  // 使用 planner 产出的 desiredEntries（而不是 applyResult）来创建 lock，
  // 因为 lock 记录的是"期望达到的最终状态"，而不是"执行过程中做了什么"。
  const lock = createLockFile(config, plan.desiredEntries, options.generatedAt);
  await writeLock(config.lockPath, lock);

  // 打包所有阶段的产物，方便调用方做后续处理（比如打印摘要）。
  const result = {
    config,
    lock,
    plan,
    applyResult,
  } satisfies SyncResult;

  // 输出同步摘要。默认使用 console.log，测试时可通过 options.logger 注入。
  (options.logger ?? console.log)(formatSummary(result));
  return result;
}
