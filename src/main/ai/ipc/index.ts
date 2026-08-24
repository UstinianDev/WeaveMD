// ============================================
// AI IPC Handler 注册入口
// ============================================
// 汇总各域 handler 模块，对外暴露 registerAiIpcHandlers()。
// 原 ipc.ts（771 行）按业务域拆分为：
//   configConsentHandlers — AI 配置 / 知情同意
//   chatHandlers         — 对话 / 会话 CRUD / 流式聊天
//   kbHandlers           — 知识库导入/检索/设置
//   agentHandlers        — Agent 运行/中断/技能列表
//   rewriteHandlers      — 改写预览
//   modelHandlers        — 模型列表

import { registerConfigConsentHandlers } from './configConsentHandlers';
import { registerChatHandlers } from './chatHandlers';
import { registerKbHandlers } from './kbHandlers';
import { registerAgentHandlers, initAgentQueue, cleanupAgentQueue } from './agentHandlers';
import { registerRewriteHandlers } from './rewriteHandlers';
import { registerModelHandlers } from './modelHandlers';
import { registerEmbeddingHandlers } from './embeddingHandlers';
import { registerSearchHandlers } from './searchHandlers';
import { registerModelConfigHandlers } from './modelConfigHandlers';
import { registerEmbeddingConfigHandlers } from './embeddingConfigHandlers';
import { registerSearchConfigHandlers } from './searchConfigHandlers';

export { initAgentQueue, cleanupAgentQueue } from './agentHandlers';

export function registerAiIpcHandlers(): void {
  registerConfigConsentHandlers();
  registerChatHandlers();
  registerKbHandlers();
  registerAgentHandlers();
  registerRewriteHandlers();
  registerModelHandlers();
  registerEmbeddingHandlers();      // 旧的保留（AI_EMBEDDING_TEST/CREATE 仍可用）
  registerSearchHandlers();          // 旧的保留（AI_SEARCH_TEST/RUN 仍可用）
  registerModelConfigHandlers();     // 新增：多模型配置 CRUD + 激活
  registerEmbeddingConfigHandlers(); // 新增：Embedding 配置 CRUD
  registerSearchConfigHandlers();    // 新增：搜索配置 CRUD
}
