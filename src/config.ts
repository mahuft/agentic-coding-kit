// config.ts — 配置文件的加载、校验与规范化。
//
// 这个模块是整个同步流水线的第一站。它读取 skills-distribution.json，
// 做严格的格式校验和路径规范化，最终输出一个 ResolvedDistributionConfig。
// 下游模块（planner / sync）拿到这个结构后，不再需要关心任何文件 I/O 或
// 路径解析问题——所有"脏活"都集中在这里做完了。
//
// 设计特点：校验风格是"白名单式"的——只允许明确声明的字段，遇到未知字段直接报错。
// 这样可以在用户写错配置时尽早发现问题，而不是默默忽略。

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { KNOWN_AGENT_IDS, isAgentId, type AgentId } from "./agents";
import type { DistributionRule, ProjectScope, ResolvedDistributionConfig, UserScope } from "./types";

// 默认文件名常量。config.ts 定义、cli.ts 和 sync.ts 引用。
export const DEFAULT_CONFIG_FILE_NAME = "skills-distribution.json";
export const DEFAULT_LOCK_FILE_NAME = "skills-distribution.lock";

// ── 通用校验工具 ────────────────────────────────────────────

// 判断一个值是否是"普通对象"（plain object）。
// 这个工具在多处 parse 函数中作为前置守卫使用，拒绝 null、数组、
// 原型链上的对象等非预期输入。新手容易忽略的是：`typeof null === "object"`
// 以及 `typeof [] === "object"`，所以需要显式排除。
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 白名单式字段校验。确保用户配置里没有拼写错误或已废弃的字段。
// label 参数用于错误消息定位，让用户知道是哪个层级出现了多余字段。
function assertExactKeys(
  value: Record<string, unknown>,
  allowedKeys: string[],
  label: string,
): void {
  const allowedKeySet = new Set(allowedKeys);
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeySet.has(key));

  if (unknownKeys.length > 0) {
    throw new Error(`${label} 包含未知字段: ${unknownKeys.join(", ")}`);
  }
}

// ── 路径规范化 ──────────────────────────────────────────────

