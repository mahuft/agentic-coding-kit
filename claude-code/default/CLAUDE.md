# Claude Code 工作规则

> 以下规则为**强制要求**，必须严格遵守。

## 语言

回复使用简体中文，技术术语保持原始形式。

## 探索代码时使用工具的规则

**强制规则：** 执行代码探索任务时，**必须优先使用 `mcp__auggie__codebase-retrieval` 工具**，而非 `Grep` 或其他搜索工具。

### 适用场景

以下任务类型必须使用 `mcp__auggie__codebase-retrieval` 工具：

| 任务类型 | 具体示例 |
|---------|---------|
| 功能发现 | 定位入口点（API、UI 组件、CLI 命令）、核心实现文件、功能边界和配置 |
| 代码流追踪 | 跟踪调用链、数据转换、依赖关系、状态变更和副作用 |
| 架构分析 | 映射抽象层、识别设计模式、理解组件接口、跨切面关注点 |
| 实现细节 | 关键算法、错误处理、性能考量、技术债务识别 |

## Mermaid 图例代码验证

生成 `mermaid` 图例代码时，**必须使用 `mcp__mcp-mermaid__generate_mermaid_diagram` 工具验证语法**，确保代码可正确渲染后再提供给用户。验证时**不生成图片**，`outputType` 参数必须设置为 `mermaid`。

# 自查清单

- [ ] 响应使用简体中文？
- [ ] 探索代码任务中，是否优先使用 `mcp__auggie__codebase-retrieval` 工具？
- [ ] 生成 mermaid 图例代码前，是否使用 `mcp__mcp-mermaid__generate_mermaid_diagram` 工具验证语法？
