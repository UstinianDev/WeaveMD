# WeaveMD — 编码规范规则

## 命名规则
- 组件：`PascalCase` — `LoginPage.tsx`, `FloatingToolbar.tsx`
- 文件/函数/变量：`camelCase` — `useAuth.ts`, `handleSubmit()`
- 常量/枚举：`UPPER_SNAKE_CASE` — `MAX_USERNAME_LENGTH`
- 类型/接口：`PascalCase` 前缀 `I` 可选 — `User`, `AuthState`
- 目录：`PascalCase` — `Auth/`, `Editor/`, `Common/`

## 导入顺序
1. React / 外部库 (react, zustand, electron)
2. Stores / Hooks (stores/authStore, hooks/useAuth)
3. 组件 (components/Auth/LoginPage)
4. 工具 / 类型 (utils/validators, shared/types)

## 组件规则
- 每个组件一个文件，文件名与组件名一致
- 使用 `export default` 导出组件
- Props 接口定义在文件顶部，命名 `XxxProps`
- 禁止 `any` 类型 — 使用 `unknown` 或定义具体类型

## CSS 规则
- 优先使用 Tailwind utility classes
- 复杂动画提取到 `styles/` 目录下的 CSS 文件
- 禁止内联 `style={{}}` — 使用 Tailwind 或 CSS module
- 颜色值引用 CSS 变量：`var(--bg-primary)`

## 错误处理
- IPC 调用必须 try/catch
- 异步操作使用 async/await，禁止裸 .then()
- 用户输入必须经过 validators 验证