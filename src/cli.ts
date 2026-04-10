// cli.ts — 命令行入口模块。
//
// 这是整个系统与用户交互的最外层。它解析命令行参数，验证命令合法性，
// 然后委托给 sync.ts 的 runSync() 执行真正的同步逻辑。
//
// 目前只支持一个命令：sync。未来如果需要添加更多命令（如 status、clean），
// 可以在这里扩展路由逻辑。
//
// 新手注意：这个模块故意保持非常轻量——不做任何业务逻辑，
// 只负责"把命令行参数翻译成函数调用参数"。

import { resolve } from "node:path";
import { DEFAULT_CONFIG_FILE_NAME } from "./config";
import { runSync } from "./sync";

// 获取默认的配置文件路径：当前工作目录下的 skills-distribution.json。
// 这个默认值让用户在项目根目录下直接运行 `bun run index.ts sync` 即可，
// 不需要每次都指定 --config。
export function getDefaultConfigPath(): string {
  return resolve(process.cwd(), DEFAULT_CONFIG_FILE_NAME);
}

// 使用帮助文本。作为面向用户的错误消息的一部分输出。
function getUsage(): string {
  return [
    "Usage:",
    "  bun run index.ts sync",
    "  bun run index.ts sync --config <path>",
  ].join("\n");
}

// ── 主入口：CLI 路由 ────────────────────────────────────────
//
// argv 是命令行参数数组（通常是 process.argv.slice(2)）。
// 解析逻辑采用手写的 for 循环而非 commander / yargs 等框架，
// 因为当前只有一个命令和一个选项，不值得引入额外依赖。
//
// 遇到任何无法识别的参数都会立即报错并展示用法——
// 这是"严格模式"策略，避免默默忽略用户的拼写错误。
export async function runCli(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;

  if (!command) {
    throw new Error(getUsage());
  }

  if (command !== "sync") {
    throw new Error(`未知命令: ${command}\n\n${getUsage()}`);
  }

  let configPath = getDefaultConfigPath();

  // 手写参数解析。index += 1 的步进用于跳过已消费的选项值。
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    if (arg === "--config") {
      const next = rest[index + 1];
      if (!next) {
        throw new Error("--config 需要一个路径值。");
      }
      // resolve 确保无论用户输入的是相对路径还是绝对路径，
      // 最终都变成绝对路径传给 runSync。
      configPath = resolve(process.cwd(), next);
      index += 1;
      continue;
    }

    // 遇到任何不认识的参数直接报错。这防止用户拼错选项名时默默被忽略。
    throw new Error(`未知参数: ${arg}\n\n${getUsage()}`);
  }

  // 所有参数解析完毕，委托给 sync 模块执行。
  await runSync(configPath);
}
