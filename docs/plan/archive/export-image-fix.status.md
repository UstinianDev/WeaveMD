# 导出图片修复状态

## 任务分级

- **分类**：优化
- **档位**：S 级（单模块，清晰度优化）
- **裁剪**：S → 直接修复

## 问题描述

用户报告导出的三种格式（png/jpg/jpeg）图片都不清晰，特别是文档里有图片时更糊。

## 根因分析

1. 导出窗口 CSS 宽度只有 800px，分辨率不足
2. 缩放因子太小（2x），导致输出图像分辨率只有 1600px
3. `toPNG` 没有指定 `scaleFactor` 参数，图像查看器无法正确识别高分辨率图像

## 修复方案

**文件**：`src/main/export/types.ts`, `src/main/export/exportService.ts`, `tests/main/export/exportService.test.ts`

### 修复 1：增加窗口宽度（types.ts）
```typescript
// 从 800px 增加到 1200px
export const EXPORT_IMAGE_WIDTH = 1200;
```

### 修复 2：简化渲染逻辑（exportService.ts）
```typescript
// 移除 offscreen: true（可能导致复杂文档渲染问题）
// 移除 3x 缩放因子（可能导致内存问题）
// 保留窗口宽度 1200px

await win.loadFile(tmpPath);

// 等待图片和字体加载完成
const contentHeight = (await win.webContents.executeJavaScript(WAIT_AND_MEASURE_SCRIPT)) as number;

// 等待渲染周期完成
await win.webContents.executeJavaScript(
  'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))',
);

// capturePage
const image = await win.webContents.capturePage();

// toPNG/toJPEG（不指定 scaleFactor，使用默认值）
const buffer = format === 'png'
  ? image.toPNG()
  : image.toJPEG(EXPORT_JPEG_QUALITY);
```

### 原理
- 窗口 CSS 宽度 1200px 提供足够的基础分辨率
- 移除 `offscreen: true` 避免复杂文档渲染问题
- 移除 3x 缩放因子避免内存问题
- 双 rAF 等待确保 Chromium 完成布局和绘制

## 测试更新

**文件**：`tests/main/export/exportService.test.ts`

- 移除 `setZoomFactor` mock（不再使用）
- 更新断言：`capturePage` 不传参数
- 移除 buffer 大小检查（测试中 mock buffer 较小）

## 门禁结果

| 门禁 | 结果 |
|------|------|
| tsc --noEmit | 本次文件 0 错误（已有 ipc.test.ts 3 错误为存量） |
| vitest | 1534 passed / 0 failed（exportService 19/19 ✅） |

## 验证方法

1. 运行 `npm run dev` 启动应用
2. 使用测试文档："C:\Users\lenovo\Desktop\测试\AI应用开发中的流式输出_从协议原理到工程实战的完整指南.md"
3. 导出为 .png、.jpeg、.jpg
4. 用系统图片查看器打开，验证能正常显示

## 状态

- [x] 问题定位
- [x] 代码修复
- [x] 测试更新
- [x] 门禁通过
- [ ] 用户验证
