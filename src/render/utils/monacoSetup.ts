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

// ============================================
// WeaveMD 双主题（Source Code Mode），配置表表达
// ============================================

const WEAVE_THEMES: Array<{
  name: string;
  data: monaco.editor.IStandaloneThemeData;
}> = [
  {
    name: 'weaveMD-dark',
    data: {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
        { token: 'keyword', foreground: '569CD6' },
        { token: 'string', foreground: 'CE9178' },
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'type', foreground: '4EC9B0' },
        { token: 'function', foreground: '#DCDCAA' },
        { token: 'variable', foreground: '#9CDCFE' },
        { token: 'heading', foreground: '#7C3AED', fontStyle: 'bold' },
        { token: 'emphasis', fontStyle: 'italic' },
        { token: 'strong', fontStyle: 'bold' },
      ],
      colors: {
        'editor.background': '#e5e5e5',
        'editor.foreground': '#1a1a1a',
        'editor.lineHighlightBackground': '#d5d5d5',
        'editor.selectionBackground': '#7C3AED40',
        'editorCursor.foreground': '#7C3AED',
        'editorLineNumber.foreground': '#999999',
        'editorLineNumber.activeForeground': '#1a1a1a',
        'editor.selectionHighlightBackground': '#7C3AED20',
        'editor.inactiveSelectionBackground': '#7C3AED20',
        'editorWidget.background': '#d5d5d5',
        'editorWidget.border': '#c0c0c0',
        'input.background': '#e5e5e5',
        'input.border': '#c0c0c0',
        'input.foreground': '#1a1a1a',
        'editorGutter.background': '#e5e5e5',
      },
    },
  },
  {
    name: 'weaveMD-light',
    data: {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
        { token: 'keyword', foreground: '0000FF' },
        { token: 'string', foreground: 'A31515' },
        { token: 'number', foreground: '098658' },
        { token: 'type', foreground: '267F99' },
        { token: 'function', foreground: '#795E26' },
        { token: 'variable', foreground: '#001080' },
        { token: 'heading', foreground: '#7C3AED', fontStyle: 'bold' },
        { token: 'emphasis', fontStyle: 'italic' },
        { token: 'strong', fontStyle: 'bold' },
      ],
      colors: {
        'editor.background': '#FFFFFF',
        'editor.foreground': '#111827',
        'editor.lineHighlightBackground': '#F3F4F6',
        'editor.selectionBackground': '#7C3AED20',
        'editorCursor.foreground': '#7C3AED',
        'editorLineNumber.foreground': '#9CA3AF',
        'editorLineNumber.activeForeground': '#111827',
        'editor.selectionHighlightBackground': '#7C3AED10',
        'editor.inactiveSelectionBackground': '#7C3AED10',
        'editorWidget.background': '#FFFFFF',
        'editorWidget.border': '#E5E7EB',
        'input.background': '#F9FAFB',
        'input.border': '#E5E7EB',
        'input.foreground': '#111827',
        'editorGutter.background': '#FFFFFF',
      },
    },
  },
];

/** 注册 WeaveMD 双主题（重复调用安全：Monaco 同名 defineTheme 覆盖） */
export function defineWeaveThemes(editor: typeof monaco.editor): void {
  for (const theme of WEAVE_THEMES) {
    editor.defineTheme(theme.name, theme.data);
  }
}

export { monaco };
