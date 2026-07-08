# 设置界面 (Settings) 功能总结

> 模块编号：05 | 优先级：P1 | 最后更新：2026-07-08

---

## 1. 功能概述

应用设置模态框，包含系统设置（语言选择、外观主题、自定义主题）和账号管理（账号信息、切换账号、创建新账号、删除账号）。

## 2. 架构位置

```
src/render/components/Settings/
├── SettingsModal.tsx       # 设置模态框容器
├── ThemeSelector.tsx       # 主题选择器
└── AccountManager.tsx      # 账号管理
src/render/stores/uiStore.ts    # UI 状态（主题、语言持久化）
src/render/stores/authStore.ts  # 认证状态
src/main/ipc-handlers.ts        # 设置 IPC 处理器
src/main/db/settings.ts         # 设置数据库操作
src/render/styles/globals.css   # 主题 CSS 变量
```

## 3. 实现逻辑流程

### 3.1 设置模态框打开流程

```
用户点击 Help → Settings
  ↓
uiStore.openModal('settings')
  ↓
MainPage 检测 activeModal === 'settings'
  ↓
渲染 <SettingsModal isOpen={true} onClose={closeModal} />
  ↓
加载用户设置（主题、语言）
```

### 3.2 主题切换流程

```
用户在 ThemeSelector 中选择主题
  ↓
uiStore.setTheme(theme)
  ├── set({ theme })
  ├── persistSettings() → localStorage.setItem('weavemd_ui', JSON.stringify({...}))
  └── 触发 App.tsx useEffect
      ↓
document.documentElement.classList.remove('dark', 'light', ...)
document.documentElement.classList.add(theme)
  ↓
CSS 变量切换 → 全局样式更新
  ↓
Monaco Editor 主题同步更新
```

### 3.3 语言切换流程

```
用户选择语言
  ↓
uiStore.setLanguage(language)
  ├── set({ language })
  └── persistSettings() → localStorage
  ↓
I18nProvider 检测 language 变化
  ↓
加载对应 JSON 字典
  ↓
所有使用 useI18n() 的组件重新渲染
```

### 3.4 账号管理流程

```
设置 → 账号管理
  ├── 显示当前登录账号
  ├── 切换账号: 显示历史账号列表 → 输入密码 → 切换
  ├── 创建新账号: 打开注册流程
  ├── 账号信息: 笔记数量、创建时间、最后修改时间
  └── 删除账号: 确认弹框 → IPC → 级联删除
```

## 4. 实现细节

### 4.1 主题系统

#### 5 种预设主题

| 主题            | 背景色         | 导航栏         | 强调色         | 适用场景  |
| --------------- | -------------- | -------------- | -------------- | --------- |
| `light`         | 白色 `#FFFFFF` | 深色 `#1A1A1A` | 紫蓝 `#7C3AED` | 日间使用  |
| `dark`          | 深黑 `#0F0F0F` | 暗灰 `#1A1A1A` | 紫蓝 `#7C3AED` | 默认/夜间 |
| `light-header`  | 白色 `#FFFFFF` | 白色 `#FFFFFF` | 紫蓝 `#7C3AED` | 简洁风格  |
| `high-contrast` | 纯黑 `#000000` | 纯黑 `#000000` | 金色 `#FFD700` | 无障碍    |
| `custom`        | 用户自定义     | 用户自定义     | 用户自定义     | 个性化    |

#### CSS 变量实现

```css
/* Dark Theme */
html.dark {
  --bg-primary: #0f0f0f;
  --bg-secondary: #1a1a1a;
  --border-color: #2d2d2d;
  --text-primary: #ffffff;
  --text-sub: #999999;
  --accent: #7c3aed;
  --navbar-bg: #1a1a1a;
  --navbar-text-primary: #ffffff;
  --input-bg: #0f0f0f;
  --modal-bg: #1a1a1a;
  --shadow-modal: 0 4px 24px rgba(0, 0, 0, 0.4);
}

/* High Contrast Theme */
html.high-contrast {
  --bg-primary: #000000;
  --border-color: #ffffff;
  --accent: #ffd700;
  --accent-secondary: #ffa500;
  --shadow-modal: 0 4px 24px rgba(255, 255, 255, 0.1);
}
```

