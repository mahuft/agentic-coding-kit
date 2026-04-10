// types.ts — 整个 skills-distribution 系统的共享协议层。
//
// 这个文件只做类型导出，不包含任何运行时逻辑。
// 它的职责是定义所有跨模块传递的数据结构，让 config / discovery / planner /
// lock / fs-safe / sync 各模块用同一套"合约"对接。
// 新手阅读时要注意：这里每个 interface 都在后续某个模块被"生产"一次、
// 在另一个模块被"消费"一次，类型的字段所有权和填写职责是分散的。

import type { AgentId } from "./agents";

// ── Skill 来源引用 ──────────────────────────────────────────
//
// DistributionRule 里用到的 source 字段类型。
// type: "skill" 表示精确引用单个 skill；type: "group" 表示引用一整组 skill。
// path 是相对于 sourceRoot 的规范化相对路径（不带前导 ./，用 / 分隔）。
// 消费方：planner.ts 在构建 desired entries 时根据 type 决定是取单个 skill
// 还是展开 group 的全部 descendant。
export interface SkillSourceRef {
  type: "skill" | "group";
  path: string;
}

// ── 分发作用域 ──────────────────────────────────────────────
//
// 两条作用域变体决定了 symlink 最终安装到"用户主目录"还是"项目目录"。
// planner.ts 会根据 scope.type 选择不同的目标路径计算策略。

// UserScope：skill 安装到用户主目录下的 agent skills 目录。
// 这是默认作用域，一条规则如果只写 `"scope": { "type": "user" }` 即可。
export interface UserScope {
  type: "user";
}

// ProjectScope：skill 安装到一个或多个项目根目录下。
// projectRoots 里的每条路径都会被独立展开为一条 LockEntry。
// config.ts 在解析时会验证每个 projectRoot 对应的目录真实存在。
export interface ProjectScope {
  type: "project";
  projectRoots: string[];
}

// 联合类型，通过 discriminated union 让下游可以 type-narrow。
export type DistributionScope = UserScope | ProjectScope;

// UserRootSource 标记 user-scope 下目标路径的"根目录来源"：
// - "default-home"：直接用 os.homedir()，大多数场景走这条路径。
// - "agent-override"：通过 config.agentUserRoots 显式覆盖了某个 agent 的安装根目录。
// lock.ts 会把这个标记写进 lock 文件，方便下次同步时复用相同的根路径策略。
export type UserRootSource = "default-home" | "agent-override";

// ── 分发规则 ────────────────────────────────────────────────
//
// 对应 skills-distribution.json 里 rules 数组中的单条规则。
// config.ts 负责解析和校验；planner.ts 负责把 rule 展开成具体的 LockEntry。
// 一条 rule 的含义：把 source（skill 或 group）分发给 agents 列表中的
// 每个 agent，安装到 scope 指定的作用域下。
export interface DistributionRule {
  source: SkillSourceRef;
  agents: AgentId[];
  scope: DistributionScope;
}

// ── 配置解析后的完整输出 ────────────────────────────────────
//
// config.ts 的 loadConfig() 返回这个结构。
// 它在原始 JSON 的基础上补齐了所有绝对路径、hash、lock 路径等派生信息，
// 使得下游模块（planner / sync）不再需要关心路径解析和文件校验。
export interface ResolvedDistributionConfig {
  version: 1;
  // 配置文件自身的绝对路径，lock 文件用它来判断"配置文件是否移动过"。
  configPath: string;
  // 配置文件所在目录的绝对路径，所有相对路径的基准点。
  configDir: string;
  // 配置文件内容的 SHA-256 hash，用于检测配置是否发生了变更。
  configHash: string;
  // skill 源目录的绝对路径，discovery.ts 以此为根递归扫描。
  sourceRoot: string;
  // lock 文件的绝对路径，固定与配置文件同目录。
  lockPath: string;
  rules: DistributionRule[];
  // 每个 agent 可以被显式指定一组替代的用户根目录。
  // 键是 AgentId，值是绝对路径数组。
  // 如果某个 agent 没有出现在这里，planner 会回退到默认的 homeDir 策略。
  agentUserRoots: Partial<Record<AgentId, string[]>>;
}

// ── Skill 发现阶段的数据结构 ───────────────────────────────
//
// discovery.ts 的 discoverSkills() 产出这些结构。

// 单个被发现的 skill。
// id 是相对于 sourceRoot 的路径（如 "analyze-codebase-workflow"），
// sourcePath 是该 skill 目录的绝对路径（用于后续创建 symlink 的源）。
export interface DiscoveredSkill {
  id: string;
  sourcePath: string;
}

// discoverSkills() 的完整输出。
// 除了 skillsById（skill id → skill 映射），还包含 group 信息：
// groups 是所有"包含子 skill 的中间目录"的集合，
// groupDescendants 记录每个 group 目录下有哪些 skill id。
export interface DiscoveryResult {
  sourceRoot: string;
  skillsById: Map<string, DiscoveredSkill>;
  groups: Set<string>;
  groupDescendants: Map<string, string[]>;
}

