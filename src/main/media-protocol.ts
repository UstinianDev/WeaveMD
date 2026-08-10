// ============================================
// WeaveMD — media:// custom protocol
// ============================================
// Maps media://<encoded-win-absolute-path>/<encoded-unc> to local files so the
// renderer can display local images without relying on cross-scheme file://
// loading (which Chromium webSecurity + CSP block on http dev pages).
//
// Contract (docs/plan/editor-link-image-fix.plan.md):
//   Renderer generates: `media://` + encodeURIComponent(forward-slash-normalized path)
//     - drive: media://C%3A/Users/me/a.png
//     - UNC:   media://%2F%2Fserver%2Fshare%2Fa.png
//   Handler parses: strip prefix -> decodeURIComponent once -> validate
//   Windows absolute (drive `^[a-zA-Z]:/`) or UNC (`^//`) -> net.fetch(pathToFileURL)
//   -> file stream; invalid/missing -> 404. No double-encoding; no file:// scheme.

import { app, net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';

const MEDIA_PREFIX = 'media://';

/**
 * Decode a media:// URL back into its original (backslash-form) Windows path.
 * Returns null when the URL is not a valid media absolute path.
 * Pure function — unit-testable without an Electron runtime.
 */
export function decodeMediaUrl(url: string): string | null {
  if (!url.startsWith(MEDIA_PREFIX)) return null;

  const encoded = url.slice(MEDIA_PREFIX.length);
  if (!encoded) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    // malformed percent-encoding -> invalid
    return null;
  }

  // Normalize backslashes to forward slashes for path prefix validation.
  const normalized = decoded.replace(/\\/g, '/');

  // Valid only for a Windows absolute drive path or a UNC path.
  if (!/^[a-zA-Z]:\//.test(normalized) && !/^\/\//.test(normalized)) {
    return null;
  }

  // Return the original decoded path in native Windows backslash form.
  return normalized.replace(/\//g, '\\');
}

/**
 * Register the media:// protocol handler. Must be called after app.whenReady().
 * scheme privileges (standard/secure/supportFetchAPI/stream) are registered
 * before app ready in src/main/index.ts via protocol.registerSchemesAsPrivileged.
 */
export function registerMediaProtocol(): void {
  if (!app.isReady()) {
    throw new Error('registerMediaProtocol must be called after app is ready');
  }

  protocol.handle('media', async (request) => {
    const filePath = decodeMediaUrl(request.url);
    if (!filePath) {
      return new Response('Not Found', { status: 404 });
    }

    try {
      return await net.fetch(pathToFileURL(filePath).toString(), {
        bypassCustomProtocolHandlers: true,
        method: 'GET',
      });
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  });
}