#### 主题切换实现

```typescript
// App.tsx
useEffect(() => {
  const html = document.documentElement;
  html.classList.remove('dark', 'light', 'light-header', 'high-contrast', 'custom');
  html.classList.add(theme);
}, [theme]);
```

### 4.2 自定义主题面板

| 设置项       | 选项                    | 实现                           |
| ------------ | ----------------------- | ------------------------------ |
| 导航栏颜色   | 5 种预设圆形选择器      | `THEME_PRESETS.navbarColors`   |
| 背景颜色     | 5 种预设                | `THEME_PRESETS.bgColors`       |
| 背景图片上传 | 最大 10MB, JPG/PNG/WebP | 文件上传按钮                   |
| 保存         | ✓ Save                  | 持久化到 localStorage + 数据库 |
| 取消         | Cancel                  | 恢复之前设置                   |

```typescript
// 预设颜色
export const THEME_PRESETS = {
  navbarColors: ['#1A1A1A', '#7C3AED', '#6366F1', '#0F0F0F', '#FFFFFF'],
  bgColors: ['#0F0F0F', '#FFFFFF', '#1a1a2e', '#0d1b2a', '#1b1b2f'],
};
```

### 4.3 设置持久化

```typescript
// uiStore.ts
persistSettings: () => {
  const { theme, language, sidebarWidth } = get();
  localStorage.setItem('weavemd_ui', JSON.stringify({ theme, language, sidebarWidth }));
},

loadSettings: () => {
  try {
    const stored = localStorage.getItem('weavemd_ui');
    if (stored) {
      const { theme, language, sidebarWidth } = JSON.parse(stored);
      set({ theme: theme || 'light-header', language: language || 'zh-CN', sidebarWidth: sidebarWidth || 240 });
    }
  } catch { /* 使用默认值 */ }
},
```

### 4.4 后端设置同步

```typescript
// 登录时加载后端设置
const loadBackendSettings = async (userId: string) => {
  const result = await window.weaveMD.settings.get(userId);
  if (result.success && result.data) {
    if (result.data.theme) uiStore.setTheme(result.data.theme);
    if (result.data.language) uiStore.setLanguage(result.data.language);
  }
};

// 设置变化时同步到后端
const handleSave = async () => {
  await window.weaveMD.settings.update(userId, { theme, language, customColors });
};
```

### 4.5 IPC 通道

| 通道              | 参数                                        | 返回值                   |
| ----------------- | ------------------------------------------- | ------------------------ |
| `settings:get`    | `userId: string`                            | `IpcResponse<ISettings>` |
| `settings:update` | `{ userId, theme, language, customColors }` | `IpcResponse<ISettings>` |

### 4.6 数据库操作

```typescript
// settings.ts
export function getSettings(userId: string): ISettings | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId) as
    ISettings | undefined;
}

export function updateSettings(
  userId: string,
  updates: { theme?; language?; customColors? }
): ISettings {
  const db = getDatabase();
  const { theme, language, customColors } = updates;
  db.prepare(
    'UPDATE settings SET theme = ?, language = ?, custom_colors = ? WHERE user_id = ?'
  ).run(theme, language, customColors, userId);
  return getSettings(userId);
}
```

## 5. 与其他模块的交互

| 模块       | 交互方式                                      |
| ---------- | --------------------------------------------- |
| 编辑器     | 主题变化时同步更新 Monaco Editor 主题         |
| 认证系统   | 账号管理（切换/创建/删除）依赖认证状态        |
| 导航栏     | 通过 `uiStore.openModal('settings')` 打开设置 |
| 数据持久化 | 设置通过 IPC 同步到后端数据库                 |
| 国际化     | 语言设置通过 I18nProvider 全局生效            |

## 6. 关键设计决策

1. **CSS 变量主题**：使用 CSS 自定义属性实现主题切换，无需重新加载页面
2. **双层持久化**：设置同时存储到 localStorage（快速加载）和后端数据库（跨设备同步）
3. **5 种预设主题**：覆盖不同使用场景，包括高对比度无障碍主题
4. **自定义主题**：允许用户自定义导航栏和背景颜色，支持图片上传
5. **设置与账号绑定**：每个账号独立存储设置，切换账号时自动切换
