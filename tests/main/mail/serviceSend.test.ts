// ============================================
// WeaveMD — mail service.sendMail 测试（mock transport，RED → GREEN）
// 覆盖：成功（mailMessageId + attachments Buffer）、authorization 配置、
// 错误分类（535/EAUTH→auth_failed、network、timeout、554→send_failed）、
// transport 每次 send 后 close、图片校验非法前置拒绝。
// nodemailer 与 fs.stat/read 全部 mock，不触碰真实网络/磁盘。
// ============================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- nodemailer mock：收集 createTransport 配置 + sendMail 调用；可注入拒绝/抛错误态 ---
const nodemailerMock = vi.hoisted(() => {
  const transports: Array<{
    options: Record<string, unknown>;
    sendMailCalled: { msg: unknown }[];
    closed: number;
  }> = [];
  let sendMailImpl: (msg: unknown) => Promise<unknown>;
  return {
    transports,
    config: { sendMailImpl: (impl: (msg: unknown) => Promise<unknown>) => void (sendMailImpl = impl) },
    createTransport: vi.fn((options: Record<string, unknown>) => {
      const handle = {
        options,
        sendMailCalled: [] as { msg: unknown }[],
        closed: 0,
        close: () => {
          handle.closed += 1;
        },
        sendMail: (msg: unknown) => {
          handle.sendMailCalled.push({ msg });
          return sendMailImpl(msg);
        },
      };
      transports.push(handle);
      return handle;
    }),
    reset: () => {
      transports.length = 0;
      sendMailImpl = () => Promise.resolve({ messageId: '<id@qq.com>' });
    },
  };
});

// --- fs mock：statSync 返回可控 size；readFileSync 返回固定 Buffer ---
const fsMock = vi.hoisted(() => {
  let fileSizes: Record<string, number> = {};
  return {
    setSizes: (s: Record<string, number>): void => {
      fileSizes = s;
    },
    statSync: vi.fn((p: string) => {
      if (!(p in fileSizes)) throw new Error('ENOENT');
      return { size: fileSizes[p], isFile: () => true };
    }),
    readFileSync: vi.fn(() => Buffer.from('IMAGE-BYTES')),
    reset: () => {
      fileSizes = {};
    },
  };
});

vi.mock('nodemailer', () => ({ default: nodemailerMock, createTransport: nodemailerMock.createTransport }));
vi.mock('node:fs', () => ({ default: fsMock, statSync: fsMock.statSync, readFileSync: fsMock.readFileSync }));
vi.mock('fs', () => ({ default: fsMock, statSync: fsMock.statSync, readFileSync: fsMock.readFileSync }));

import { sendMail, type MailErrorCode } from '@main/mail/service';

const SAMPLE_BODY = '我在使用过程中遇到一个问题...';

async function expectErrorCode(promise: Promise<{ success: boolean; error?: { code: string } }>, code: MailErrorCode) {
  const res = await promise;
  expect(res.success).toBe(false);
  expect(res.error?.code).toBe(code);
}

/** 断言 sendMail 返回的失败错误码（对联合类型做窄化 cast） */
function errorCodeOf(res: { success: boolean; error?: { code: string } }): string | undefined {
  return res.error?.code;
}

beforeEach(() => {
  nodemailerMock.reset();
  fsMock.reset();
});

