// planner.ts — 同步计划构建：对比"期望状态"与"上次状态"计算增量操作。
//
// 这是整个系统的"大脑"。它接收三个输入：
// 1. ResolvedDistributionConfig（配置，定义"想要什么"）
// 2. DiscoveryResult（发现的 skill，定义"有哪些可用"）
// 3. LockFile | null（上次同步状态，定义"现在是什么"）
//
// 输出一个 SyncPlan，描述需要执行哪些文件系统操作才能从"现在"到达"想要"。
// planner 本身不做任何 I/O——它是纯计算，所有文件系统操作都交给 fs-safe.ts。
//
// 新手理解 planner 的关键：它是一个"声明式对比器"，而不是一个命令式操作序列。
// 它只描述"需要做什么"，不关心"怎么做"。

import { isAbsolute, resolve } from "node:path";
import { getAgentSkillsDir, type AgentId } from "./agents";
import type {
  DiscoveryResult,
  LockEntry,
  LockFile,
  ResolvedDistributionConfig,
  SyncPlan,
  UserRootSource,
} from "./types";

interface BuildSyncPlanOptions {
  homeDir: string;
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

// 稳定排序条目：先按 targetPath，再按 sourcePath。
// 这保证多次运行 planner 产出完全相同的结果，
// 使得 lock 文件的 diff 在配置不变时为空。
function sortEntries(entries: LockEntry[]): LockEntry[] {
  return [...entries].sort((left, right) => {
    const byTarget = compareStrings(left.targetPath, right.targetPath);
    if (byTarget !== 0) {
      return byTarget;
    }

    return compareStrings(left.sourcePath, right.sourcePath);
  });
}

// 合并 agent 列表并去重排序。
// 当多条 rule 把同一个 skill 安装到同一个 targetPath 时，
// 所有涉及的 agent 会被合并到 contributingAgents 中。
// 这不是错误——它说明多个 agent 共享了同一个 symlink。
function mergeAgents(target: AgentId[], nextAgents: AgentId[]): AgentId[] {
  const merged = new Set<AgentId>([...target, ...nextAgents]);
  return [...merged].sort(compareStrings);
}

// ── 前置校验：配置引用的 source 必须存在 ──────────────────
//
// 在开始构建 desired entries 之前，先验证所有 rule 引用的 skill/group
// 都能在 discovery 结果中找到。这是一个"快速失败"策略——
// 如果配置引用了不存在的东西，后续计算都是浪费，不如尽早报错。
function assertRuleSourcesExist(config: ResolvedDistributionConfig, discovery: DiscoveryResult): void {
  for (const rule of config.rules) {
    if (rule.source.type === "skill") {
      if (!discovery.skillsById.has(rule.source.path)) {
        throw new Error(`Config 引用了不存在的 skill: ${rule.source.path}`);
      }
      continue;
    }

    if (!discovery.groups.has(rule.source.path)) {
      throw new Error(`Config 引用了不存在的 group: ${rule.source.path}`);
    }
  }
}

// ── 计算 user-scope 下的目标根路径 ──────────────────────────
//
// 对于 user scope，每个 agent 的安装根路径取决于两个因素：
// 1. config.agentUserRoots 中是否有覆盖配置
// 2. 如果没有覆盖，则使用 homeDir
//
// 返回值可能是一个或多个根路径（agent-override 允许指定多个路径），
// 每个路径都会独立展开为一组 LockEntry。
function getUserScopeRoots(
  config: ResolvedDistributionConfig,
  agentId: AgentId,
  homeDir: string,
): Array<{ root: string; source: UserRootSource; normalizedRelativeSkillsDir: string }> {
  const defaultRelativeSkillsDir = getAgentSkillsDir(agentId);
  const overrideRoots = config.agentUserRoots[agentId];
  if (overrideRoots && overrideRoots.length > 0) {
    return overrideRoots.map((root) => ({
      root: isAbsolute(root) ? root : resolve(homeDir, root),
      source: "agent-override",
      // 注意：使用 agent-override 时，normalizedRelativeSkillsDir 固定为 "skills"。
      // 这意味着用户在 agentUserRoots 中指定的路径被视为完整的根路径，
      // skills 子目录不再使用 agent 的默认约定（如 ".claude/skills"），
      // 而是直接在指定路径下创建 skill 目录。
      normalizedRelativeSkillsDir: "skills",
    }));
  }

  return [{ root: homeDir, source: "default-home", normalizedRelativeSkillsDir: defaultRelativeSkillsDir }];
}

// ── 主入口：构建同步计划 ────────────────────────────────────
//
// 整个函数分三个阶段：
// Phase 1：遍历所有 rule，展开成 desired entries（"想要什么"）
// Phase 2：与 previous lock 对比，计算出 creates / relinks / removes
// Phase 3：组装 SyncPlan 返回
export function buildSyncPlan(
  config: ResolvedDistributionConfig,
  discovery: DiscoveryResult,
  previousLock: LockFile | null,
  options: BuildSyncPlanOptions,
): SyncPlan {
  assertRuleSourcesExist(config, discovery);

  // ── Phase 1：构建 desired entries ─────────────────────────
  //
  // desiredByTarget 以 targetPath 为键收集所有期望的 symlink 条目。
  // 如果多条 rule 指向同一个 targetPath 且 sourcePath 相同，agents 会被合并；
  // 如果 sourcePath 不同，说明配置有冲突，立即报错。
  const desiredByTarget = new Map<string, LockEntry>();
  const duplicateCounts = new Map<string, number>();

  for (const rule of config.rules) {
    // 根据 source.type 决定是取单个 skill 还是展开 group。
    const skillIds =
      rule.source.type === "skill"
        ? [rule.source.path]
        : (discovery.groupDescendants.get(rule.source.path) ?? []).slice().sort(compareStrings);

    for (const agentId of rule.agents) {
      const defaultRelativeSkillsDir = getAgentSkillsDir(agentId);
      // 根据 scope.type 选择目标根路径的计算策略：
      // - user scope：使用 homeDir 或 agentUserRoots 覆盖
      // - project scope：直接使用 rule 中声明的 projectRoots
      const scopeRoots =
        rule.scope.type === "user"
          ? getUserScopeRoots(config, agentId, options.homeDir)
          : [...rule.scope.projectRoots].sort(compareStrings).map((root) => ({
              root,
              source: null,
              normalizedRelativeSkillsDir: defaultRelativeSkillsDir,
            }));

      for (const scopeRoot of scopeRoots) {
        const targetSkillsRoot = resolve(scopeRoot.root, scopeRoot.normalizedRelativeSkillsDir);

        for (const skillId of skillIds) {
          const discoveredSkill = discovery.skillsById.get(skillId);
          if (!discoveredSkill) {
            // 理论上不会走到这里，因为前面 assertRuleSourcesExist 已经检查过了。
            // 但作为防御性编程，仍然保留这个检查。
            throw new Error(`无法解析 skill: ${skillId}`);
          }

          const targetPath = resolve(targetSkillsRoot, skillId);
          const existing = desiredByTarget.get(targetPath);

          if (existing) {
            // 同一个 targetPath 被多次引用。检查 sourcePath 是否一致。
            // 如果不一致，说明两条 rule 想把不同的 skill 安装到同一个位置，
            // 这是不可恢复的配置冲突。
            if (existing.sourcePath !== discoveredSkill.sourcePath) {
              throw new Error(
                `目标路径冲突: ${targetPath} 同时指向 ${existing.sourcePath} 和 ${discoveredSkill.sourcePath}`,
              );
            }

            // sourcePath 一致，合并 agent 列表。
            existing.contributingAgents = mergeAgents(existing.contributingAgents, [agentId]);
            duplicateCounts.set(targetPath, (duplicateCounts.get(targetPath) ?? 0) + 1);
            continue;
          }

          // 首次遇到这个 targetPath，创建新的 desired entry。
          desiredByTarget.set(targetPath, {
            skillId,
            sourcePath: discoveredSkill.sourcePath,
            scopeType: rule.scope.type,
            // project scope 下的条目记录具体的 project 根路径，
            // user scope 下这些字段为 null。
            projectRoot: rule.scope.type === "project" ? scopeRoot.root : null,
            effectiveUserRoot: rule.scope.type === "user" ? scopeRoot.root : null,
            userRootSource: rule.scope.type === "user" ? scopeRoot.source : null,
            contributingAgents: [agentId],
            normalizedRelativeSkillsDir: scopeRoot.normalizedRelativeSkillsDir,
            targetSkillsRoot,
            targetPath,
          });
        }
      }
    }
  }

  // 规范化 desired entries：排序 targetPath 和 contributingAgents。
  const desiredEntries = sortEntries([...desiredByTarget.values()]).map((entry) => ({
    ...entry,
    contributingAgents: [...entry.contributingAgents].sort(compareStrings),
  }));

  // ── Phase 2：与 previous lock 对比 ────────────────────────

  const previousEntries = sortEntries(previousLock?.entries ?? []);
  const previousByTarget = new Map(previousEntries.map((entry) => [entry.targetPath, entry]));
  // managedTargetPaths 包含所有历史管理过的 targetPath。
  // 这个集合会被传递给 fs-safe.ts，用于区分"我们管理的 symlink"和"用户自己创建的文件"。
  // 只删除/替换自己创建的 symlink，避免破坏用户的其他文件。
  const managedTargetPaths = new Set(previousEntries.map((entry) => entry.targetPath));

  const creates: LockEntry[] = [];
  const relinks: SyncPlan["relinks"] = [];

  for (const entry of desiredEntries) {
    const previous = previousByTarget.get(entry.targetPath);

    if (!previous) {
      // 这个 targetPath 在上次 lock 中不存在，需要新建。
      creates.push(entry);
      continue;
    }

    // targetPath 存在但 sourcePath 变了，需要重链接（先删后建）。
    // 这发生在用户修改了 rule 的 source 指向不同的 skill 目录时。
    if (previous.sourcePath !== entry.sourcePath) {
      relinks.push({ previous, next: entry });
    }
    // 如果 targetPath 和 sourcePath 都没变，这是一个 unchanged 条目。
    // 它不会被加入 creates / relinks / removes 中的任何一个，
    // 但仍然存在于 desiredEntries 中，表示"保持现状"。
  }

  // removes：上次存在但这次不再需要的条目。
  const desiredTargets = new Set(desiredEntries.map((entry) => entry.targetPath));
  const removes = previousEntries.filter((entry) => !desiredTargets.has(entry.targetPath));

  // deduped：多 agent 共享同一 targetPath 的记录。
  // 这不是错误操作，而是信息性数据，告诉用户哪些 symlink 是共享的。
  const deduped = desiredEntries
    .filter((entry) => duplicateCounts.has(entry.targetPath))
    .map((entry) => ({
      targetPath: entry.targetPath,
      sourcePath: entry.sourcePath,
      contributingAgents: [...entry.contributingAgents],
      duplicateCount: duplicateCounts.get(entry.targetPath) ?? 0,
    }));

  return {
    desiredEntries,
    creates: sortEntries(creates),
    removes,
    relinks: relinks.sort((left, right) => compareStrings(left.next.targetPath, right.next.targetPath)),
    deduped,
    managedTargetPaths,
  };
}
