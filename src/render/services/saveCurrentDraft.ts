// ============================================
// WeaveMD — Save Current Draft Helper
// ============================================
// 切换/关闭/导出文件前的统一保存前置：
// 1. flushEditorDraft —— Source（Monaco）模式强制同步 150ms 防抖窗口内的内容；
//    Normal（块）模式每 keystroke 已同步 store，flusher 为 no-op。
// 2. 若当前文件 dirty，则 saveFile 落盘。
// 供 FileTreePanel（文件树切换）与 useNavbarActions（打开/删除/关闭）复用，
// 避免文件树路径跳过保存导致未保存修改丢失。

import { useEditorStore } from '@render/stores/editorStore';
import { useUIStore } from '@render/stores/uiStore';

/** 保存当前 dirty 草稿。返回：无内容可保存时 true；有保存需求且保存成功 true；保存失败 false。 */
export async function saveCurrentDraftIfNeeded(): Promise<boolean> {
  await useUIStore.getState().flushEditorDraft();
  const { currentFile, isDirty } = useEditorStore.getState();
  if (currentFile?.id && isDirty) {
    return await useEditorStore.getState().saveFile();
  }
  return true;
}
