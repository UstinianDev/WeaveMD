# 构建与发布

> 最后更新：2026-09-09

## 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| 构建工具 | Vite | ^5 |
| 打包 | Electron Builder | - |
| 桌面框架 | Electron | ^31 |

## 构建命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | Vite + Electron 开发模式（HMR） |
| `npm run build` | Vite build + electron-builder 打包 |
| `npm run test` | Vitest 单元测试 |
| `npm run typecheck` | TypeScript 类型检查（tsc --noEmit） |
| `npm run lint` | ESLint 代码检查 |
| `npx playwright test` | Playwright E2E 测试 |

## 构建流程

```
npm run build
    ↓
Vite build（前端资源）
    ↓
electron-builder（打包 Electron）
    ↓
输出：dist/ 目录（.exe / .dmg / .AppImage）
```

## 开发模式

```
npm run dev
    ↓
Vite dev server（HMR 热更新）
    ↓
Electron 主进程（自动重启）
    ↓
渲染进程（热更新）
```

## 目录结构

```
WeaveMD/
├── src/
│   ├── main/              # Electron 主进程
│   ├── render/            # React 前端
│   └── shared/            # 跨进程共享类型
├── docs/                  # 项目文档
├── tests/                 # 测试
├── e2e/                   # E2E 测试
├── package.json           # 项目配置
├── vite.config.ts         # Vite 配置
├── tsconfig.json          # TypeScript 配置
├── tailwind.config.js     # TailwindCSS 配置
└── electron-builder.yml   # Electron Builder 配置
```

## 打包配置

`electron-builder.yml` 配置：

- 输出目录：`dist/`
- 应用名：WeaveMD
- 图标：`build/icon.ico`
- 安装程序：NSIS（Windows）

详细打包指南：[guide/packaging.md](../guide/packaging.md)

## 环境变量

| 变量 | 说明 |
|------|------|
| `VITE_JWT_SECRET` | JWT 密钥（可选，运行时生成） |

## 依赖管理

```bash
# 安装依赖
npm install

# 更新依赖
npm update

# 检查过时依赖
npm outdated
```
