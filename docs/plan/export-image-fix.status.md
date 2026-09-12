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

**文件**：`src/main/export/types.ts`, `src/main/export/exportService.ts`

### 修复 1：增加窗口宽度（types.ts）
```typescript
// 从 800px 增加到 1200px
export const EXPORT_IMAGE_WIDTH = 1200;

// 新增：3x 缩放因子（3600px 设备像素宽）
export const EXPORT_SCALE_FACTOR = 3;
```

### 修复 2：使用 3x 缩放因子（exportService.ts）
```typescript
// 设置 3x 缩放因子以获得高分辨率输出
win.webContents.setZoomFactor(EXPORT_SCALE_FACTOR);

// toPNG 指定 scaleFactor 参数，让图像查看器正确识别
const buffer = format === 'png'
  ? image.toPNG({ scaleFactor: EXPORT_SCALE_FACTOR })
  : image.toJPEG(EXPORT_JPEG_QUALITY);
```

### 原理
- 窗口 CSS 宽度 1200px × 缩放因子 3x = 3600px 设备像素宽
- `capturePage` 按设备像素捕获，获得 3600px 宽的高分辨率图像
- `toPNG({ scaleFactor: 3 })` 告诉图像查看器这是 3x 分辨率图像
- 文档中的图片也会以 3x 分辨率渲染，不会模糊

## 技术参考

- Electron 文档：`image.toPNG([options])` - `scaleFactor` 参数控制输出图像的 DPI
- `setZoomFactor(factor)` - 改变渲染器的缩放因子
- `capturePage` 自动按设备像素捕获

## 验证方法

1. 运行 `npm run dev` 启动应用
2. 导出包含图片的文档为 .png、.jpeg、.jpg
3. 用系统图片查看器打开，验证：
   - 文本清晰锐利
   - 文档中的图片不模糊
   - 图片属性显示分辨率约为 3600px 宽

## 状态

- [x] 问题定位
- [x] 代码修复
- [ ] 用户验证
