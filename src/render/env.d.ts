// ============================================
// WeaveMD — Type Declarations for Renderer
// ============================================

/// <reference types="vite/client" />

import type { WeaveMDApi } from '../main/preload';

declare global {
  interface Window {
    weaveMD: WeaveMDApi;
    /**
     * 编辑主区 v2 开关：false 回退 v1 渲染路径（M2-M4 并行期使用）。
     * 默认启用 v2；可在 DevTools 控制台设置为 false 后刷新页面回退。
     */
    __EDITOR_V2__?: boolean;
  }
}
