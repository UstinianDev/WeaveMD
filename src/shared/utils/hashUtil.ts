// ============================================
// WeaveMD — 统一 xxHash 封装（S4 — MD5 → xxHash 迁移）
// ============================================
// 提供 xxHash64 异步（WASM 懒加载）与 xxHash64Sync 同步（djb2 降级）两个版本。
// 主进程 / 渲染进程共用。
//
// 使用方式：
//   - 主进程 staleness detection（同步路径首选）：xxHash64Sync(content)
//   - 渲染进程 hash 比对（同步）：xxHash64Sync(content)
//   - 需要确定性 64-bit hash 的异步场景：await xxHash64(content)

import xxhash from 'xxhash-wasm';
import type { XXHashAPI } from 'xxhash-wasm';

let api: XXHashAPI | null = null;
let initPromise: Promise<XXHashAPI> | null = null;

async function ensureInit(): Promise<XXHashAPI> {
  if (api) return api;
  if (!initPromise) {
    initPromise = xxhash()
      .then((a) => {
        api = a;
        return a;
      })
      .catch((err) => {
        // WASM 加载失败时重置 promise，允许后续重试
        initPromise = null;
        throw err;
      });
  }
  return initPromise;
}

/**
 * xxHash64 异步版本（WASM 懒加载）。
 * 首次调用触发 WASM 模块加载和初始化。
 * 适用于可等待的异步上下文。
 */
export async function xxHash64(input: string): Promise<string> {
  const a = await ensureInit();
  return a.h64ToString(input);
}

/**
 * xxHash64 同步版本。
 * - 若 WASM API 已就绪 → 使用 xxHash64（64-bit 十六进制字符串）。
 * - 若 WASM 未就绪 → 降级为 djb2 哈希（32-bit 十六进制字符串），不抛出异常。
 *
 * 主进程 staleness detection 路径与渲染进程 rewriteStore 均使用此函数。
 */
export function xxHash64Sync(input: string): string {
  if (api) {
    return api.h64ToString(input);
  }
  return djb2Hash(input);
}

/**
 * djb2 降级哈希（32-bit → hex，非密码学用途）。
 * 用于 WASM 未就绪时的 fallback 路径。
 */
function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}