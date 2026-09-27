# 构建与发布

> 最后更新：2026-09-27

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
| `npm run clean` | 清理构建产物（`prebuild` 自动执行） |
| `npm run build` | `vite build && electron-builder`（`postbuild` 自动执行体积门禁） |
| `npm run size` | 体积门禁：Setup ≤500MB、unpacked ≤1GB 双口径校验 |
| `npm run test` | Vitest 单元测试 |
| `npm run typecheck` | TypeScript 类型检查（tsc --noEmit） |
| `npm run lint` | ESLint 代码检查 |
| `npx playwright test` | Playwright E2E 测试 |

## 构建流程

```
npm run build
    ↓
prebuild → clean（清理旧产物）
    ↓
Vite build（前端资源）
    ↓
electron-builder（打包 Electron）
    ↓
postbuild → size（体积门禁 sizeGate.mjs）
    ↓
输出：release/ 目录（.exe / .dmg / .AppImage）
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
├── scripts/               # 构建辅助（clean.mjs / sizeGate.mjs / 迁移冒烟）
├── package.json           # 项目配置 + electron-builder 配置（`build` 字段）
├── vite.config.ts         # Vite 配置
├── tsconfig.json          # TypeScript 配置
└── tailwind.config.ts     # TailwindCSS 配置
```

## 打包配置

配置在 `package.json` 的 `build` 字段（本项目无独立 `electron-builder.yml`）：

- 输出目录：`release/`
- 应用名：WeaveMD，appId `com.weavemd.app`
- 图标：`public/icons/icon.png`
- 目标：Windows `nsis` + `msi`、macOS `dmg` + `zip`、Linux `AppImage`
- `files` 21 条反向排除（react-icons / monaco-editor / liteparse-linux 原生件 / jieba-wasm 多运行时 / better-sqlite3 deps）
- **注意**：排除 liteparse 的 Linux 原生件与 `linux.target: AppImage` 互斥，执行 Linux 打包会缺原生件（见 R9）

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
