# 清理 Debug 埋点代码计划

## 问题分析

### 假设
之前 Debug 模式（"假设 → 埋点 → 复现 → 用数据验证 → 修复 → 再验证 → 清理"工作流）遗留的调试埋点代码未完全清理。

### 问题描述
- **现象**：导入文档后，开发者控制台持续报错：
  ```
  Refused to connect to 'http://localhost:7777/event' because it violates the document's Content Security Policy.
  ```
- **根因**：`EditorView.tsx` 中有两处向 `http://localhost:7777/event` 发送 POST 请求的调试代码

### 代码位置
`d:\software\WeaveMD\src\render\components\Editor\EditorView.tsx`

- **位置 1** (L258-276): `debug-point H1:render-block-start` 区域
- **位置 2** (L281-292): `debug-point H1:render-block-done` 区域

## 修改计划

### 文件修改
**`src/render/components/Editor/EditorView.tsx`**

1. **删除第一处调试代码** (L258-276)
   - 移除 `#region debug-point H1:render-block-start` 注释
   - 移除 `fetch('http://localhost:7777/event', {...})` 调用
   - 移除 `#endregion` 注释

2. **删除第二处调试代码** (L281-292)
   - 移除 `#region debug-point H1:render-block-done` 注释
   - 移除 `fetch('http://localhost:7777/event', {...})` 调用
   - 移除 `#endregion` 注释

## 验证步骤
1. 运行 `npm run typecheck` 确认类型检查通过
2. 运行 `npm run lint` 确认 Lint 检查通过
3. 启动应用，导入文档，确认控制台不再报错

## 风险评估
- **风险等级**：低
- **影响范围**：仅删除调试代码，不影响核心功能
- **回滚方案**：如需恢复，使用 git 恢复文件