// ============================================
// WeaveMD — Monaco Editor Local Setup
// Configures @monaco-editor/react to use local
// monaco-editor instead of loading from CDN.
// Must be imported BEFORE any Editor component mounts.
// ============================================

import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

// Tell @monaco-editor/react to use our local monaco-editor package
// instead of fetching from CDN (jsDelivr). This prevents the
// "Loading editor..." infinite spinner when CDN is unreachable.
loader.config({ monaco });

export { monaco };
