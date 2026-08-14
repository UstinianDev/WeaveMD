import { beforeEach, describe, expect, it, vi } from 'vitest';

const safeStorageMock = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(),
  encryptString: vi.fn(),
  decryptString: vi.fn(),
  getSelectedStorageBackend: vi.fn(),
}));

vi.mock('electron', () => ({
  safeStorage: safeStorageMock,
}));

import {
  decryptApiKey,
  encryptApiKey,
  isEncryptionAvailable,
} from '@main/ai/secureConfig';

describe('secureConfig', () => {
  beforeEach(() => {
    safeStorageMock.isEncryptionAvailable.mockReset();
    safeStorageMock.encryptString.mockReset();
    safeStorageMock.decryptString.mockReset();
    safeStorageMock.getSelectedStorageBackend.mockReset();
  });

  it('roundtrip encrypt -> decrypt returns original plaintext', () => {
    const plain = 'sk-secret-xyz';
    const encBuf = Buffer.from('encrypted-bytes');
    safeStorageMock.encryptString.mockReturnValue(encBuf);
    safeStorageMock.getSelectedStorageBackend.mockReturnValue('keychain');
    safeStorageMock.decryptString.mockReturnValue(plain);

    const { enc } = encryptApiKey(plain);
    expect(enc).toBe(encBuf.toString('base64'));

    const decrypted = decryptApiKey(enc);
    expect(decrypted).toBe(plain);
    expect(safeStorageMock.decryptString).toHaveBeenCalledWith(encBuf);
  });

  it('marks backend as ok when keychain backend is used', () => {
    safeStorageMock.encryptString.mockReturnValue(Buffer.from('x'));
    safeStorageMock.getSelectedStorageBackend.mockReturnValue('keychain');
    const result = encryptApiKey('plain');
    expect(result.backend).toBe('ok');
  });

  it('marks backend as basic_text when OS uses basic_text (Linux no keyring)', () => {
    safeStorageMock.encryptString.mockReturnValue(Buffer.from('x'));
    safeStorageMock.getSelectedStorageBackend.mockReturnValue('basic_text');
    const result = encryptApiKey('plain');
    expect(result.backend).toBe('basic_text');
  });

  it('encrypt empty string returns empty enc', () => {
    const result = encryptApiKey('');
    expect(result.enc).toBe('');
  });

  it('decrypt empty enc returns empty string', () => {
    expect(decryptApiKey('')).toBe('');
  });

  it('isEncryptionAvailable reflects safeStorage if encryption available resolves true', () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true);
    expect(isEncryptionAvailable()).toBe(true);
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false);
    expect(isEncryptionAvailable()).toBe(false);
  });

  it('isEncryptionAvailable is false when safeStorage throws (app not ready)', () => {
    safeStorageMock.isEncryptionAvailable.mockImplementation(() => {
      throw new Error('not ready');
    });
    expect(isEncryptionAvailable()).toBe(false);
  });
});
