// ============================================
// WeaveMD — Crypto Utilities (Remember-Me)
// ============================================

const ENCRYPTION_KEY_PREFIX = 'weavemd_enc_';
const STORAGE_KEY = 'weavemd_remembered';

interface RememberedCredentials {
  username: string;
  password: string;
  expiresAt: number;
}

/**
 * Simple obfuscation for storing remember-me credentials.
 * NOTE: This is not cryptographically secure — for a local-only app,
 * we use base64 + simple XOR to avoid plaintext storage.
 * For production, consider using Electron's safeStorage API.
 */
function simpleEncode(text: string, key: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const keyData = encoder.encode(key);
  const encoded = new Uint8Array(data.length);

  for (let i = 0; i < data.length; i++) {
    encoded[i] = data[i] ^ keyData[i % keyData.length];
  }

  return btoa(String.fromCharCode(...encoded));
}

function simpleDecode(encoded: string, key: string): string {
  const data = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const keyData = new TextEncoder().encode(key);
  const decoded = new Uint8Array(data.length);

  for (let i = 0; i < data.length; i++) {
    decoded[i] = data[i] ^ keyData[i % keyData.length];
  }

  return new TextDecoder().decode(decoded);
}

function getEncryptionKey(): string {
  // Use a combination of navigator data as key seed
  const seed = navigator.language + navigator.platform + (navigator.hardwareConcurrency || 4);
  return ENCRYPTION_KEY_PREFIX + btoa(seed).slice(0, 16);
}

export function saveRememberedCredentials(username: string, password: string): void {
  const credentials: RememberedCredentials = {
    username,
    password,
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
  };

  const json = JSON.stringify(credentials);
  const key = getEncryptionKey();
  const encoded = simpleEncode(json, key);
  localStorage.setItem(STORAGE_KEY, encoded);
}

export function getRememberedCredentials(): RememberedCredentials | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const key = getEncryptionKey();
    const json = simpleDecode(stored, key);
    const credentials: RememberedCredentials = JSON.parse(json);

    // Check expiration
    if (Date.now() > credentials.expiresAt) {
      clearRememberedCredentials();
      return null;
    }

    return credentials;
  } catch {
    clearRememberedCredentials();
    return null;
  }
}

export function clearRememberedCredentials(): void {
  localStorage.removeItem(STORAGE_KEY);
}