// ── Lock 条目 ───────────────────────────────────────────────
//
// Lock 文件里的每条记录对应一个已安装的 symlink。
// 它是 planner.ts 的输出、lock.ts 的持久化单元、fs-safe.ts 的操作对象。
// 每个字段都有明确的"填写者"和"消费者"，新手容易把所有字段看作平等的，
// 实际上它们的归属和生命周期各不相同。
export interface LockEntry {
  // skill 的逻辑 ID，与 DiscoveryResult.skillsById 的 key 对应。
  skillId: string;
  // skill 源目录的绝对路径，symlink 的创建目标。
  sourcePath: string;
  // 该条目属于 user scope 还是 project scope。
  scopeType: DistributionScope["type"];
  // project scope 下的项目根路径；user scope 下为 null。
  projectRoot: string | null;
  // user scope 下实际使用的用户根目录；project scope 下为 null。
  effectiveUserRoot: string | null;
  // user scope 下标记根目录来源（默认 home 还是 agent 覆盖）。
  userRootSource: UserRootSource | null;
  // 所有引用了同一个 targetPath 的 agent 列表。
  // 当多条 rule 把同一个 skill 分发给同一个位置时，agents 会被合并。
  contributingAgents: AgentId[];
  // agent 的 skills 目录相对于根目录的路径（如 ".claude/skills"）。
  normalizedRelativeSkillsDir: string;
  // agent skills 根目录的绝对路径（如 "/home/user/.claude/skills"）。
  targetSkillsRoot: string;
  // symlink 的绝对目标路径（如 "/home/user/.claude/skills/my-skill"）。
  targetPath: string;
}

// ── Lock 文件 ───────────────────────────────────────────────
//
// 持久化到磁盘的 JSON 文件，记录上一次成功同步后的完整状态。
// planner.ts 会读取它来做增量对比：哪些 symlink 需要新建、删除、重链接。
// version 字段支持 v1 和 v2 两种格式的读取，但写入时统一升级为 v2。
export interface LockFile {
  version: 2;
  configPath: string;
  configHash: string;
  generatedAt: string;
  entries: LockEntry[];
}

// ── 去重信息 ────────────────────────────────────────────────
//
// planner.ts 在构建 desired entries 时，如果多条 rule 把同一个 skill
// 安装到同一个 targetPath，会记录去重信息。
// 这不是错误，而是说明多 agent 共享了同一个 symlink。
// sync.ts 的 summary 输出会展示这些信息。
export interface DedupedEntry {
  targetPath: string;
  sourcePath: string;
  contributingAgents: AgentId[];
  duplicateCount: number;
}

// ── 重链接条目 ──────────────────────────────────────────────
//
// 当一个 targetPath 已经存在 symlink，但 sourcePath 发生变化时，
// 需要先删除旧 symlink 再创建新的。
// previous 是 lock 中的旧记录，next 是 planner 计算出的新记录。
export interface RelinkEntry {
  previous: LockEntry;
  next: LockEntry;
}

// ── 同步计划 ────────────────────────────────────────────────
//
// planner.ts 的 buildSyncPlan() 输出。
// 它是对"当前应该到达什么状态"和"需要执行哪些操作"的完整描述。
// fs-safe.ts 的 applySyncPlan() 消费这个结构来执行文件系统操作。
// 注意操作顺序：removes → relinks → creates，这是刻意安排的，
// 确保删除旧链接后再创建新链接，避免路径冲突。
export interface SyncPlan {
  // 当前配置下所有期望存在的条目（包括未变更的）。
  desiredEntries: LockEntry[];
  // 需要新建 symlink 的条目。
  creates: LockEntry[];
  // 需要删除的条目（上次存在但这次不再需要）。
  removes: LockEntry[];
  // 需要重链接的条目（targetPath 不变但 sourcePath 变了）。
  relinks: RelinkEntry[];
  // 多 agent 共享同一 targetPath 的去重记录。
  deduped: DedupedEntry[];
  // 所有历史管理过的 targetPath 集合，fs-safe.ts 用它来判断
  // 一个已有 symlink 是否由本系统管理（只操作自己创建的 symlink）。
  managedTargetPaths: Set<string>;
}

// ── 文件系统操作结果 ────────────────────────────────────────
//
// applySyncPlan() 的输出，记录实际执行了哪些操作。
// 与 SyncPlan 不同，这里区分了"真正创建了新 symlink"和"发现已存在且一致所以跳过"。
export interface ApplyResult {
  created: LockEntry[];
  removed: LockEntry[];
  relinked: LockEntry[];
  unchanged: LockEntry[];
}

// ── 一次完整同步的结果 ──────────────────────────────────────
//
// sync.ts 的 runSync() 返回这个结构，把整个同步流程中各阶段的产物打包在一起，
// 方便 CLI 层打印摘要或调用方做后续处理。
export interface SyncResult {
  config: ResolvedDistributionConfig;
  lock: LockFile;
  plan: SyncPlan;
  applyResult: ApplyResult;
}
