# TypeScript Canonical Example

这份示例是本 skill 自带的风格样板。它不对应任何真实项目文件，只负责演示：怎样给“协议 + wrapper + 参数校验 + 统一后处理”这类偏抽象的代码写出高密度、教学式、逐段讲解注释。

阅读顺序：

1. 先看“原始代码片段”，理解代码形状。
2. 再看“教学式逐段注释版”，理解应该解释哪些隐藏信息。
3. 真正给目标文件加注释时，模仿这里的解释密度和切段方式，而不是照搬措辞。

## 原始代码片段

```ts
import z from "zod"

import type { Agent } from "./agent"
import type { Permission } from "./permission"
import type { MessageID, SessionID } from "./schema"

import { Truncate } from "./truncate"

export namespace Action {
  interface Meta {
    [key: string]: unknown
  }

  export interface InitContext {
    agent?: Agent.Info
  }

  export type Context<M extends Meta = Meta> = {
    sessionID: SessionID
    messageID: MessageID
    agent: string
    abort: AbortSignal
    callID?: string
    metadata(input: { title?: string; metadata?: M }): void
    ask(input: Omit<Permission.Request, "id" | "sessionID" | "action">): Promise<void>
  }

  export interface Info<P extends z.ZodType = z.ZodType, M extends Meta = Meta> {
    id: string
    init: (ctx?: InitContext) => Promise<{
      description: string
      parameters: P
      execute(args: z.infer<P>, ctx: Context): Promise<{
        title: string
        metadata: M
        output: string
      }>
      formatValidationError?(err: z.ZodError): string
    }>
  }

  export function define<P extends z.ZodType, M extends Meta>(
    id: string,
    init: Info<P, M>["init"] | Awaited<ReturnType<Info<P, M>["init"]>>,
  ): Info<P, M> {
    return {
      id,
      init: async (initCtx) => {
        const info = init instanceof Function ? await init(initCtx) : init
        const execute = info.execute

        info.execute = async (args, ctx) => {
          try {
            info.parameters.parse(args)
          } catch (err) {
            if (err instanceof z.ZodError && info.formatValidationError) {
              throw new Error(info.formatValidationError(err), { cause: err })
            }

            throw new Error(`The ${id} action was called with invalid arguments.`, {
              cause: err,
            })
          }

          const result = await execute(args, ctx)

          if (result.metadata.truncated !== undefined) {
            return result
          }

          const truncated = await Truncate.output(result.output, {}, initCtx?.agent)

          return {
            ...result,
            output: truncated.content,
            metadata: {
              ...result.metadata,
              truncated: truncated.truncated,
              ...(truncated.truncated && { outputPath: truncated.outputPath }),
            },
          }
        }

        return info
      },
    }
  }
}
```

## 教学式逐段注释版

