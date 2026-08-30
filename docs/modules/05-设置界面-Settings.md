# 05 — 设置界面

> 最后更新：2026-08-30

## 做什么

统一管理应用设置：系统（主题/语言）、账号、AI 模型配置、Embedding、搜索、Skills、MCP、Agent 个性。

## 架构

```
src/render/components/Settings/
├── UnifiedSettings.tsx     ← 统一设置面板（主入口，1000×700 居中弹层）
├── SettingsSidebar.tsx     ← 左侧导航（8 个 tab，分两组：通用 / AI 设置）
├── SystemSettings.tsx      ← 主题 + 语言
├── AccountSettings.tsx     ← 账号信息 / 切换 / 登出 / 删除
└── SettingsModal.tsx       ← 旧版模态框（仍保留，UnifiedSettings 为主路径）

src/render/components/AIAgent/settings/
├── ModelForm.tsx           ← AI 模型配置（API Key / baseURL / 模型选择 / 多配置切换）
├── EmbeddingSettings.tsx   ← Embedding 配置（提供商 / Key / 测试连接）
├── SearchSettings.tsx      ← 搜索配置（Firecrawl/Tavily/Exa/智谱）
├── SkillsPanel.tsx         ← 技能管理（内置 + 用户 SKILL.md）
├── McpPanel.tsx            ← MCP 占位
└── AgentPersonalityPanel.tsx ← Agent 个性设置（soul.md / memory.md / style.md）
```

## 侧栏 Tab 结构

| 组   | Tab          | 内容组件               | 说明                   |
| ---- | ------------ | ---------------------- | ---------------------- |
| 通用 | `system`     | SystemSettings         | 主题选择 + 语言切换    |
| 通用 | `account`    | AccountSettings        | 账号管理               |
| AI   | `model`      | ModelForm              | LLM API 配置           |
| AI   | `embedding`  | EmbeddingSettings      | Embedding 服务配置     |
| AI   | `search`     | SearchSettings         | 联网搜索服务配置       |
| AI   | `skills`     | SkillsPanel            | 技能管理               |
| AI   | `mcp`        | McpPanel               | MCP 占位               |
| AI   | `personality`| AgentPersonalityPanel  | Agent 个性             |

## 主题系统

ThemeType（`src/shared/types.ts`）：

| 值             | 显示名      | 说明                                      |
| -------------- | ----------- | ----------------------------------------- |
| `light-header` | Default     | 白色导航栏 + 蓝色强调（`#2563EB`）        |
| `notus`        | Warm Earth  | 暖色陶土（`#C15F3C` 强调，`#1C1917` 导航栏）|

主题通过 `document.documentElement.classList.add(theme)` 应用，CSS 变量在 `globals.css` 中定义。

## 字体

- 侧栏：`阿里巴巴普惠体B + Consolas`
- 编辑主区：`Consolas + 阿里巴巴普惠体`
- 代码块：`Consolas + 阿里巴巴普惠体B`

## 设置持久化

- 前端：Zustand `uiStore` → `localStorage`（`weavemd_ui`）
- 后端：`settings` 表（SQLite）→ `window.weaveMD.settings.update()`
- AI 配置：`ai_config` 表 → 各 IPC handler

## 注意事项

- `SettingsModal.tsx` 是旧版入口，`UnifiedSettings.tsx` 是当前主入口
- AI 配置 Tab 组件位于 `AIAgent/settings/` 目录下，非 `Settings/` 目录
- 主题选择后需点击「保存」才生效（SystemSettings）或立即生效（直接调用 setTheme）
