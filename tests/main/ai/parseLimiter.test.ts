// ============================================
// B2 一-2②：主进程解析并发限流（避免同时开 20 个 pdf 阻塞单线程主进程）
// ============================================
import { describe, expect, it } from 'vitest';

import { parseWithLimit, PARSE_MAX_CONCURRENCY } from '@main/ai/files/parseLimiter';

/** 让出宏任务，使已就绪的微任务链跑完 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('parseWithLimit（解析并发限流）', () => {
  it('并发执行不超过上限（limit=2 提交 6 个任务，峰值并发为 2）', async () => {
    let active = 0;
    let peak = 0;
    const release: Array<() => void> = [];

    const jobs = Array.from({ length: 6 }, () =>
      parseWithLimit(
        () =>
          new Promise<void>((resolve) => {
            active += 1;
            peak = Math.max(peak, active);
            release.push(() => {
              active -= 1;
              resolve();
            });
          }),
        2
      )
    );

    await flush();
    // 只有前 2 个启动，其余排队
    expect(active).toBe(2);

    // 依次放行：每放行一个，队列补位一个
    while (release.length > 0) {
      release.shift()?.();
      await flush();
    }
    await Promise.all(jobs);

    expect(peak).toBe(2);
    expect(active).toBe(0);
  });

  it('任务按提交顺序依次启动（保序执行）', async () => {
    const order: number[] = [];
    const jobs = [0, 1, 2].map((i) =>
      parseWithLimit(async () => {
        order.push(i);
        await flush();
      }, 1)
    );

    await Promise.all(jobs);
    expect(order).toEqual([0, 1, 2]);
  });

  it('任务抛异常时 reject 传播且不阻塞后续任务', async () => {
    const started: string[] = [];

    const first = parseWithLimit(async () => {
      started.push('first');
      throw new Error('parse boom');
    }, 1);
    const second = parseWithLimit(async () => {
      started.push('second');
      return 'ok';
    }, 1);

    await expect(first).rejects.toThrow('parse boom');
    await expect(second).resolves.toBe('ok');
    expect(started).toEqual(['first', 'second']);
  });

  it('limit=1 时严格串行（一次只跑一个）', async () => {
    let active = 0;
    let peak = 0;
    const jobs = Array.from({ length: 4 }, (_, i) =>
      parseWithLimit(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await flush();
        active -= 1;
        return i;
      }, 1)
    );

    const results = await Promise.all(jobs);
    expect(results).toEqual([0, 1, 2, 3]);
    expect(peak).toBe(1);
  });

  it('默认并发上限为常量 PARSE_MAX_CONCURRENCY（≤3，不全量并发）', async () => {
    expect(PARSE_MAX_CONCURRENCY).toBeGreaterThan(0);
    expect(PARSE_MAX_CONCURRENCY).toBeLessThanOrEqual(3);

    let active = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const jobs = Array.from({ length: PARSE_MAX_CONCURRENCY + 3 }, () =>
      parseWithLimit(
        () =>
          new Promise<void>((resolve) => {
            active += 1;
            peak = Math.max(peak, active);
            release.push(() => {
              active -= 1;
              resolve();
            });
          })
      )
    );

    await flush();
    expect(active).toBe(PARSE_MAX_CONCURRENCY);

    while (release.length > 0) {
      release.shift()?.();
      await flush();
    }
    await Promise.all(jobs);
    expect(peak).toBe(PARSE_MAX_CONCURRENCY);
  });
});
