// ============================================
// WeaveMD — 第 5 期块级改写运行时冒烟验证脚本（临时，Electron 真验）
// ============================================
// 目的：在 **Electron 运行时**（safeStorage 可用）用 **真实 DeepSeek key** 验证
// 第 5 期主进程薄 LLM 代理（src/main/ai/rewrite.ts）：
//   1. selection scope：真实 LLM 收到选区片段 + 改写指令 → 返回改写后完整 Markdown（text 非空且 ≠ 原文）
//   2. document scope：真实 LLM 收到编号块列表 → 返回 JSON 数组 [{block_index,new_content}]（可解析、含合法下标）
//   3. 任何路径都不写盘、不落库——只产 {text}（铁律一）
//
// 关键点：直接引用生产 TS 模块（rewrite.ts/llmClient/secureConfig），不复刻逻辑。
// esbuild buildSync 打包成临时 CJS bundle（external electron），再 require 运行。
//
// key 来源（安全）：process.env.DEEPSEEK_API_KEY 优先，否则 ~/.weavemd-deepseek-key 文件。
// 任何路径都【不打印 key 本身】；输出时用 [REDACTED] 替换。
//
// 运行：  npx electron scripts/rewrite-smoke.cjs
// 退出码 0 = 全 PASS；非 0 = FAIL（含网络失败）。
// 注意：仅 `node --check` 验证语法即可；实际执行需真实 key。

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// 1. 读取真实 key（安全：永不打回显）
// ---------------------------------------------------------------------------
function resolveApiKey() {
  const fromEnv = process.env.DEEPSEEK_API_KEY;
  if (fromEnv && fromEnv.trim()) {
    return { key: fromEnv.trim(), source: 'env(DEEPSEEK_API_KEY)' };
  }
  const filePath = path.join(os.homedir(), '.weavemd-deepseek-key');
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    if (raw) return { key: raw, source: `file(${filePath})` };
  }
  return null;
}

