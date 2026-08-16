# editor-opt-login-mascot — 登录页左侧四小人物动画（L 级）

> 2026-08-16 | 需求见 editor-optimization-batch.req.md §② | Plan 智能体产出（参考 careercompass 复刻）

## 1. 参考项目实现要点（careercompass）

- **四角色**：紫 #6C3FF5（最高，爱眨眼）、黑 #2D2D2D（冷静）、橙 #FF9B6B（矮圆）、黄 #E8D754（有情绪/小嘴）。
- **绘制（纯 CSS）**：身体=div+border-radius 圆角矩形；头=border-radius:50% 圆；眼窝白圆+深色瞳孔小圆；
  手臂/手=圆；发/装饰=半圆（`border-radius:100% 100% 0 0`）。JS 仅算位移/类名开关。
- **① 眼随鼠标**：`getBoundingClientRect()` 取眼中心 → `Math.atan2` 角度 → `cos/sin*min(dist,maxDist)`
  位移瞳孔（maxDist 8-15px）；脸微偏+身体反方向 skewX；rAF 节流。
- **② 邮箱变高/对视**：focus email → `transform:scaleY(1.1)` + `transform-origin:bottom`；紫黑互相转头对视。
- **③ 密码遮眼回避**：focus password → rotateY 转身/双手上移盖眼。
- **④ 显示密码偷看**：showPassword → 紫角色转头朝密码框 + 每 2-5s 随机偷瞄 probe。
- **⑤ 失败摇头**：`@keyframes head-shake` 绕 Y 轴往复 + 嘴角向下。
- **眨眼**：随机 3-7s 触发 150ms `scaleY(0.1)`，每角色独立。

## 2. 技术方案

- 新建 `MascotCharacter.tsx`（单角色绘制，参数化颜色/高矮/表情）+ `FourMascots.tsx`（四角色容器 +
  mousemove/rAF 眼随 + 眨眼 + 模式分发）。
- `InteractiveMascot.tsx` 改造成**门面**：删原 SVG，委托 `FourMascots`；props 增 `passwordVisible?: boolean`；
  `MascotState` 类型保留导出（防破坏 Login/Signup import）。
- 状态驱动：表单既有 `focusedField`/`error`/`success`/`hover-submit`（现有 `onMascotStateChange`）映射四角色动作。
- **唯一新增耦合**：`Common/Input.tsx` 内部 `showPassword`（L46 内部 state）→ 新增 `onVisibilityToggle?: (visible)=>void`
  回调（L94-131 toggle 按钮 onClick 触发）→ LoginPage/SignupPage → AuthPage → InteractiveMascot 驱动「偷看」。
- CSS 沿用组件内 `<style>` 注入方式，纯 transitions+keyframes，无新依赖。
- 左栏 `hidden md:flex w-[45%]` + 紫色渐变不变（md 以下自动隐藏四角色）。

## 3. 变更清单

| 文件 | 改动 |
|---|---|
| `src/render/components/Auth/MascotCharacter.tsx` | **新**：单角色 CSS 绘制 |
| `src/render/components/Auth/FourMascots.tsx` | **新**：四角色容器 + rAF 眼随 + 眨眼 + 模式分发 |
| `src/render/components/Auth/InteractiveMascot.tsx` | 门面化：SVG→FourMascots，props 增 passwordVisible |
| `src/render/pages/AuthPage.tsx` | 新增 passwordVisible state + 透传 |
| `src/render/components/Auth/LoginPage.tsx` | props 增 onPasswordVisibleChange 传给 password Input |
| `src/render/components/Auth/SignupPage.tsx` | 同上 |
| `src/render/components/Common/Input.tsx` | 新增 onVisibilityToggle 回调（不改 showPassword 既有逻辑） |
| 测试 | **新** `FourMascots.test.tsx`、`InputPasswordToggle.test.tsx`、`LoginPage.test.tsx`（当前无 mascot 测试，首次建=RED） |

## 4. 实施步骤（RED → GREEN）
1. 先写测试 RED（渲染 4 角色、state→className 映射、onVisibilityToggle 触发、mousemove 瞳孔偏移）。
2. 实现 MascotCharacter + FourMascots → GREEN。
3. 改 Input.tsx 加 onVisibilityToggle。
4. InteractiveMascot 门面化 + AuthPage/Login/Signup 接 props。
5. tsc 0 / vitest 全绿 / lint 0。
6. Playwright auth 相关全绿（表单功能不回归）。
7. 手动 run 验证动画/明暗主题/md 断点/偷看/摇头。

## 5. 验收标准
- 左栏渲染 4 个 CSS 角色；眼随鼠标；邮箱 focus→变高/对视；密码 focus→遮眼回避；
  showPassword→偷看；state=error→沮丧摇头。
- 明暗主题正常；md 以下隐藏左栏；表单功能（登录/注册/校验/错误提示）不回归。

## 6. 风险
- Input 加回调需检查其它 type=password 复用处（若仅登录/注册用则低风险）。
- MascotState 类型被外部 import，须保留导出。
- 国内网络 GitHub 不可达时以 demo 视觉校准。
- jsdom 测试需 mock getBoundingClientRect；动画需 rAF 节流防高 CPU。
