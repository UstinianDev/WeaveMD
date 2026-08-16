---
name: auth-four-mascots-pattern
description: WeaveMD 登录/注册左栏 careercompass 风格四小人物（纯 CSS）的实现约定与状态流
metadata:
  type: project
---

Auth 左栏 mascot 在 task② 改为 careercompass 四小人物（纯 CSS 圆角矩形身体+圆头+眼窝，无动画库）。约定：

- `InteractiveMascot.tsx` 是**门面**，只透传 `state` + `passwordVisible` 到 `FourMascots`，并保留 `MascotState` 导出（Login/Signup 依赖）。
- `FourMascots.tsx` 导出纯函数 `computeEyeOffset`（atan2+cos/sin 封顶 MAX_DIST=9）与 `modeFromState`（state→模式，focus-username/typing 收敛）。JS 仅算位移（rAF）+ 类名开关，动画全 CSS `<style>` 注入。
- 角色用 `data-mascot="0..3"` 定位，容器 `data-four-mascots`（带 `mode-<x>`），瞳孔取 style var `--px/--py`。
- 「偷看」链接：`Common/Input.tsx` 的 `showPasswordToggle` toggle 触发 `onVisibilityToggle(visible)` → Login/Signup `onPasswordVisibleChange` → AuthPage `passwordVisible` state → InteractiveMascot。

**Why:** 复刻 careercompass 交互（邮箱变高对视/密码遮眼/显示偷看/失败摇头/随机眨眼），保持左栏 `hidden md:flex w-[45%]` 不变；无 e2e 覆盖 Auth 表单（仓库无 login e2e spec）。

**How to apply:** 改 Auth mascot 时勿破坏 `MascotState` 导出与 `data-mascot` 序号；测试在 jsdom mock `getBoundingClientRect` + rAF（act 包裹），见 `tests/render/components/Auth/FourMascots.test.tsx`。
