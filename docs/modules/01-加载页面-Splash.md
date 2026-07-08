# 加载页面 (Splash) 功能总结

> 模块编号：01 | 优先级：P0 | 最后更新：2026-07-08

---

## 1. 功能概述

应用启动时显示的加载动画页面，提供视觉过渡体验。包含紫色渐变光线扫过动画和品牌文字淡入效果，后台就绪时可提前跳转。

## 2. 架构位置

```
src/render/components/Auth/SplashLoader.tsx   # 加载动画组件
src/main/window.ts                            # 启动画面窗口创建
src/shared/constants.ts                       # 动画时长常量
src/render/styles/globals.css                 # 动画 CSS 定义
src/render/App.tsx                            # 阶段管理（splash → auth/main）
```

## 3. 实现逻辑流程

### 3.1 组件渲染流程

```
App.tsx 启动
  ↓
phase === 'splash'
  ↓
渲染 <SplashLoader onComplete={handleSplashComplete} />
  ↓
动画播放（1200ms 渐变 + 800ms 淡入）
  ↓
onComplete 回调 → setPhase(isAuthenticated ? 'main' : 'auth')
```

### 3.2 提前跳转机制

- 后台就绪时（如 Token 验证完成）可提前跳转，不等完整动画播放
- 通过 `App.tsx` 中的 `phase` 状态控制：`'splash' → 'auth' | 'main'`
- 点击画面可跳过动画

## 4. 实现细节

### 4.1 组件接口

```typescript
interface SplashLoaderProps {
  onComplete: () => void; // 动画完成后回调
}
```

### 4.2 动画时序

| 阶段         | 持续时间 | 描述                                       |
| ------------ | -------- | ------------------------------------------ |
| 渐变光线扫过 | 1200ms   | 紫色 45° 渐变光线从左到右扫过              |
| 文字淡入     | 800ms    | "WeaveMD" 文字从透明到不透明，向上位移 8px |
| 退出动画     | 300ms    | 整体淡出                                   |

### 4.3 CSS 动画定义

```css
/* 渐变光线扫过 */
@keyframes splash-gradient-sweep {
  0% {
    transform: translateX(-100%);
    opacity: 0;
  }
  50% {
    opacity: 1;
  }
  100% {
    transform: translateX(100%);
    opacity: 0;
  }
}

/* 文字淡入 */
@keyframes splash-fade-in {
  0% {
    opacity: 0;
    transform: translateY(8px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 退出淡出 */
@keyframes splash-fade-out {
  0% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
```

### 4.4 常量定义

```typescript
// src/shared/constants.ts
export const SPLASH_GRADIENT_DURATION = 1200; // ms - 渐变动画时长
export const SPLASH_FADE_DURATION = 800; // ms - 文字淡入时长
```

### 4.5 启动画面窗口

`createSplashWindow()` 创建独立的启动画面窗口：

```typescript
const splashWindow = new BrowserWindow({
  width: 400,
  height: 500,
  frame: false, // 无边框
  transparent: true, // 透明背景
  alwaysOnTop: true, // 置顶
  resizable: false, // 不可调整大小
  skipTaskbar: true, // 不在任务栏显示
});
```

### 4.6 阶段管理（App.tsx）

```typescript
type AppPhase = 'splash' | 'auth' | 'main';

const [phase, setPhase] = useState<AppPhase>('splash');

// 同步阶段与认证状态
useEffect(() => {
  if (phase === 'splash') return;
  setPhase(isAuthenticated ? 'main' : 'auth');
}, [isAuthenticated, phase]);
```

## 5. 与其他模块的交互

| 模块     | 交互方式                                                            |
| -------- | ------------------------------------------------------------------- |
| 认证系统 | Splash 完成后根据 `isAuthenticated` 状态跳转到 AuthPage 或 MainPage |
| 窗口管理 | 主窗口创建后显示，启动画面窗口独立于主窗口                          |
| 会话恢复 | Token 验证在 Splash 阶段并行进行，验证完成后可提前跳转              |

## 6. 关键设计决策

1. **提前跳转**：不等完整动画播放，后台就绪即可跳转，提升启动速度
2. **独立窗口**：启动画面使用独立 BrowserWindow，与主窗口分离
3. **CSS 动画**：使用纯 CSS 动画而非 JavaScript 动画库，减少依赖
4. **点击跳过**：用户可点击画面跳过动画，提供更好的用户体验
