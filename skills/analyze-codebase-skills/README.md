# Analyze Codebase Skills

一套结构化的源码探索分析工作流，以可组合的 Skills 形式构建。引导 Coding Agent 从用户的提问出发，经过意图澄清、计划制定、系统化探索，最终产出深度分析报告——告别无序浏览代码的混乱。

## 工作原理

当你让 Agent 理解某个代码库时，工作流就启动了。Agent 不会直接跳进去随机阅读文件，而是先退一步，通过有针对性的提问澄清你真正想了解什么。经过几轮交互后，将你的意图提炼为一份结构化的探索计划。

你批准计划后，Agent 按照 **8 个分析视角** 系统化地探索代码库——从意图与问题域到错误处理与扩展性。每项发现都附有具体的代码引用，辅以 Mermaid 可视化图表，并在展示给你之前经过子代理自审。

分析完成后，你可以选择进入**仿写阶段**：Agent 会产出伪代码、专用术语词典、Vibe Coding 提示词模板、设计差异分析和改进建议——帮助你将学到的模式复用到自己的项目中。

这套 Skills 会自动触发——只要你的请求涉及理解、探索或分析源码，无需任何特殊操作。

## 工作流

```
用户提问
  │
  ▼
① analyze-codebase（入口）
  │  确保使用结构化工作流，而非随意浏览
  ▼
② clarify-and-plan（澄清与计划）
  │  通过提问澄清意图，生成 8 视角探索计划
  │  ★ HARD-GATE：用户批准后才能继续
  ▼
③ execute-analysis（执行分析）
  │  系统化探索源码，产出完整分析报告
  │  ★ HARD-GATE：用户批准后才能继续
  ▼
④ clone-writing-plan（仿写计划）[可选]
  │  基于分析报告设计仿写策略
  │  ★ HARD-GATE：用户批准后才能继续
  ▼
⑤ execute-clone-writing（执行仿写）[可选]
  │  产出 5 个交付物：伪代码、术语词典、Vibe Coding 提示词、设计差异分析、改进建议
  │  ★ HARD-GATE：用户批准后流程结束
  ▼
完成
```

每个阶段都有 **HARD-GATE**——Agent 在你明确批准之前不会继续下一步。每个输出在展示给你之前都会经过子代理自审。

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
| `analysis-plan.md` | clarify-and-plan | 结构化探索计划，含 8 视角优先级 |
| `analysis-report.md` | execute-analysis | 完整分析报告，含 Mermaid 图表和架构避坑指南 |
| `clone-writing-plan.md` | clone-writing-plan | 仿写策略规划 |
| `clone-writing-report.md` | execute-clone-writing | 5 个交付物：伪代码、术语词典、提示词、差异分析、改进建议 |

## 安装

### Claude Code

将 `analyze-codebase-skills` 目录复制到 Claude Code 的 skills 目录：

```bash
cp -r analyze-codebase-skills ~/.claude/skills/
```

### 其他平台

对于其他 Coding Agent 平台（Copilot CLI、Codex、OpenCode、Gemini CLI 等），请参考主 README 中的 superpowers 安装说明。Analyze Codebase Skills 遵循相同的技能发现机制。

## 配置

### 子代理模型偏好

分析工作流会派发子代理执行自审任务。首次触发 `analyze-codebase` 时，会让你选择子代理的模型能力等级：

- **快速经济（Haiku）** — 速度最快，聚焦关键检查项。成本最低。
- **标准（Sonnet）** — 平衡质量与成本。**默认选项。**
- **最强（Opus）** — 深度审查，主动发现问题。质量最高。

偏好设置保存在 `docs/analyze-codebase/.model-preference`，在当前会话中持续生效。

## 设计哲学

- **结构化优于随意** — 不随机浏览。先计划，再探索。
- **计划优于行动** — 在阅读任何文件之前先澄清意图。
- **自审优于跳过** — 每个输出在展示前都经过子代理审查。
- **用户门控优于自治** — 每个阶段都需要你的明确批准。
- **证据优于断言** — 发现基于具体代码引用，而非模糊概括。

## 文件结构

```
analyze-codebase-skills/
├── analyze-codebase/
│   └── SKILL.md                          # 入口技能
├── clarify-and-plan/
│   ├── SKILL.md                          # 澄清与计划技能
│   └── analysis-plan-reviewer-prompt.md  # 探索计划审查提示
├── execute-analysis/
│   ├── SKILL.md                          # 执行分析技能
│   └── analysis-report-reviewer-prompt.md # 分析报告审查提示
├── clone-writing-plan/
│   ├── SKILL.md                          # 仿写计划技能
│   └── clone-plan-reviewer-prompt.md     # 仿写计划审查提示
└── execute-clone-writing/
    ├── SKILL.md                          # 执行仿写技能
    └── clone-report-reviewer-prompt.md   # 仿写报告审查提示
```
