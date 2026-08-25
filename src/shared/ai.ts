// ============================================
// WeaveMD — AI 共享类型（渲染/主进程共用）
// ============================================
// 按域拆分为子模块，本文件为 re-export 聚合器。
// 所有 `import { ... } from '@shared/ai'` 继续工作。

export * from './ai/config';
export * from './ai/conversation';
export * from './ai/agent';
export * from './ai/kb';
export * from './ai/rewrite';
export * from './ai/embedding';
export * from './ai/search';
export * from './ai/model';
export * from './ai/task';
export * from './ai/clarify';
export * from './ai/document';
export * from './ai/mention';
