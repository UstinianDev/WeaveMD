// ============================================
// WeaveMD — 复制绝对路径工具（agent-kb-ux R4）
// ============================================
// 文件树右键「复制文件地址」：路径判定 + clipboard 写入，失败不静默。

export type CopyPathResult = 'copied' | 'failed';

/**
 * 绝对路径判定（与 main/agentHandlers 同口径）：不依赖 path 模块
 * （测试环境 browserify path 为 posix 语义，会误拒 Windows 盘符路径），
 * 正斜杠根 / UNC / Windows 盘符三种形态白名单。
 */
export function isAbsolutePath(p: string): boolean {
  return (
    p.startsWith('/') ||
    p.startsWith('\\\\') ||
    /^[a-zA-Z]:[\\/]/.test(p)
  );
}

/**
 * 将绝对路径写入系统剪贴板。空/非绝对路径一律返回 'failed'。
 * 优先主进程桥 clipboard.writeText（打包 Electron 非安全上下文下
 * navigator.clipboard 恒 reject → 恒 'failed'，故桥为主路径）；
 * 桥缺失/抛错/返回 false → 回落 navigator.clipboard；两端均失败 → 'failed'
 * （不静默吞错，由调用方展示失败提示）。
 */
export async function copyPathToClipboard(path: string): Promise<CopyPathResult> {
  if (!path || !isAbsolutePath(path)) return 'failed';

  // 1) 主进程剪贴板桥（contextBridge）
  try {
    const bridgeWrite = window.weaveMD?.clipboard?.writeText;
    if (typeof bridgeWrite === 'function') {
      const ok = await bridgeWrite(path);
      if (ok === true) return 'copied';
      // false → 继续回落 navigator
    }
  } catch {
    // 桥不存在/IPC 抛错 → 继续回落 navigator
  }

  // 2) 回落浏览器剪贴板
  try {
    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') return 'failed';
    await clipboard.writeText(path);
    return 'copied';
  } catch {
    return 'failed';
  }
}
