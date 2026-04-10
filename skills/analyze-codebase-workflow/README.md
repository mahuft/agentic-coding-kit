# Analyze Codebase Skills

一套结构化的源码探索分析工作流，以可组合的 Skills 形式构建。它引导 Coding Agent 从用户问题出发，经过意图澄清、计划制定、系统化探索，再把参考库知识转化为面向目标库落地的规格与编码任务计划。

## 工作原理

当你让 Agent 理解某个代码库时，工作流不会直接随机读文件，而是先通过高层关系扫描校准一个适中的探索范围：如果问题过大，就先拆成子问题；如果问题过小，就先补入必要上下文。范围稳定后，澄清阶段仍保持“每轮只问 `1` 个问题”的节奏，但在进入确认前必须累计完成 `3-5` 个不同的高价值问题，用来补齐用户意图、范围边界、讲解主轴与证据关注点。随后先提出 `2-3` 种探索方法并给出推荐，再向用户确认当前探索范围与学习目标；确认后才生成探索计划，并按结构化方式探索源码、在计划基础上扩写出更详实的分析报告。

如果你还希望把参考库中的做法迁移到自己的项目里，后续阶段不会直接产出“教学式仿写报告”，而是分成两步：

1. 先产出一份 **代码仿写需求规格说明书**，把参考库模式、目标库现实约束、候选方案、模块落点、关键接口 / 状态约束与验收边界合并成可审查的规格。
2. 再产出一份 **目标库编码任务计划说明书**，在规格基础上继续深入分析当前项目，补齐文件 / 模块 / 类 / 方法 / 流程 / 测试层面的自然语言实现要求，形成可直接交给目标库 Agent 的完整 Agentic Coding 提示词。

## 全局原则

- **结构化优于随意** — 不随机浏览。先澄清，再计划，再执行。
- **前置澄清优于事后补救** — 第 2、3、4、5 步都应尽可能在规划阶段主动暴露不确定性并提问。
- **自审优于跳过** — 每个阶段的关键产物在展示前都经过 reviewer 自审。
- **用户门控优于自治** — 每个阶段都需要你的明确批准。
- **证据优于断言** — 发现基于具体代码引用，而非模糊概括。

## 工作流

```markdown
用户提问
  │
  ▼
① analyze-codebase（入口）
  │  确保使用结构化工作流，而非随意浏览
  ▼
② clarify-and-plan（澄清与计划）
  │  高层关系扫描 → 范围校准 → 一次一问、累计 `3-5` 个高价值问题 → `2-3` 种探索方法与推荐
  │  用户先确认探索范围与学习目标，再生成以讲解主线和推荐探索方法为中心的探索计划
  │  ★ HARD-GATE：先确认范围/目标；计划经自审后仍需用户批准才能进入下一步
  ▼
③ execute-analysis（执行分析）
  │  以 `analysis-plan.md` 为基线，系统化深化研究参考库，补齐环境/问题/证据/调试线索，产出更详实的分析报告
  │  ★ HARD-GATE：用户批准后才能进入下一步
  ▼
④ code-imitation-spec（代码仿写需求规格）[可选]
  │  结合参考库分析结果与目标库现实约束，收敛双库差异、候选方案、模块落点与关键约束，生成可审查规格
  │  ★ HARD-GATE：用户批准后才能进入下一步
  ▼
⑤ coding-task-plan（目标库编码任务计划）[可选]
  │  在 `code-imitation-spec.md` 基础上继续深入分析当前项目，分章节生成详细的自然语言 `coding-task-plan.md`
  │  ★ HARD-GATE：每章都需用户批准，全文完成后流程结束
  ▼
完成
```

每个阶段文件都应单独说明自己的输入、输出、允许动作和禁止动作；后续阶段和使用者只能依赖上游产物中显式写出的信息，而不应依赖隐含章节结构或默认上下文。

另外，工作流里的计划、报告、规格与任务计划都应采用“软格式约束”：
- 必须覆盖关键信息块
- 可以按主题调整章节标题、数量与拆分方式
- 复杂主题可以扩展问题数量、图示数量与解释深度

## 8 视角分析框架