describe('sendMail — 成功与 transport 生命周期', () => {
  it('成功：transport 用 smtp.qq.com:465 + auth.user 目标邮箱 + secure；sendMail 收到 subject/attachments', async () => {
    fsMock.setSizes({ 'C:/a.png': 1024 });
    nodemailerMock.config.sendMailImpl(() => Promise.resolve({ messageId: '<msg@qq.com>' }));

    const res = await sendMail({
      authCode: 'auth-16-char-code',
      body: SAMPLE_BODY,
      imagePaths: ['C:/a.png'],
    });

    expect(res.success).toBe(true);
    if (res.success) expect(res.messageId).toBe('<msg@qq.com>');

    const t = nodemailerMock.transports[0];
    expect(t.options.host).toBe('smtp.qq.com');
    expect(t.options.port).toBe(465);
    expect(t.options.secure).toBe(true);
    const auth = t.options.auth as { user: string; pass: string };
    expect(auth.user).toBe('2762943351@qq.com');
    expect(auth.pass).toBe('auth-16-char-code');

    const msg = t.sendMailCalled[0].msg as {
      from: string;
      to: string;
      subject: string;
      text: string;
      attachments: Array<{ filename: string; content: Buffer }>;
    };
    expect(msg.from).toBe('2762943351@qq.com');
    expect(msg.to).toBe('2762943351@qq.com');
    expect(msg.subject).toMatch(/^\[WeaveMD 问题反馈\]/);
    expect(msg.text).toBe(SAMPLE_BODY);
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].content).toBeInstanceOf(Buffer);
    // transport 用完即关，防授权码常驻
    expect(t.closed).toBe(1);
  });

  it('成功：无图时 attachments 为空数组', async () => {
    nodemailerMock.config.sendMailImpl(() => Promise.resolve({ messageId: '<id>' }));
    const res = await sendMail({ authCode: 'code', body: 'x', imagePaths: [] });
    expect(res.success).toBe(true);
    const msg = nodemailerMock.transports[0].sendMailCalled[0].msg as { attachments: unknown[] };
    expect(msg.attachments).toEqual([]);
  });
});

describe('sendMail — 错误分类（不外透原始 SMTP error）', () => {
  it('sendMail 抛 EAUTH/535 → auth_failed', async () => {
    fsMock.setSizes({ 'C:/a.png': 10 });
    nodemailerMock.config.sendMailImpl(() => {
      const err = new Error('Invalid login: 535 Authentication failed') as Error & { code?: string; responseCode?: number };
      err.code = 'EAUTH';
      err.responseCode = 535;
      return Promise.reject(err);
    });
    await expectErrorCode(
      sendMail({ authCode: 'bad', body: 'x', imagePaths: ['C:/a.png'] }),
      'auth_failed'
    );
  });

  it('ECONNREFUSED/ENOTFOUND → network', async () => {
    nodemailerMock.config.sendMailImpl(() => Promise.reject(Object.assign(new Error('conn'), { code: 'ECONNREFUSED' })));
    await expectErrorCode(sendMail({ authCode: 'c', body: 'x', imagePaths: [] }), 'network');
  });

  it('ETIMEDOUT → timeout', async () => {
    nodemailerMock.config.sendMailImpl(() => Promise.reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    await expectErrorCode(sendMail({ authCode: 'c', body: 'x', imagePaths: [] }), 'timeout');
  });

  it('SMTP 554 拒绝 → send_failed', async () => {
    nodemailerMock.config.sendMailImpl(() => Promise.reject(Object.assign(new Error('Mail refused'), { responseCode: 554 })));
    await expectErrorCode(sendMail({ authCode: 'c', body: 'x', imagePaths: [] }), 'send_failed');
  });

  it('未知错误默认 → send_failed，且不泄露原始 error 文本', async () => {
    nodemailerMock.config.sendMailImpl(() => Promise.reject(new Error('SMTP internal secret stack')));
    const res = await sendMail({ authCode: 'c', body: 'x', imagePaths: [] });
    expect(res.success).toBe(false);
    // 原始 error message 不外透到渲染
    const msg = (res as {success:boolean;error?:{message?:string}}).error?.message; expect(msg).not.toContain('SMTP internal secret stack');
  });
});

describe('sendMail — 图片校验前置（权威）', () => {
  it('单图超过大小上限 → invalid_image，不 sendMail', async () => {
    fsMock.setSizes({ 'C:/big.png': 11 * 1024 * 1024 });
    const res = await sendMail({ authCode: 'c', body: 'x', imagePaths: ['C:/big.png'] });
    expect(res.success).toBe(false);
    expect(errorCodeOf(res as {success:boolean;error?:{code:string}})).toBe('invalid_image');
    expect(nodemailerMock.transports).toHaveLength(0);
  });

  it('文件缺失（statSync 抛错）→ invalid_image，不 sendMail', async () => {
    const res = await sendMail({ authCode: 'c', body: 'x', imagePaths: ['C:/ghost.png'] });
    expect(res.success).toBe(false);
    expect(errorCodeOf(res as {success:boolean;error?:{code:string}})).toBe('invalid_image');
    expect(nodemailerMock.transports).toHaveLength(0);
  });
});
