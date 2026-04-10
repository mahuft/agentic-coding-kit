// agents.ts — AI coding agent 注册表。
//
// 这个模块是整个系统的"已知 agent 知识库"。它回答两个核心问题：
// 1. 系统支持哪些 agent？（通过 AGENT_REGISTRY）
// 2. 每个 agent 的 skills 目录约定路径是什么？（通过 getAgentSkillsDir）
//
// 所有 agent 相关的类型判断都在这里集中，其他模块通过 import AgentId 和
// isAgentId() 来确保只能处理已注册的 agent。
// 新手注意：这里的数据是"约定"而非"配置"，agent 的 skills 目录路径是
// 硬编码的先验知识，不是从用户配置里读出来的。

// 大部分 agent 遵循统一的 ".agents/skills" 约定。
// 只有少数 agent 有自己独特的目录命名（如 claude-code 用 ".claude/skills"），
// 这些例外通过各自的键值对显式声明，而不是用某种映射规则推导。
const SHARED_SKILLS_DIR = ".agents/skills";

// Agent 注册表。键是 agent 的唯一标识符，值是该 agent 的 skills 目录
// 相对于用户/项目根目录的路径。
// 注意：这个对象被声明为 `as const`，意味着：
// 1. TypeScript 会把键推导为字面量联合类型（AgentId）
// 2. 运行时无法被意外修改
// config.ts 在解析用户配置时用 isAgentId() 校验 agent 名是否在这个表里；
// planner.ts 用 getAgentSkillsDir() 计算每个 agent 的目标安装路径。
export const AGENT_REGISTRY = {
  amp: SHARED_SKILLS_DIR,
  antigravity: SHARED_SKILLS_DIR,
  cline: SHARED_SKILLS_DIR,
  codex: SHARED_SKILLS_DIR,
  cursor: SHARED_SKILLS_DIR,
  "deep-agents": SHARED_SKILLS_DIR,
  firebender: SHARED_SKILLS_DIR,
  "gemini-cli": SHARED_SKILLS_DIR,
  "github-copilot": SHARED_SKILLS_DIR,
  "kimi-code-cli": SHARED_SKILLS_DIR,
  opencode: SHARED_SKILLS_DIR,
  warp: SHARED_SKILLS_DIR,
  // 以下 agent 使用各自独特的目录约定：
  augment: ".augment/skills",
  "ibm-bob": ".bob/skills",
  "claude-code": ".claude/skills",
  openclaw: "skills",
  codebuddy: ".codebuddy/skills",
  "command-code": ".commandcode/skills",
  continue: ".continue/skills",
  "cortex-code": ".cortex/skills",
  crush: ".crush/skills",
  droid: ".factory/skills",
  goose: ".goose/skills",
  junie: ".junie/skills",
  "iflow-cli": ".iflow/skills",
  "kilo-code": ".kilocode/skills",
  "kiro-cli": ".kiro/skills",
  kode: ".kode/skills",
  mcpjam: ".mcpjam/skills",
  "mistral-vibe": ".vibe/skills",
  mux: ".mux/skills",
  openhands: ".openhands/skills",
  pi: ".pi/skills",
  qoder: ".qoder/skills",
  "qwen-code": ".qwen/skills",
  "roo-code": ".roo/skills",
  trae: ".trae/skills",
  "trae-cn": ".trae/skills",
  windsurf: ".windsurf/skills",
  zencoder: ".zencoder/skills",
  neovate: ".neovate/skills",
  pochi: ".pochi/skills",
  adal: ".adal/skills",
} as const;

// AgentId 是从 AGENT_REGISTRY 的键自动推导出的联合类型。
// 这保证了一个编译期约束：只有注册表里存在的 agent 名才能通过类型检查。
// types.ts 的 LockEntry 和 DistributionRule 都引用这个类型来标注 agent 字段。
export type AgentId = keyof typeof AGENT_REGISTRY;

// 运行时的 agent ID 校验器。
// config.ts 在解析用户配置的 rules[].agents 时调用它，拒绝未注册的 agent 名。
// 返回类型是 type predicate（`value is AgentId`），让调用方在 if 分支里
// 自动获得类型收窄。
export function isAgentId(value: string): value is AgentId {
  return value in AGENT_REGISTRY;
}

// 根据 agent ID 获取其 skills 目录的相对路径。
// planner.ts 用这个路径拼接出 targetSkillsRoot（绝对路径）。
// 注意返回值是相对路径（如 ".claude/skills"），不是绝对路径；
// 绝对路径的计算由 planner.ts 根据 homeDir 或 projectRoot 完成。
export function getAgentSkillsDir(agentId: AgentId): string {
  return AGENT_REGISTRY[agentId];
}

// 所有已知 agent ID 的排序数组。
// 主要用于 config.ts 在校验失败时向用户展示可选 agent 列表。
// 排序保证错误消息的输出是确定性的、可测试的。
export const KNOWN_AGENT_IDS = Object.keys(AGENT_REGISTRY).sort() as AgentId[];