| 视角 | 探索重点 |
|------|---------|
| 意图与问题域 | 系统为什么存在？解决什么痛点？核心价值主张？ |
| 结构与分层 | 目录组织逻辑？模块职责？分层方式？依赖方向？ |
| 架构与设计思想 | 架构风格？设计模式？编程范式？变化点封装？ |
| 算法与数据结构 | 核心算法？数据选型权衡？数据生命周期？ |
| 依赖与集成 | 外部依赖选择？集成点？耦合程度？故障处理？ |
| 执行流与生命周期 | 启动流程？核心执行路径？并发模型？关闭流程？ |
| 错误处理与边界条件 | 异常传播？容错策略？边界条件？日志监控？ |
| 扩展点与演进 | 扩展点设计？配置驱动？技术债？演进方向？ |

每个视角根据用户意图标注优先级：**重点探索 / 简要浏览 / 跳过**。

## 交付物

所有输出写入 `docs/analyze-codebase/YYYY-MM-DD-<topic>/` 目录：

| 文件 | 产出阶段 | 说明 |
|------|---------|------|
| `analysis-plan.md` | clarify-and-plan | 自包含的结构化探索计划，显式写清当前问题表述、学习目标、关键澄清结论、推荐探索方法、讲解主线、问题链、图示计划与范围边界 |
| `analysis-report.md` | execute-analysis | 自包含的完整分析报告，在 `analysis-plan.md` 基础上扩写和深化参考库技术栈、关键骨架、关键执行链、可迁移本质与上下文约束 |
| `code-imitation-spec.md` | code-imitation-spec | 自包含的仿写需求规格，显式写清双库差异、候选方案与推荐方案、模块落点、关键接口 / 状态约束、MVP、非目标、风险与待确认事项 |
| `coding-task-plan.md` | coding-task-plan | 面向目标库 Agent 的完整编码任务计划说明书；在规格基础上继续深化，按章节输出详细的自然语言执行提示词 |

## 安装

推荐使用仓库根目录的 `sync` CLI，而不是手动复制目录。

### 示例：分发到 Claude Code 与 standards-compliant agents 的用户级 skills 仓库

在仓库根创建 `skills-distribution.json`：

```json
{
  "version": 1,
  "rules": [
    {
      "source": { "type": "group", "path": "skills/analyze-codebase-workflow" },
      "agents": ["claude-code", "codex", "cursor"],
      "scope": { "type": "user" }
    }
  ]
}
```

然后执行：

```bash
bun run index.ts sync
```

这会把当前 group 下的 concrete skills（如 `clarify-and-plan`、`execute-analysis` 等）以 symlink 形式同步到对应 agent 的 skills 仓库，并自动维护 `skills-distribution.lock`。

### 其他平台

如需项目级安装，可把 `scope` 改为 `project` 并提供 `projectRoots`。支持的 agent registry 与 config/lock 规则见仓库根 `README.md`。

## 配置

### 子代理模型偏好

分析工作流会派发子代理执行审查工作。首次触发 `analyze-codebase` 时，会让你选择子代理的模型能力等级：

- **快速经济（Haiku）** — 速度最快，聚焦关键检查项。成本最低。
- **标准（Sonnet）** — 平衡质量与成本。**默认选项。**
- **最强（Opus）** — 深度审查，主动发现问题。质量最高。

偏好设置保存在 `docs/analyze-codebase/.preference`，在当前会话中持续生效。

## 文件结构

```text
analyze-codebase-skills/
├── analyze-codebase/
│   └── SKILL.md                                   # 入口技能
├── clarify-and-plan/
│   ├── SKILL.md                                   # 澄清与计划技能
│   └── analysis-plan-reviewer-prompt.md           # 探索计划审查提示
├── execute-analysis/
│   ├── SKILL.md                                   # 执行分析技能
│   └── analysis-report-reviewer-prompt.md         # 分析报告审查提示
├── code-imitation-spec/
│   ├── SKILL.md                                   # 代码仿写需求规格技能
│   └── code-imitation-spec-reviewer-prompt.md     # 仿写规格审查提示
└── coding-task-plan/
    ├── SKILL.md                                   # 目标库编码任务计划技能
    └── coding-task-plan-reviewer-prompt.md        # 编码任务计划审查提示
```
