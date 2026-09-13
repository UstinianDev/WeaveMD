// ============================================
// WeaveMD — useMonacoTheme
// ============================================
// 异步加载 monaco-editor 并注册 WeaveMD 自定义主题。
// 返回 `themesLoading` 状态，在加载期间显示 loading spinner。

import { useEffect, useRef, useState } from 'react';
import { defineWeaveThemes } from '@render/utils/monacoSetup';

/**
 * Monaco 主题懒加载 hook。
 *
 * 首次调用时动态 import monaco-editor→ defineWeaveThemes 注册主题。
 * 后续调用（themesDefinedRef 已标记）直接跳过。
 */
export function useMonacoTheme(): { themesLoading: boolean } {
  const themesDefinedRef = useRef(false);
  const [themesLoading, setThemesLoading] = useState(true);

  useEffect(() => {
    if (themesDefinedRef.current) {
      setThemesLoading(false);
      return;
    }

    import('monaco-editor')
      .then((monaco) => {
        defineWeaveThemes(monaco.editor);
        themesDefinedRef.current = true;
        setThemesLoading(false);
      })
      .catch((err) => {
        console.error('Failed to define Monaco themes:', err);
        setThemesLoading(false);
      });
  }, []);

  return { themesLoading };
}