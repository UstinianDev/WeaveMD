// ============================================
// WeaveMD Editor v2 — useContentSync
// ============================================
// 内容同步：
// - lastSyncedContentRef 记录最近一次已同步内容，避免外部内容 effect 反复重建树
// - 外部内容变化（打开文件 / 撤销 / 源码模式切换 / 查找替换）→ 重建树
// - syncContent 将模型 markdown 回调给宿主并更新同步标记

import type { RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';

import type { EditorInstance } from '../../../editor/editorInstance';
import type { BlockTreeV2 } from '../../../editor/kernel';

interface ContentSyncOptions {
  content: string;
  onContentChange: (content: string) => void;
  instanceRef: RefObject<EditorInstance | null>;
  setTree: React.Dispatch<React.SetStateAction<BlockTreeV2>>;
}

export interface ContentSyncResult {
  syncContent: () => void;
}

export function useContentSync({
  content,
  onContentChange,
  instanceRef,
  setTree,
}: ContentSyncOptions): ContentSyncResult {
  const lastSyncedContentRef = useRef(content);

  // 外部内容变化（打开文件 / 撤销 / 源码模式切换 / 查找替换）→ 重建树
  useEffect(() => {
    if (content === lastSyncedContentRef.current) return;
    lastSyncedContentRef.current = content;
    instanceRef.current?.setContent(content);
    setTree(instanceRef.current!.tree);
  }, [content]);

  const syncContent = useCallback(() => {
    const markdown = instanceRef.current?.getMarkdown() ?? '';
    lastSyncedContentRef.current = markdown;
    onContentChange(markdown);
  }, [onContentChange]);

  return { syncContent };
}
