import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { DOCUMENT_PARSE_VERSION } from '@shared/ai';
import { ensureWeaveMDApi } from '@render/utils/weaveMDBridge';

describe('weaveMDBridge', () => {
  const originalBridge = window.weaveMD;
  let warnSpy: MockInstance;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.localStorage.clear();
    window.weaveMD = undefined as unknown as typeof window.weaveMD;
  });

  afterEach(() => {
    window.weaveMD = originalBridge;
    warnSpy.mockRestore();
  });

  it('installs an interactive browser mock when preload is unavailable', async () => {
    const bridge = ensureWeaveMDApi();

    expect(window.weaveMD).toBe(bridge);
    await expect(bridge.window.isMaximized()).resolves.toBe(false);
    await expect(bridge.window.minimize()).resolves.toBeUndefined();

    await expect(bridge.auth.checkUsername('previewUser')).resolves.toMatchObject({
      available: true,
    });

    const registerResult = (await bridge.auth.register('previewUser', 'PreviewPass123')) as {
      success: boolean;
    };
    expect(registerResult.success).toBe(true);

    const loginResult = (await bridge.auth.login('previewUser', 'PreviewPass123', false)) as {
      success: boolean;
      data?: {
        token: string;
        user: {
          id: string;
          username: string;
        };
      };
    };
    expect(loginResult.success).toBe(true);
    expect(loginResult.data?.user.username).toBe('previewUser');

    const validateResult = (await bridge.auth.validateToken(loginResult.data?.token ?? '')) as {
      success: boolean;
      data?: {
        id: string;
        username: string;
      };
    };
    expect(validateResult.success).toBe(true);
    expect(validateResult.data?.username).toBe('previewUser');

    const createdFile = (await bridge.file.create(
      loginResult.data?.user.id ?? '',
      'preview.md'
    )) as {
      success: boolean;
      data?: {
        id: string;
      };
    };
    expect(createdFile.success).toBe(true);

    const saveResult = (await bridge.file.save(
      createdFile.data?.id ?? '',
      '# Preview\n\nSaved from browser mock',
      loginResult.data?.user.id ?? ''
    )) as {
      success: boolean;
      data?: {
        content: string;
      };
    };
    expect(saveResult.success).toBe(true);
    expect(saveResult.data?.content).toContain('Saved from browser mock');

    const listResult = (await bridge.file.list(loginResult.data?.user.id ?? '')) as {
      success: boolean;
      data?: Array<{ name: string }>;
    };
    expect(listResult.success).toBe(true);
    expect(listResult.data?.map((file) => file.name)).toEqual(
      expect.arrayContaining(['preview.md', 'welcome.md'])
    );

    const historyResult = (await bridge.history.list(createdFile.data?.id ?? '')) as {
      success: boolean;
      data?: Array<{ version: number }>;
    };
    expect(historyResult.success).toBe(true);
    expect(historyResult.data?.length).toBeGreaterThanOrEqual(2);
    expect(historyResult.data?.[0]?.version).toBeGreaterThanOrEqual(1);

    const settingsResult = (await bridge.settings.update(loginResult.data?.user.id ?? '', {
      theme: 'dark',
      language: 'en',
    })) as {
      success: boolean;
      data?: {
        theme: string;
        language: string;
      };
    };
    expect(settingsResult.success).toBe(true);
    expect(settingsResult.data).toMatchObject({
      theme: 'dark',
      language: 'en',
    });

    const accountInfo = (await bridge.account.info(loginResult.data?.user.id ?? '')) as {
      success: boolean;
      data?: {
        fileCount: number;
      };
    };
    expect(accountInfo.success).toBe(true);
    expect(accountInfo.data?.fileCount).toBeGreaterThanOrEqual(2);

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('kb.parseDocument 浏览器 mock 返回结构化受控产物（B1）', async () => {
    const bridge = ensureWeaveMDApi();

    const ok = (await bridge.kb.parseDocument('/mock/report.xlsx', 'report.xlsx')) as {
      success: boolean;
      data?: {
        text: string;
        fileName: string;
        fileType: string;
        headings: unknown[];
        sections: unknown[];
        tables: unknown[];
        images: unknown[];
        parseVersion: number;
      };
    };
    expect(ok.success).toBe(true);
    expect(ok.data?.fileName).toBe('report.xlsx');
    expect(ok.data?.fileType).toBe('xlsx');
    expect(ok.data?.parseVersion).toBe(DOCUMENT_PARSE_VERSION);
    expect(Array.isArray(ok.data?.headings)).toBe(true);
    expect(Array.isArray(ok.data?.sections)).toBe(true);
    expect(Array.isArray(ok.data?.tables)).toBe(true);
    expect(Array.isArray(ok.data?.images)).toBe(true);

    const bad = (await bridge.kb.parseDocument('/mock/img.png', 'img.png')) as {
      success: boolean;
      message?: string;
    };
    expect(bad.success).toBe(false);
    expect(bad.message).toContain('Unsupported');
  });

  it('keeps the injected preload bridge when it already exists', () => {
    window.weaveMD = originalBridge;

    const bridge = ensureWeaveMDApi();

    expect(bridge).toBe(originalBridge);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // ============================================
  // B2 一-1②：openFile mock 契约同步（7 格式 accept + multiple + 只返回 paths）
  // ============================================
  it('dialog.openFile mock：accept 放开 7 格式、multiple 多选、返回路径数组保序（B2）', async () => {
    const bridge = ensureWeaveMDApi();
    const originalCreate = document.createElement.bind(document);
    const capturedInputs: HTMLInputElement[] = [];
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation(((tag: string) => {
        const el = originalCreate(tag);
        if (tag === 'input') capturedInputs.push(el as HTMLInputElement);
        return el;
      }) as typeof document.createElement);

    try {
      const pending = bridge.dialog.openFile();
      expect(capturedInputs.length).toBe(1);
      const input = capturedInputs[0];
      // 7 格式白名单 accept + 支持多选
      for (const ext of ['.pdf', '.doc', '.docx', '.txt', '.md', '.xls', '.xlsx']) {
        expect(input.accept).toContain(ext);
      }
      expect(input.multiple).toBe(true);

      // 用户多选（保持选择顺序）
      const f1 = new File(['# b'], 'b.md', { type: 'text/markdown' });
      const f2 = new File(['x'], 'a.pdf', { type: 'application/pdf' });
      Object.defineProperty(input, 'files', { value: [f1, f2], configurable: true });
      input.dispatchEvent(new Event('change'));

      const result = (await pending) as { success: boolean; data?: { paths: string[] } };
      expect(result.success).toBe(true);
      expect(result.data?.paths).toEqual(['b.md', 'a.pdf']);
      // 不再返回全文（内容由解析层接管）
      expect(result.data).not.toHaveProperty('content');
    } finally {
      createSpy.mockRestore();
    }
  });

  // ============================================
  // B2 一-1②：pickImage mock 恒 null → 受控返回（避免 E2E 假通过）
  // ============================================
  it('dialog.pickImage mock 返回受控图片路径而非恒 null（B2）', async () => {
    const bridge = ensureWeaveMDApi();

    const path = await bridge.dialog.pickImage();

    expect(path).not.toBeNull();
    expect(typeof path).toBe('string');
    expect(path).toMatch(/\.png$/);
  });

  // ============================================
  // 双入口回归锁定：file.open（编辑器）与 dialog.openFile（上传）共享 readBrowser*
  // 契约源但行为不同 —— file.open 保持 md 单文件 + 全文
  // ============================================
  it('file.open mock 保持单文件 + 全文契约（编辑器入口不受 B2 上传契约影响）', async () => {
    const bridge = ensureWeaveMDApi();
    const originalCreate = document.createElement.bind(document);
    const capturedInputs: HTMLInputElement[] = [];
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation(((tag: string) => {
        const el = originalCreate(tag);
        if (tag === 'input') capturedInputs.push(el as HTMLInputElement);
        return el;
      }) as typeof document.createElement);

    try {
      const pending = bridge.file.open();
      expect(capturedInputs.length).toBe(1);
      const input = capturedInputs[0];
      // 编辑器入口：md 限定 + 不多选
      expect(input.accept).toContain('.md');
      expect(input.accept).not.toContain('.pdf');
      expect(input.multiple).toBe(false);

      const file = new File(['# from disk'], 'disk.md', { type: 'text/markdown' });
      // jsdom 24 的 File 无 .text()（浏览器/Electron 有），测试内注入
      Object.defineProperty(file, 'text', {
        value: async () => '# from disk',
        configurable: true,
      });
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change'));

      const result = (await pending) as {
        success: boolean;
        data?: { path: string; name: string; content: string; paths?: string[] };
      };
      expect(result.success).toBe(true);
      expect(result.data?.path).toBe('disk.md');
      expect(result.data?.name).toBe('disk.md');
      expect(result.data?.content).toBe('# from disk');
      expect(result.data).not.toHaveProperty('paths');
    } finally {
      createSpy.mockRestore();
    }
  });
});