// 将用户配置里的 source.path 规范化为 sourceRoot 内部的相对路径。
// 它做了三件事：
// 1. 支持绝对路径和相对路径两种输入（相对路径基于 configDir 解析）
// 2. 确保结果路径在 sourceRoot 内部（防止路径遍历攻击）
// 3. 拒绝空段、"."、".." 等非规范路径
// 返回值是用 "/" 分隔的规范化相对路径（如 "my-group/my-skill"），
// discovery.ts 产出的 skill ID 使用同样的格式，两者才能匹配。
function normalizeSourcePath(
  rawPath: string,
  configDir: string,
  sourceRoot: string,
  label: string,
): string {
  if (!rawPath.trim()) {
    throw new Error(`${label} 不能为空。`);
  }

  const absoluteSourcePath = isAbsolute(rawPath) ? resolve(rawPath) : resolve(configDir, rawPath);
  const canonicalPath = relative(sourceRoot, absoluteSourcePath).replaceAll("\\", "/");

  // 防止路径逃逸：如果 canonicalPath 以 "../" 开头或变成了绝对路径，
  // 说明用户的 source.path 指向了 sourceRoot 外部。
  if (!canonicalPath || canonicalPath.startsWith("../") || canonicalPath === ".." || isAbsolute(canonicalPath)) {
    throw new Error(`${label} 必须指向 sourceRoot 内部路径: ${sourceRoot}`);
  }

  // 拒绝空段（连续斜杠）、当前目录标记、父目录标记。
  // 这些虽然不会造成安全风险，但会让路径匹配变得不可靠。
  const segments = canonicalPath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${label} 必须是 sourceRoot 内部的规范路径。`);
  }

  return segments.join("/");
}

// ── 文件系统断言 ────────────────────────────────────────────

// 验证给定路径存在且是一个目录。
// 用于 sourceRoot 和 projectRoots 的校验。
// 注意：这里把 ENOENT 和"不是目录"分成两种不同的错误消息，
// 方便用户区分"路径写错了"和"路径写对了但指向的是文件"。
async function assertDirectoryExists(path: string, label: string): Promise<void> {
  let stats;

  try {
    stats = await stat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`${label} 不存在: ${path}`);
    }

    throw error;
  }

  if (!stats.isDirectory()) {
    throw new Error(`${label} 不是目录: ${path}`);
  }
}

// ── Scope 解析 ──────────────────────────────────────────────

// 解析 user scope。这是最简单的 scope——只有 type: "user" 一个字段。
// 没有额外数据，因为 user scope 的根目录在 planner.ts 中根据 homeDir 动态计算。
function parseUserScope(value: unknown, label: string): UserScope {
  if (!isPlainObject(value)) {
    throw new Error(`${label} 必须是对象。`);
  }

  assertExactKeys(value, ["type"], label);

  if (value.type !== "user") {
    throw new Error(`${label}.type 必须是 "user"。`);
  }

  return { type: "user" };
}

// 解析 project scope。
// 与 user scope 不同，project scope 需要验证每个 projectRoot 目录真实存在。
// 这就是为什么这个函数是 async 的——它需要做文件系统检查。
// 去重 + 排序确保即使配置里写了重复路径，输出也是确定性的。
async function parseProjectScope(
  value: unknown,
  configDir: string,
  label: string,
): Promise<ProjectScope> {
  if (!isPlainObject(value)) {
    throw new Error(`${label} 必须是对象。`);
  }

  assertExactKeys(value, ["type", "projectRoots"], label);

  if (value.type !== "project") {
    throw new Error(`${label}.type 必须是 "project"。`);
  }

  if (!Array.isArray(value.projectRoots) || value.projectRoots.length === 0) {
    throw new Error(`${label}.projectRoots 必须是非空数组。`);
  }

  // 去重后解析为绝对路径。
  // 注意 new Set() 的去重是基于原始字符串值的，所以 "./foo" 和 "foo"
  // 不会被去重为同一个——它们会被 resolve 成相同的绝对路径，但去重发生在
  // resolve 之前。这里的 [...new Set()] 只是一个保守的快捷方式。
  const projectRoots = [...new Set(value.projectRoots)].map((projectRoot, index) => {
    if (typeof projectRoot !== "string" || !projectRoot.trim()) {
      throw new Error(`${label}.projectRoots[${index}] 必须是非空字符串。`);
    }

    return resolve(configDir, projectRoot);
  });

  // 逐个验证目录存在。失败时用统一前缀标识是哪个字段出了问题。
  for (const projectRoot of projectRoots) {
    await assertDirectoryExists(projectRoot, `${label}.projectRoots`);
  }

  // 排序保证输出的 projectRoots 顺序是确定性的，
  // 不受用户在 JSON 中书写顺序的影响。
  projectRoots.sort((left, right) => left.localeCompare(right));

  return {
    type: "project",
    projectRoots,
  };
}

// ── Rule 解析 ───────────────────────────────────────────────

// 解析单条分发规则。这是配置校验的核心函数，它串联了上面所有子解析器。
// 校验策略：先检查结构合法性（类型、必填字段），再做语义校验
// （agent 是否注册、source 路径是否合法），最后做文件系统校验（scope 里的目录）。
async function parseRule(
  value: unknown,
  configDir: string,
  sourceRoot: string,
  label: string,
): Promise<DistributionRule> {
  if (!isPlainObject(value)) {
    throw new Error(`${label} 必须是对象。`);
  }

  assertExactKeys(value, ["source", "agents", "scope"], label);

  // source 子对象校验
  if (!isPlainObject(value.source)) {
    throw new Error(`${label}.source 必须是对象。`);
  }

  assertExactKeys(value.source, ["type", "path"], `${label}.source`);

  if (value.source.type !== "skill" && value.source.type !== "group") {
    throw new Error(`${label}.source.type 必须是 "skill" 或 "group"。`);
  }

  if (typeof value.source.path !== "string") {
    throw new Error(`${label}.source.path 必须是字符串。`);
  }

  // agents 列表校验
  if (!Array.isArray(value.agents) || value.agents.length === 0) {
    throw new Error(`${label}.agents 必须是非空数组。`);
  }

  // 去重后逐一校验每个 agent 是否在注册表里。
  // 错误消息会列出所有合法的 agent ID，方便用户修正。
  const agents = [...new Set(value.agents)].map((agent, index) => {
    if (typeof agent !== "string" || !isAgentId(agent)) {
      throw new Error(
        `${label}.agents[${index}] 非法。可选值包括: ${KNOWN_AGENT_IDS.join(", ")}`,
      );
    }

    return agent;
  });

  agents.sort((left, right) => left.localeCompare(right));

  // scope 校验：根据 type 分派到不同的子解析器。
  if (!isPlainObject(value.scope) || typeof value.scope.type !== "string") {
    throw new Error(`${label}.scope 必须是带 type 的对象。`);
  }

  const scope =
    value.scope.type === "user"
      ? parseUserScope(value.scope, `${label}.scope`)
      : await parseProjectScope(value.scope, configDir, `${label}.scope`);

  return {
    source: {
      type: value.source.type,
      path: normalizeSourcePath(value.source.path, configDir, sourceRoot, `${label}.source.path`),
    },
    agents,
    scope,
  };
}

// ── Agent 自定义根目录解析 ──────────────────────────────────
//
// 解析可选的 config.agentUserRoots 字段。
// 这个字段允许用户覆盖某些 agent 默认的用户根目录策略。
// 例如，如果用户想把 claude-code 的 skills 安装到非默认位置，
// 可以在这里指定。planner.ts 会优先使用这里的路径，而非 homeDir + 默认 skills 目录。
function parseAgentUserRoots(
  value: unknown,
): Promise<Partial<Record<AgentId, string[]>>> {
  if (value === undefined) {
    return Promise.resolve({});
  }

  if (!isPlainObject(value)) {
    throw new Error("config.agentUserRoots 必须是对象。");
  }

  const result: Partial<Record<AgentId, string[]>> = {};

  for (const [agentId, paths] of Object.entries(value)) {
    if (!isAgentId(agentId)) {
      throw new Error(`config.agentUserRoots.${agentId} 不是合法 agent。`);
    }
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new Error(`config.agentUserRoots.${agentId} 必须是非空数组。`);
    }

    const normalizedPaths = [...new Set(paths)].map((pathValue, index) => {
      if (typeof pathValue !== "string" || !pathValue.trim()) {
        throw new Error(`config.agentUserRoots.${agentId}[${index}] 必须是非空字符串。`);
      }
      return pathValue.trim();
    });

    // 排序保证确定性。
    normalizedPaths.sort((left, right) => left.localeCompare(right));
    result[agentId] = normalizedPaths;
  }

  return Promise.resolve(result);
}

// ── 主入口：加载配置文件 ────────────────────────────────────
//
// 整个模块的对外 API。读取 JSON 文件，解析所有字段，返回一个完全校验过的
// ResolvedDistributionConfig。sync.ts 的 runSync() 第一步就是调用这个函数。
export async function loadConfig(configPath: string): Promise<ResolvedDistributionConfig> {
  const absoluteConfigPath = isAbsolute(configPath) ? configPath : resolve(process.cwd(), configPath);
  const configDir = dirname(absoluteConfigPath);
  const rawText = await readFile(absoluteConfigPath, "utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new Error(
      `Config JSON 解析失败: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isPlainObject(parsed)) {
    throw new Error("Config 顶层必须是对象。");
  }

  assertExactKeys(parsed, ["version", "sourceRoot", "rules", "agentUserRoots"], "config");

  if (parsed.version !== 1) {
    throw new Error("Config version 目前只支持 1。");
  }

  if (!Array.isArray(parsed.rules)) {
    throw new Error("config.rules 必须是数组。");
  }

  // sourceRoot 默认为 "./skills"（相对于配置文件所在目录）。
  // resolve(configDir, ...) 把它变成绝对路径。
  const sourceRootInput = parsed.sourceRoot;
  if (sourceRootInput !== undefined && typeof sourceRootInput !== "string") {
    throw new Error("config.sourceRoot 必须是字符串。");
  }

  const sourceRoot = resolve(configDir, sourceRootInput ?? "./skills");
  // 校验 sourceRoot 目录必须真实存在，否则后续 discovery 会全部失败。
  await assertDirectoryExists(sourceRoot, "sourceRoot");

  // 逐条解析规则。由于每条 rule 可能触发文件系统校验（project scope），
  // 所以是串行的 async 循环，不是并行。
  const rules: DistributionRule[] = [];
  for (const [index, rule] of parsed.rules.entries()) {
    rules.push(await parseRule(rule, configDir, sourceRoot, `config.rules[${index}]`));
  }

  const agentUserRoots = await parseAgentUserRoots(parsed.agentUserRoots);

  return {
    version: 1,
    configPath: absoluteConfigPath,
    configDir,
    // 计算 configHash 用于检测配置变更。
    // planner.ts 通过对比 lock 中的 configHash 和当前 configHash 来判断
    // 是否需要重新规划（虽然当前实现每次都重新规划，但 hash 为未来的增量优化留下了接口）。
    configHash: createHash("sha256").update(rawText).digest("hex"),
    sourceRoot,
    // lock 文件固定与配置文件同目录，文件名是约定好的。
    lockPath: resolve(configDir, DEFAULT_LOCK_FILE_NAME),
    rules,
    agentUserRoots,
  };
}