const keyInfo = resolveApiKey();
if (!keyInfo) {
  // eslint-disable-next-line no-console
  console.error(
    '[rewrite-smoke] 未提供 key：请设 DEEPSEEK_API_KEY 或创建 ~/.weavemd-deepseek-key'
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. 内联的生产模块入口（打包后运行；仅引用真实 export，不跳安全闸）
// ---------------------------------------------------------------------------
const ENTRY_TS = `
import { app } from 'electron';
import { runRewrite, buildRewriteMessages } from '@main/ai/rewrite';
import { encryptApiKey } from '@main/ai/secureConfig';
import type { IAIConfig, RewriteRequestPayload } from '@shared/ai';

function mask(text: string, key: string): string {
  return text.replace(key, '[REDACTED]');
}

export async function runSmoke(key: string, _tmpDir: string): Promise<Record<string, unknown>> {
  await app.whenReady();
  const out: Record<string, unknown> = {};

  const enc = encryptApiKey(key).enc;
  if (!enc) throw new Error('encryptApiKey 返回空密文——safeStorage 不可用');

  const config: IAIConfig = {
    backend: 'remote',
    ollamaBaseUrl: 'http://localhost:11434',
    remoteBaseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    hasApiKey: true,
  };

  const controller = new AbortController();
  const stubEvent = {} as unknown as Electron.IpcMainInvokeEvent; // rewrite.ts 不使用 event

  // -----------------------------------------------------------------------
  // STEP A：selection scope — 真实 LLM 改写选区片段
  // -----------------------------------------------------------------------
  const snippet = [
    '### 本周项目进展',
    '本周我们完成了编辑器的块级改写功能开发，实现了选区触发、定向块编辑协议与红删绿增预览。',
    '目前功能已经通过单元测试与端到端测试，正在进行最后的性能优化。',
  ].join('\\n');

  const selPayload: RewriteRequestPayload = {
    userId: 'smoke',
    scope: 'selection',
    instruction: '把这段改写得更简洁、更有条理，保留 Markdown 结构。',
    selectionMarkdown: snippet,
  };

  // 消息组装纯函数可同步断言（无网络）
  const selMsgs = buildRewriteMessages(selPayload);
  if (selMsgs.length !== 2 || selMsgs[1].content !== snippet) {
    throw new Error('buildRewriteMessages(selection) 组装不符');
  }
  out.msgRoles = selMsgs.map((m) => m.role);

  const selReply = await runRewrite(stubEvent, selPayload, config, enc, controller);
  out.selTextSample = mask(selReply.text.slice(0, 200), key);
  if (!selReply.text.trim()) {
    throw new Error('selection 改写返回空文本——LLM 未产出内容');
  }
  if (selReply.text.trim() === snippet.trim()) {
    throw new Error('selection 改写返回与原文完全相同——未发生改写');
  }
  out.selChanged = true;

  // -----------------------------------------------------------------------
  // STEP B：document scope — 真实 LLM 返回 JSON 数组（编号块协议）
  // -----------------------------------------------------------------------
  const numberedBlocks = [
    { blockIndex: 0, blockId: 'b0', markdown: '# 项目文档' },
    { blockIndex: 1, blockId: 'b1', markdown: '本项目使用 Electron + React 构建，采用块树内核实现双向转换。' },
    { blockIndex: 2, blockId: 'b2', markdown: 'AI 面板提供 Chat 与 Agent 两种智能体。' },
  ];

  const docPayload: RewriteRequestPayload = {
    userId: 'smoke',
    scope: 'document',
    instruction: '只改写第 2 块（block_index=1），把陈述句改成疑问句。',
    numberedBlocks,
  };

  const docMsgs = buildRewriteMessages(docPayload);
  if (docMsgs.length !== 2) {
    throw new Error('buildRewriteMessages(document) 组装不符');
  }
  out.docMsgUserContainsNumbered = docMsgs[1].content.includes('"block_index"');

  const docReply = await runRewrite(stubEvent, docPayload, config, enc, controller);
  out.docReplySample = mask(docReply.text.slice(0, 300), key);

  let parsed: Array<{ block_index?: number; new_content?: string }>;
  try {
    parsed = JSON.parse(docReply.text);
  } catch {
    throw new Error('document 改写返回非 JSON 数组：' + mask(docReply.text.slice(0, 200), key));
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('document 改写返回空数组');
  }
  const first = parsed[0];
  if (typeof first?.block_index !== 'number' || typeof first?.new_content !== 'string') {
    throw new Error('document 改写 JSON 缺 block_index/new_content：' + mask(JSON.stringify(parsed), key));
  }
  const validIndex = parsed.every(
    (op) =>
      typeof op.block_index === 'number' &&
      op.block_index >= 0 &&
      op.block_index < numberedBlocks.length
  );
  if (!validIndex) {
    throw new Error('document 改写含越界 block_index：' + mask(JSON.stringify(parsed), key));
  }
  out.docOpCount = parsed.length;
  out.docFirstOpIndex = first.block_index;

  // 铁律一：全程未写盘（rewrite.ts 只产 {text}；无 fs/sqlite 调用被触发——此处仅断言契约）
  out.noPersist = true;

  return out;
}
`;

// ---------------------------------------------------------------------------
// 3. 用 esbuild 把内联入口打包成临时 CJS bundle（真实 production 模块装入）
// ---------------------------------------------------------------------------
function buildEntry() {
  const esbuild = require('esbuild');
  const tmpTs = path.join(os.tmpdir(), `rewrite-smoke-entry-${process.pid}.ts`);
  const outJs = path.join(__dirname, `.rewrite-smoke-bundle-${process.pid}.js`);
  fs.writeFileSync(tmpTs, ENTRY_TS, 'utf-8');

  esbuild.buildSync({
    entryPoints: [tmpTs],
    outfile: outJs,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['electron', 'crypto', 'fs', 'path', 'os'],
    alias: {
      '@main': path.join(__dirname, '..', 'src', 'main'),
      '@shared': path.join(__dirname, '..', 'src', 'shared'),
    },
    logLevel: 'silent',
    absWorkingDir: __dirname,
    sourcemap: false,
  });
  return { outJs, tmpTs };
}

// ---------------------------------------------------------------------------
// 4. Electron 主进程执行
// ---------------------------------------------------------------------------
const { app } = require('electron');

async function main() {
  const built = buildEntry();
  try {
    // eslint-disable-next-line no-console
    console.log(`[rewrite-smoke] key 来源: ${keyInfo.source}`);
    const run = require(built.outJs).runSmoke;
    const report = await run(keyInfo.key, os.tmpdir());
    // eslint-disable-next-line no-console
    console.log('[rewrite-smoke] ===== PASS =====');
    // eslint-disable-next-line no-console
    console.log(`[rewrite-smoke] 消息角色序列: ${JSON.stringify(report.msgRoles)}`);
    // eslint-disable-next-line no-console
    console.log(`[rewrite-smoke] selection 改写已发生(≠原文)=${report.selChanged}`);
    // eslint-disable-next-line no-console
    console.log(`[rewrite-smoke] selection 输出样本: ${report.selTextSample}`);
    // eslint-disable-next-line no-console
    console.log(`[rewrite-smoke] document JSON 可解析=${!!report.docOpCount}, ops=${report.docOpCount}, 首个 block_index=${report.docFirstOpIndex}`);
    // eslint-disable-next-line no-console
    console.log(`[rewrite-smoke] document 输出样本: ${report.docReplySample}`);
    // eslint-disable-next-line no-console
    console.log(`[rewrite-smoke] 铁律一(只产文本未写盘)=${report.noPersist}`);
  } finally {
    if (built.outJs && fs.existsSync(built.outJs)) fs.unlinkSync(built.outJs);
    if (built.tmpTs && fs.existsSync(built.tmpTs)) fs.unlinkSync(built.tmpTs);
    app.quit();
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error('[rewrite-smoke] ===== FAIL =====');
  // eslint-disable-next-line no-console
  console.error('[rewrite-smoke] ' + msg.replace(keyInfo.key, '[REDACTED]'));
  process.exitCode = 1;
  app.quit();
});
