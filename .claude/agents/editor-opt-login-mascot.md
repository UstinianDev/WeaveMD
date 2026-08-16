# editor-opt-login-mascot — 登录页四小人物动画（UI，L 级/TDD strict）

角色：frontend-ui-engineer | TDD strict | 分支 feat/ai-agent-ph3-ph4 | 需求 req.md §② | 计划 editor-opt-login-mascot.plan.md

## 范围

- **新** `src/render/components/Auth/MascotCharacter.tsx`：单 CSS 小人物绘制（参数化颜色/高矮/表情，纯 CSS 圆角矩形+圆形头+眼窝/瞳孔）。
- **新** `src/render/components/Auth/FourMascots.tsx`：四角色容器 + mousemove/rAF 眼随鼠标 + 随机眨眼 + 模式分发。
- 改 `InteractiveMascot.tsx` 为**门面**：删原 SVG，委托 FourMascots；props 增 `passwordVisible?: boolean`；`MascotState` 类型保留导出。
- 改 `AuthPage.tsx`（passwordVisible 透传）、`LoginPage.tsx`/`SignupPage.tsx`（onPasswordVisibleChange）、`Common/Input.tsx`（新增 `onVisibilityToggle?: (visible)=>void`，不改 showPassword 既有逻辑）。
- 交互：邮箱 focus→scaleY 变高/紫黑对视；密码 focus→遮眼回避；showPassword→偷看；state=error→head-shake 摇头。纯 CSS transitions/keyframes 无动画库。
- 左栏 `hidden md:flex w-[45%]` + 紫色渐变**不变**。

## 关键实现点

- 眼随鼠标：getBoundingClientRect → atan2 角度 → cos/sin*min(dist,maxDist) 位移瞳孔；rAF 节流。
- Input.tsx 加回调前 grep 确认无其它 type=password 复用处受影响。
- 测试（先 RED）：`FourMascots.test.tsx`（渲染 4 角色/state→className/瞳孔偏移）、`InputPasswordToggle.test.tsx`、`LoginPage.test.tsx`（focus/error/onPasswordVisibleChange）。jsdom mock getBoundingClientRect。

## 门禁（本模块）

- `npx vitest run tests/render/components/Auth tests/render/components/Common` 全绿（含先 RED 证据）
- `npm run typecheck` 0 | `npm run lint` 0（本模块文件）| Playwright auth 相关全绿（表单不回归）
- 只返回结构化摘要：{完成项, 测试证据, 未完成项, 风险}
