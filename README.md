# agentic-coding-kit

一个基于 Bun/TypeScript 的 skills 工具仓库，内置 `sync` CLI，用 symlink 把仓库内 `skills/` 分发到不同 AI Coding Agent 的用户级或项目级 skills 仓库。

## 安装依赖

```bash
bun install
```

## 运行 `sync`

```bash
bun run index.ts sync
bun run index.ts sync --config ./path/to/skills-distribution.json
```

默认 config 文件名是当前工作目录下的 `skills-distribution.json`。
默认 lock 文件名是当前工作目录下的 `skills-distribution.lock`。

## Config 示例

```json
{
  "version": 1,
  "agentUserRoots": {
    "claude-code": ["./.claude_another", "./.claude_shared"]
  },
  "rules": [
    {
      "source": { "type": "group", "path": "skills/analyze-codebase-workflow" },
      "agents": ["claude-code", "codex", "cursor"],
      "scope": { "type": "user" }
    },
    {
      "source": { "type": "skill", "path": "skills/teach-code-comments" },
      "agents": ["claude-code"],
      "scope": {
        "type": "project",
        "projectRoots": ["../repo-a", "../repo-b"]
      }
    }
  ]
}
```

## Config 语义

- `source.path` 支持绝对路径，或相对 config 文件所在目录的路径；内部会归一化为相对 `sourceRoot` 的 canonical id。
- 例如 config 在 `/Users/caiwillie/code/mahuft/agentic-coding-kit/skills-distribution.json` 时，`skills/teach-code-comments` 会解析为 `teach-code-comments`。
- `source.type: "skill"` 分发单个 concrete skill。
- `source.type: "group"` 递归展开该 group 下当前存在的全部 descendant concrete skills。
- `agents` 使用内置 agent registry；映射到同一绝对目标目录时会自动去重。
- `agentUserRoots` 可为单个 agent 配置一个或多个用户配置目录名/路径片段；这些配置目录会覆盖该 agent 默认配置目录（例如 `claude-code` 默认 `.claude` 可改为 `.claude_another`），而不是追加默认目录。
- `scope.type: "user"` 默认以 `os.homedir()` 为 base；若某个 agent 配置了 `agentUserRoots`，则会把每个 override 目录解释为相对 `homeDir` 的配置目录，并分发到对应的 `<overrideDir>/skills`。
- `scope.type: "project"` 以每个 `projectRoot` 为 base；相对路径按 config 文件目录解析。
- 所有分发产物都是指向仓库 `skills/` 的目录 symlink，不复制真实内容。
- 目标仓库保留 group 层级，例如 `analyze-codebase-workflow/clarify-and-plan`。

## Agent Registry

`scope.type: "user"` 时，目标 skills 根目录默认是 `~/<relative skills dir>`；若配置了 `agentUserRoots[agentId]`，则改为对每个 `~/<overrideDir>/skills` 分发。`scope.type: "project"` 时，目标 skills 根目录是 `<projectRoot>/<relative skills dir>`。

| Agent ID | Relative skills dir |
|---|---|
| `amp` | `.agents/skills` |
| `antigravity` | `.agents/skills` |
| `cline` | `.agents/skills` |
| `codex` | `.agents/skills` |
| `cursor` | `.agents/skills` |
| `deep-agents` | `.agents/skills` |
| `firebender` | `.agents/skills` |
| `gemini-cli` | `.agents/skills` |
| `github-copilot` | `.agents/skills` |
| `kimi-code-cli` | `.agents/skills` |
| `opencode` | `.agents/skills` |
| `warp` | `.agents/skills` |
| `augment` | `.augment/skills` |
| `ibm-bob` | `.bob/skills` |
| `claude-code` | `.claude/skills` |
| `openclaw` | `skills` |
| `codebuddy` | `.codebuddy/skills` |
| `command-code` | `.commandcode/skills` |
| `continue` | `.continue/skills` |
| `cortex-code` | `.cortex/skills` |
| `crush` | `.crush/skills` |
| `droid` | `.factory/skills` |
| `goose` | `.goose/skills` |
| `junie` | `.junie/skills` |
| `iflow-cli` | `.iflow/skills` |
| `kilo-code` | `.kilocode/skills` |
| `kiro-cli` | `.kiro/skills` |
| `kode` | `.kode/skills` |
| `mcpjam` | `.mcpjam/skills` |
| `mistral-vibe` | `.vibe/skills` |
| `mux` | `.mux/skills` |
| `openhands` | `.openhands/skills` |
| `pi` | `.pi/skills` |
| `qoder` | `.qoder/skills` |
| `qwen-code` | `.qwen/skills` |
| `roo-code` | `.roo/skills` |
| `trae` | `.trae/skills` |
| `trae-cn` | `.trae/skills` |
| `windsurf` | `.windsurf/skills` |
| `zencoder` | `.zencoder/skills` |
| `neovate` | `.neovate/skills` |
| `pochi` | `.pochi/skills` |
| `adal` | `.adal/skills` |

## Lock 语义

lock 不是 source of truth，只记录上一次由本工具管理的 concrete 分发结果，用于：

- 删除已不再需要的旧 symlink
- 处理 project/user scope 迁移
- 响应 group 下 concrete skill 的新增或删除
- 拒绝覆盖未被 lock 管理的已有内容

每次 `sync` 都会基于“当前 config + 当前 source skills 树 + 旧 lock”计算差异，并输出创建、删除、重建和去重摘要。

## 验证

```bash
bun test
bun run index.ts sync --config ./skills-distribution.json
```
