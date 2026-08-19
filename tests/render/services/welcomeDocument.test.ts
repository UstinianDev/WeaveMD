// ============================================
// WeaveMD — 内置欢迎文档注入服务测试（TDD strict·先 RED）
// 判定唯一依据：树中无 welcome:// 节点即注入（不以 currentFile===null 触发）
// ============================================
import { beforeEach, describe, expect, it } from 'vitest';
import { markdownToState } from '@render/editor/kernel/markdownToState';
import { stateToMarkdown } from '@render/editor/kernel/stateToMarkdown';
import {
  WELCOME_ID,
  WELCOME_NAME,
  injectWelcomeDocument,
  isWelcomeFile,
  welcomeToIFile,
} from '@render/services/welcomeDocument';
import welcomeMd from '@render/assets/welcome.md?raw';
import { useEditorStore } from '@render/stores/editorStore';
import { resetFileTreeStore, useFileTreeStore } from '@render/stores/fileTreeStore';

function resetStores(): void {
  resetFileTreeStore();
  useEditorStore.setState({
    currentFile: null,
    content: '',
    isDirty: false,
    undoStack: [],
    redoStack: [],
  });
}

describe('welcomeDocument 内置欢迎文档', () => {
  beforeEach(() => {
    resetStores();
  });

  it('isWelcomeFile 按 welcome:// 前缀判定', () => {
    expect(isWelcomeFile(WELCOME_ID)).toBe(true);
    expect(isWelcomeFile('welcome://foo')).toBe(true);
    expect(isWelcomeFile('welcome://')).toBe(false);
    expect(isWelcomeFile('/disk/a.md')).toBe(false);
    expect(isWelcomeFile('file-1')).toBe(false);
  });

  it('WELCOME_ID / WELCOME_NAME 与资源内容匹配', () => {
    expect(WELCOME_ID).toBe('welcome://welcome.md');
    expect(WELCOME_NAME).toBe('欢迎文档.md');
    // welcome.md 可 ?raw 加载且非空，首行应为一级标题（可读性约束）
    expect(welcomeMd.length).toBeGreaterThan(100);
    expect(welcomeMd).toMatch(/^# /m);
  });

  it('welcomeToIFile 构建 welcome:// 的 IFile，content 为打包资源全文', () => {
    const file = welcomeToIFile();
    expect(file.id).toBe(WELCOME_ID);
    expect(file.name).toBe(WELCOME_NAME);
    expect(file.content).toBe(welcomeMd);
  });

  it('空态注入：加入 welcome:// 节点到 looseFiles 并打开为当前编辑文件', async () => {
    const injected = await injectWelcomeDocument();

    expect(injected).toBe(true);
    const files = useFileTreeStore.getState().looseFiles;
    expect(files).toHaveLength(1);
    expect(files[0].id).toBe(WELCOME_ID);
    // currentFile 已打开欢迎文档
    expect(useEditorStore.getState().currentFile?.id).toBe(WELCOME_ID);
  });

  it('非空态不注入：树中已有 welcome:// 节点则不重复注入', async () => {
    // 首次注入成功
    await injectWelcomeDocument();
    const before = useFileTreeStore.getState().looseFiles.length;

    // 再次调用（树中已有 welcome:// 节点）→ 不注入
    const injectedAgain = await injectWelcomeDocument();
    expect(injectedAgain).toBe(false);
    expect(useFileTreeStore.getState().looseFiles.length).toBe(before);
  });

  it('树中已有其他文件但无 welcome:// 时仍注入（判定唯一依据是无 welcome:// 节点）', async () => {
    // 用户已有自己的文件（persist 重启后树非空）
    useFileTreeStore.getState().addFile({
      id: '/disk/notes.md',
      name: 'notes.md',
      path: '/disk/notes.md',
    });
    useEditorStore.getState().openFile({
      id: '/disk/notes.md',
      userId: '',
      name: 'notes.md',
      content: 'hello',
      createdAt: '',
      modifiedAt: '',
      deletedAt: null,
    });

    const injected = await injectWelcomeDocument();

    expect(injected).toBe(true);
    // welcome 注入为第二个节点，且当前编辑文件保持用户自己的文件不被覆盖
    expect(useFileTreeStore.getState().looseFiles.map((f) => f.id)).toContain(WELCOME_ID);
    expect(useEditorStore.getState().currentFile?.id).toBe('/disk/notes.md');
  });

  it('welcome:// 节点不进入文件树持久化切片（重启后重新注入带完整内容）', async () => {
    await injectWelcomeDocument();
    // 触发 addFile → persist partialize 写盘
    const persistedRaw = localStorage.getItem('weavemd_filetree');
    expect(persistedRaw).not.toBeNull();
    const parsed = JSON.parse(persistedRaw as string);
    const looseIds = (parsed.state.looseFiles ?? []).map((f: { id: string }) => f.id);
    expect(looseIds).not.toContain(WELCOME_ID);
  });

  it('删除欢迎项后再次注入可重建（每次启动注入语义）', async () => {
    await injectWelcomeDocument();
    // 删除欢迎项（removeFile 链路）
    useFileTreeStore.getState().removeFile(WELCOME_ID);
    useEditorStore.getState().closeFile();

    const injected = await injectWelcomeDocument();
    expect(injected).toBe(true);
    expect(useFileTreeStore.getState().looseFiles.map((f) => f.id)).toContain(WELCOME_ID);
    expect(useEditorStore.getState().currentFile?.id).toBe(WELCOME_ID);
  });

  it('welcome.md 全文经 markdownToState / stateToMarkdown 往返收敛（回归 fixture）', () => {
    const tree = markdownToState(welcomeMd);
    const out = stateToMarkdown(tree);
    // markdownToState 归一化 CRLF→LF，故按 LF 比较
    expect(out).toBe(welcomeMd.replace(/\r\n/g, '\n'));
  });

  it('saveFile 对欢迎项短路：不调用 file.save / file.write', async () => {
    await injectWelcomeDocument();
    useEditorStore.getState().updateContent('edited welcome content');

    const saved = await useEditorStore.getState().saveFile();

    expect(saved).toBe(true);
    expect(window.weaveMD.file.save).not.toHaveBeenCalled();
    expect(window.weaveMD.file.write).not.toHaveBeenCalled();
  });
});
