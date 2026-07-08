# 导出功能 (Export) 功能总结

> 模块编号：10 | 优先级：P1 | 最后更新：2026-07-08

---

## 1. 功能概述

支持将笔记导出为 Markdown (.md)、Word (.doc)、PDF (.pdf) 三种格式。导出功能在导航栏的导出按钮触发，通过系统保存对话框选择保存位置。

## 2. 架构位置

```
src/main/ipc-handlers.ts    # 导出 IPC 处理器（MD/Word/PDF）
src/main/preload.ts         # 预加载脚本（暴露导出 API）
src/shared/constants.ts     # IPC 通道常量
```

## 3. 实现逻辑流程

### 3.1 导出触发流程

```
用户点击导航栏 ⬇ 导出按钮
  ↓
选择导出格式 (MD / Word / PDF)
  ↓
IPC: export:md / export:docx / export:pdf({ content, filename })
  ↓
系统保存对话框 (dialog.showSaveDialog)
  ↓
主进程处理导出 → 写入文件
  ↓
返回 { success: true, data: { filePath } }
```

### 3.2 Markdown 导出流程

```
用户选择 MD 格式
  ↓
IPC: export:md({ content, filename })
  ↓
dialog.showSaveDialog({
  defaultPath: `${filename}.md`,
  filters: [{ name: 'Markdown', extensions: ['md'] }]
})
  ↓
fs.writeFileSync(filePath, content, 'utf-8')
  ↓
返回 { success: true, data: { filePath } }
```

### 3.3 Word 导出流程

```
用户选择 Word 格式
  ↓
IPC: export:docx({ content, filename })
  ↓
dialog.showSaveDialog({
  defaultPath: `${filename}.doc`,
  filters: [{ name: 'Word Document', extensions: ['doc'] }]
})
  ↓
将内容包装为 HTML 格式（Word 兼容）
  ↓
fs.writeFileSync(filePath, htmlContent, 'utf-8')
  ↓
返回 { success: true, data: { filePath } }
```

### 3.4 PDF 导出流程

```
用户选择 PDF 格式
  ↓
IPC: export:pdf({ content, filename })
  ↓
dialog.showSaveDialog({
  defaultPath: `${filename}.pdf`,
  filters: [{ name: 'PDF', extensions: ['pdf'] }]
})
  ↓
创建隐藏 BrowserWindow
  ↓
加载 HTML 内容 (data: URL)
  ↓
webContents.printToPDF({ printBackground: true })
  ↓
fs.writeFileSync(filePath, pdfData)
  ↓
关闭隐藏窗口
  ↓
返回 { success: true, data: { filePath } }
```

## 4. 实现细节

### 4.1 Markdown 导出

```typescript
// 最简单的导出方式：直接保存 .md 文件
ipcMain.handle(IPC_CHANNELS.EXPORT_MD, async (_event, { content, filename }) => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showSaveDialog(win, {
    title: 'Export Markdown',
    defaultPath: `${filename}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' };
  fs.writeFileSync(result.filePath, content, 'utf-8');
  return { success: true, data: { filePath: result.filePath } };
});
```

### 4.2 Word 导出

```typescript
// 保存为 HTML 包装的 .doc 文件（Word 可打开 HTML）
ipcMain.handle(IPC_CHANNELS.EXPORT_DOCX, async (_event, { content, filename }) => {
  // ...
  const htmlContent = `<!DOCTYPE html>
    <html><head><meta charset="utf-8"></head>
    <body><pre>${content}</pre></body></html>`;
  fs.writeFileSync(result.filePath, htmlContent, 'utf-8');
  return { success: true, data: { filePath: result.filePath } };
});
```

### 4.3 PDF 导出

```typescript
// 使用隐藏窗口 + printToPDF 生成 PDF
ipcMain.handle(IPC_CHANNELS.EXPORT_PDF, async (_event, { content, filename }) => {
  // ... 弹窗保存对话框

  // 创建隐藏窗口
  const pdfWin = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  // 加载 HTML 内容
  const htmlContent = `<!DOCTYPE html>
    <html><head><meta charset="utf-8"><style>
      body { font-family: -apple-system, sans-serif; padding: 40px; color: #000; background: #fff; white-space: pre-wrap; }
    </style></head><body>${escapeHtml(content)}</body></html>`;

  await pdfWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
  const pdfData = await pdfWin.webContents.printToPDF({ printBackground: true });
  fs.writeFileSync(filePath, pdfData);
  pdfWin.close();
  return { success: true, data: { filePath } };
});
```

### 4.4 IPC 通道

| 通道          | 参数                                    | 返回值                              |
| ------------- | --------------------------------------- | ----------------------------------- |
| `export:md`   | `{ content: string, filename: string }` | `IpcResponse<{ filePath: string }>` |
| `export:docx` | `{ content: string, filename: string }` | `IpcResponse<{ filePath: string }>` |
| `export:pdf`  | `{ content: string, filename: string }` | `IpcResponse<{ filePath: string }>` |

### 4.5 预加载 API

```typescript
// 渲染进程通过 window.weaveMD.export 调用
export: {
  md: (content: string, filename: string) => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_MD, { content, filename }),
  docx: (content: string, filename: string) => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_DOCX, { content, filename }),
  pdf: (content: string, filename: string) => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_PDF, { content, filename }),
}
```

## 5. 导出格式对比

| 格式     | 扩展名 | 实现方式     | 优点             | 缺点              |
| -------- | ------ | ------------ | ---------------- | ----------------- |
| Markdown | `.md`  | 直接保存文本 | 简单、通用       | 纯文本，无样式    |
| Word     | `.doc` | HTML 包装    | Word 可打开      | 非标准 .docx 格式 |
| PDF      | `.pdf` | printToPDF   | 格式固定、可打印 | 需要创建隐藏窗口  |

## 6. 关键设计决策

1. **Markdown 直接保存**：最简单的导出方式，保持原始内容
2. **Word 使用 HTML 包装**：当前为简化实现，完整的 docx 库集成将在生产版本中完善
3. **PDF 使用 printToPDF**：利用 Electron 内置的 Chromium 打印功能，无需额外依赖
4. **内容转义**：PDF 导出时对 HTML 特殊字符进行转义，防止 XSS
5. **隐藏窗口**：PDF 导出使用隐藏 BrowserWindow，对用户无感知
