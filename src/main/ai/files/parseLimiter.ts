// ============================================
// 解析并发限流（B2 一-2②）
// 主进程单线程：多文件批量上传时限制同时执行的解析任务数，
// 避免同时开 20 个 pdf 把主进程阻塞。任务异步排队，FIFO 补位。
// ============================================

/** 默认最大并发解析数（解析为 CPU 密集，保守取 3） */
export const PARSE_MAX_CONCURRENCY = 3;

/** 当前正在执行的任务数 */
let activeCount = 0;

/** 排队中的等待者（limit = 该任务允许启动时的最大并发数） */
const waiters: Array<{ limit: number; resolve: () => void }> = [];

/** 唤醒全部等待者，由其自行重查并发条件后占位或重新排队 */
function wakeAll(): void {
  const pending = waiters.splice(0, waiters.length);
  for (const w of pending) w.resolve();
}

/**
 * 在并发上限内执行一个解析任务。
 * 语义：任务启动瞬间 activeCount 必须小于 limit；不足则 FIFO 排队。
 * @param task 实际解析工作（如 parseDocument）
 * @param limit 并发上限（缺省 PARSE_MAX_CONCURRENCY；测试可注入）
 */
export async function parseWithLimit<T>(
  task: () => Promise<T>,
  limit: number = PARSE_MAX_CONCURRENCY
): Promise<T> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('parseWithLimit: limit must be a positive integer');
  }

  while (activeCount >= limit) {
    await new Promise<void>((resolve) => {
      waiters.push({ limit, resolve });
    });
  }
  activeCount += 1;

  try {
    return await task();
  } finally {
    activeCount -= 1;
    wakeAll();
  }
}
