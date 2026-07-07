import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureWeaveMDApi } from '../../src/render/utils/weaveMDBridge';

describe('weaveMDBridge', () => {
  const originalBridge = window.weaveMD;
  let warnSpy: ReturnType<typeof vi.spyOn>;

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

  it('keeps the injected preload bridge when it already exists', () => {
    window.weaveMD = originalBridge;

    const bridge = ensureWeaveMDApi();

    expect(bridge).toBe(originalBridge);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
