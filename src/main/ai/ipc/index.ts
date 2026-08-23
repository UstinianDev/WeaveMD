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
import { registerAgentHandlers } from './agentHandlers';
import { registerRewriteHandlers } from './rewriteHandlers';
import { registerModelHandlers } from './modelHandlers';
import { registerEmbeddingHandlers } from './embeddingHandlers';
import { registerSearchHandlers } from './searchHandlers';

export function registerAiIpcHandlers(): void {
  registerConfigConsentHandlers();
  registerChatHandlers();
  registerKbHandlers();
  registerAgentHandlers();
  registerRewriteHandlers();
  registerModelHandlers();
  registerEmbeddingHandlers();
  registerSearchHandlers();
}
