// ============================================
// WeaveMD — Type Declarations for Renderer
// ============================================

/// <reference types="vite/client" />

import type { WeaveMDApi } from '@main/preload';

declare global {
  interface Window {
    weaveMD: WeaveMDApi;
  }
}