```ts
// 引入 zod。
// 在这个模块里它不是单纯的“类型库”，而是同时承担两层职责：
// 1. 用 `z.ZodType` 描述 action 的参数协议
// 2. 在真正执行前用 `parse()` 做运行时防御性校验
// 这类注释的重点不是“它被导入了”，而是要让新手知道：这里的 schema 既参与类型推导，也参与执行前守门。
import z from "zod"

// 下面这组 import 都是类型导入。
// 教学式注释要提醒读者：类型导入和运行时导入在职责上不同。
// 这里引入的是“协议层信息”——谁来调用、权限请求长什么样、当前执行属于哪条会话。
// 这些类型本身不会在运行时产生成本，但它们决定了当前模块和外部系统如何对接。
import type { Agent } from "./agent"
import type { Permission } from "./permission"
import type { MessageID, SessionID } from "./schema"

// 这是少数真正参与运行时的依赖。
// 它出现在执行尾部，说明当前 helper 除了转发业务执行，还偷偷注入了一层统一后处理能力。
// 新手最容易误以为 `define()` 只是个“语法糖 helper”，实际上它还负责包装输出。
import { Truncate } from "./truncate"

export namespace Action {
  // 这个宽松的 metadata 字典是一个典型的“协议扩展口”。
  // 看起来它只是随便收一些键值，但真正的设计意图是：
  // 框架层想统一约束 metadata 的存在，却不想提前把所有 action 的返回形状写死。
  // 所以这里故意保留很宽的 key/value 空间，把具体语义留给各个 action 自己扩展。
  interface Meta {
    [key: string]: unknown
  }

  // 初始化阶段上下文和执行阶段上下文是分开的。
  // 这里故意只暴露一个可选的 `agent`，意味着 action 的定义本身允许“按调用者动态变化”。
  // 这在抽象层设计上很关键：当前模块不只是在描述一次执行，还在描述“如何生成这次执行所需的协议对象”。
  export interface InitContext {
    agent?: Agent.Info
  }

  // `Context` 是 action 真正执行时拿到的宿主能力包。
  // 写这类注释时，要尽量补足“字段是谁提供的、给谁用的、哪些能力不能伪造”。
  export type Context<M extends Meta = Meta> = {
    // 当前执行属于哪条 session。
    // 这不是普通业务参数，而是宿主框架附带的归属信息。
    sessionID: SessionID

    // 当前执行结果将挂到哪条 message 上。
    // 新手容易把它误读成“用户传进来的一个普通 ID”，其实它更像宿主分配的上下文坐标。
    messageID: MessageID

    // 当前调用者名字。
    // 这里只放 string，说明很多时候 action 执行时只需要一个轻量身份标记，而不是完整 agent 对象。
    agent: string

    // 取消信号。
    // 只要 action 可能耗时，就应该考虑这个信号怎样往下游传递，否则用户取消后底层任务仍可能继续跑。
    abort: AbortSignal

    // 一次具体调用的唯一标记。
    // 这种字段常常被新手忽略，但它通常是状态追踪、日志关联、结果回写的重要锚点。
    callID?: string

    // 执行途中回写标题或 metadata 的入口。
    // 这说明当前协议不只支持“结束后一次性返回”，还支持在进行中向宿主同步阶段性状态。
    metadata(input: { title?: string; metadata?: M }): void

    // 权限申请入口。
    // `id` / `sessionID` / `action` 被故意从入参里剔除，表示这些关键上下文字段只能由宿主补齐。
    // 教学式注释要点出这种“字段所有权”：当前 action 能申请权限，但不能伪造自己是谁、属于哪次会话。
    ask(input: Omit<Permission.Request, "id" | "sessionID" | "action">): Promise<void>
  }

  // `Info` 是 action 系统真正的核心协议。
  // 它把一个 action 分成三层：
  // 1. 静态标识 `id`
  // 2. 初始化阶段生成的描述、参数 schema、execute
  // 3. 真正执行时返回的 title / metadata / output
  // 这种分层值得解释，因为很多新手只会看到“一个对象里有个 execute”，却意识不到这里其实在定义一套内部 DSL。
  export interface Info<P extends z.ZodType = z.ZodType, M extends Meta = Meta> {
    id: string

    init: (ctx?: InitContext) => Promise<{
      // 给模型或调用方看的描述文本。
      // 它属于“暴露协议”，不是业务输出。
      description: string

      // 参数 schema 同时承担类型推导和运行时校验两种职责。
      // 这里的双重角色是教学式注释必须点出来的隐含价值。
      parameters: P

      execute(args: z.infer<P>, ctx: Context): Promise<{
        // 结果标题通常给 UI、日志或状态面板使用。
        title: string

        // 结构化 metadata。
        // 它和 output 分工不同：output 偏展示文本，metadata 偏程序化附加信息。
        metadata: M

        // 主文本输出。
        // 后面 wrapper 可能会在不改业务逻辑的前提下接管这份输出。
        output: string
      }>

      // 可选的参数错误格式化器。
      // 它的意义不是“让报错更漂亮”，而是允许具体 action 把 schema 错误转成更利于上游修正输入的提示。
      formatValidationError?(err: z.ZodError): string
    }>
  }

  // `define()` 是统一包装器。
  // 这类函数的注释关键在于说明：它看似只是返回 `Info`，实际上偷偷接管了 execute 的公共前后处理。
  export function define<P extends z.ZodType, M extends Meta>(
    id: string,
    init: Info<P, M>["init"] | Awaited<ReturnType<Info<P, M>["init"]>>,
  ): Info<P, M> {
    return {
      // 这里直接暴露 id，说明 helper 没有重写 action 身份，只重写执行壳。
      id,

      init: async (initCtx) => {
        // `init` 既支持传函数，也支持传已经准备好的对象。
        // 这类兼容双形态输入的写法，教学式注释要说清楚它解决了什么问题：
        // 简单 action 可以静态声明，复杂 action 可以按上下文动态生成定义。
        const info = init instanceof Function ? await init(initCtx) : init

        // 先保留原始 execute。
        // 这一句单看很普通，但它预告了下一步要做 monkey patch 式包装：
        // helper 不改变调用接口，却把内部执行逻辑替换成带公共能力的新版本。
        const execute = info.execute

        info.execute = async (args, ctx) => {
          // 第一层统一能力：执行前参数校验。
          // 即使上游理论上已经知道 schema，这里仍再次校验，体现的是“宿主最后一道守门”。
          try {
            info.parameters.parse(args)
          } catch (err) {
            // 这里专门把 zod 错误分流出去，是因为 schema 错误和业务执行错误语义不同。
            // 前者通常意味着“输入需要重写”，后者才意味着“逻辑执行失败”。
            if (err instanceof z.ZodError && info.formatValidationError) {
              throw new Error(info.formatValidationError(err), { cause: err })
            }

            // 默认错误文案比较短，但仍然保留 cause。
            // 新手应该从注释里看懂：当前层并没有吞掉原始错误，只是把它包装成更统一的上抛结构。
            throw new Error(`The ${id} action was called with invalid arguments.`, {
              cause: err,
            })
          }

          // 参数通过后才执行原始业务逻辑。
          // 这里故意没有 catch 业务异常，说明这层 wrapper 不负责兜底所有失败；
          // 它只负责自己注入的通用能力，把真正的业务错误继续交给上游处理。
          const result = await execute(args, ctx)

          // 这是一个典型的“约定字段/哨兵值”。
          // 只要业务层已经自己写入 `metadata.truncated`，wrapper 就认为“截断已经被下游自行接管”，于是直接跳过默认处理。
          // 这种地方如果只翻译成“如果已截断就返回”，读者会不知道这里其实在走一套隐式协议。
          if (result.metadata.truncated !== undefined) {
            return result
          }

          // 第二层统一能力：对文本输出做默认截断。
          // 第三个参数把初始化阶段的 agent 继续带进来，说明初始化上下文不仅影响定义阶段，也可能影响后处理策略。
          const truncated = await Truncate.output(result.output, {}, initCtx?.agent)

          // 最终返回的不是纯业务结果，而是“业务结果 + 框架增强结果”。
          // 这类返回对象要重点解释字段合并顺序，因为合并顺序本身就代表优先级策略。
          return {
            ...result,

            // 用统一处理后的文本覆盖原始 output。
            output: truncated.content,

            metadata: {
              // 先保留业务层自己的 metadata。
              ...result.metadata,

              // 再注入框架层统一补充的截断标记。
              truncated: truncated.truncated,

              // 只有真的发生截断时才补 outputPath。
              // 这也是一种有意的协议设计：避免未截断时产生含义模糊的空字段。
              ...(truncated.truncated && { outputPath: truncated.outputPath }),
            },
          }
        }

        // 返回的 `info` 结构没变，但 execute 已经被统一壳接管。
        // 这正是教学式注释最该指出的地方：接口表面保持稳定，真正变化藏在执行路径里。
        return info
      },
    }
  }
}
```

## 从这个示例学什么

- 注释要优先解释“职责 + 协作关系 + 隐含约定”，而不是翻译语法。
- 对协议、wrapper、哨兵值、字段所有权、错误传播这类抽象代码，要主动补充读者看不见的上下文。
- 如果某段代码看似普通，但它实际在偷偷注入统一前后处理能力，就必须点破。
- 注释应该跟着认知单元切段：import 一组、协议一组、包装逻辑一组、错误分支一组，而不是每行一句碎解释。
