// ============================================
// WeaveMD — useGlobalShortcuts
// ============================================
// 全局快捷键统一 hook（模块级单例 listener）。
// 合并 TopBar 与 EditorView 的 keydown 监听，
// 统一目标忽略判定，避免双 listener 重复触发。
//
// - Ctrl+F：查找替换（始终触发）
// - Ctrl+`：切换源代码模式（始终触发）
// - Ctrl+O：打开文件（TopBar 提供回调）
// - Ctrl+S：保存（TopBar 可提供带 saving 状态的回调）
// - Ctrl+Z：撤销（flush draft → undo）
// - Ctrl+Y / Ctrl+Shift+Z：重做（flush draft → redo）
// - input/textarea/select/contentEditable 内部忽略（Monaco / FindReplace 除外）

import { useEffect, useRef } from 'react';
import { useEditorStore } from '@render/stores/editorStore';
import { useUIStore } from '@render/stores/uiStore';
import {
  SEL_FIND_REPLACE_BAR,
  SEL_MONACO_EDITOR_ROOT,
  SEL_MONACO_HIDDEN_TEXTAREA,
} from '@render/utils/domSelectors';
import { flushEditorDraft } from './useDraftFlusher';

export interface UseGlobalShortcutsOptions {
  /** Ctrl+S 覆盖回调（TopBar 传入带 saving 状态的 handleSave） */
  onSave?: () => void;
  /** Ctrl+O 回调（仅 TopBar 提供） */
  onOpenFile?: () => void;
}

// ---- helpers ----

export type ShortcutAction = 'open-file' | 'undo' | 'redo' | 'save' | null;

const SHORTCUT_MAP: Record<string, ShortcutAction> = {
  o: 'open-file',
  z: 'undo',
  y: 'redo',
  s: 'save',
};

/**
 * 从键盘事件解析快捷键动作。
 * 保留导出仅用于测试——实际监听由 useGlobalShortcuts 单例接管。
 */
export function getShortcutAction(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): ShortcutAction {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) {
    return null;
  }

  const key = event.key.toLowerCase();
  // Ctrl/Cmd+Shift+Z = redo
  if (key === 'z' && event.shiftKey) {
    return 'redo';
  }
  return SHORTCUT_MAP[key] ?? null;
}

function isShortcutPassthroughTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.closest(SEL_MONACO_EDITOR_ROOT) !== null ||
    target.matches(SEL_MONACO_HIDDEN_TEXTAREA) ||
    target.closest(SEL_FIND_REPLACE_BAR) !== null
  );
}

export function shouldIgnoreGlobalShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  if (
    tagName !== 'input' &&
    tagName !== 'textarea' &&
    tagName !== 'select' &&
    !target.isContentEditable &&
    target.getAttribute('contenteditable') !== 'true'
  ) {
    return false;
  }
  // Monaco / FindReplace 内部允许快捷键穿透
  return !isShortcutPassthroughTarget(target);
}

// ---- 模块级单例 ----

let _refCount = 0;
const _optionsRef: { current: UseGlobalShortcutsOptions } = { current: {} };

/**
 * 全局快捷键 hook。
 *
 * 使用模块级单例 listener（ref 计数：仅首个调用注册 window.keydown，
 * 最后一个 unmount 移除），各组件通过 options 注册/反注册自己的回调。
 */
export function useGlobalShortcuts(options: UseGlobalShortcutsOptions = {}): void {
  const stableOptions = useRef(options);
  stableOptions.current = options;

  // 合并 options 到模块级 ref（增量合并：不清除其他组件提供的 key）
  useEffect(() => {
    const opts = stableOptions.current;
    for (const key of Object.keys(opts) as (keyof UseGlobalShortcutsOptions)[]) {
      if (opts[key] !== undefined) {
        (_optionsRef.current as Record<string, unknown>)[key] = opts[key];
      }
    }
    return () => {
      // 反注册：仅清除本实例提供的 key
      for (const key of Object.keys(opts) as (keyof UseGlobalShortcutsOptions)[]) {
        if (
          opts[key] !== undefined &&
          (_optionsRef.current as Record<string, unknown>)[key] === opts[key]
        ) {
          delete (_optionsRef.current as Record<string, unknown>)[key];
        }
      }
    };
  });

  // 单例 listener（ref 计数：防止多个 caller 独立 unmount 提前移除监听）
  useEffect(() => {
    _refCount++;
    if (_refCount > 1) {
      return () => { _refCount--; };
    }

    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl+F：查找替换（始终触发，不受目标忽略逻辑影响）
      if (ctrl && e.key === 'f') {
        e.preventDefault();
        useUIStore.getState().toggleFindReplace();
        return;
      }

      // Ctrl+`：切换源代码模式（始终触发）
      if (ctrl && e.key === '`') {
        e.preventDefault();
        useUIStore.getState().toggleSourceCodeMode();
        return;
      }

      // 目标过滤：避免在普通输入框内拦截用户输入
      if (shouldIgnoreGlobalShortcutTarget(e.target)) return;

      // Ctrl+O：打开文件
      if (ctrl && e.key === 'o') {
        e.preventDefault();
        _optionsRef.current.onOpenFile?.();
        return;
      }

      // Ctrl+S：保存
      if (ctrl && e.key === 's') {
        e.preventDefault();
        const onSave = _optionsRef.current.onSave;
        if (onSave) {
          onSave();
        } else {
          useEditorStore.getState().saveFile();
        }
        return;
      }

      // Ctrl+Z（无 Shift）：撤销
      // 统一 flush draft 确保 Monaco 防抖内容已同步（原 EditorView handler 未 flush，
      // 但 TopBar handler 已 flush；合并后统一 flush，避免 Source 模式 undo 过旧状态）
      if (ctrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        void flushEditorDraft().then(() => {
          useEditorStore.getState().undo();
        });
        return;
      }

      // Ctrl+Y 或 Ctrl+Shift+Z：重做
      // 同撤销——统一 flush 确保 draft 同步
      if ((ctrl && e.key === 'y') || (ctrl && e.shiftKey && e.key === 'z')) {
        e.preventDefault();
        void flushEditorDraft().then(() => {
          useEditorStore.getState().redo();
        });
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      _refCount--;
      if (_refCount === 0) {
        window.removeEventListener('keydown', handler);
      }
    };
  }, []);
}