// ============================================
// WeaveMD — Icon 图标清单全表 + 视觉回归断言（doc-pipeline B10 七-1）
// 红线：react-icons 打包治理不得让任何现有图标消失或变样——
// 任何 ICON_MAP 增删改必须同步下方 ICON_INVENTORY 清单，否则本测试失败。
// ============================================
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import * as MdIcons from 'react-icons/md';

import Icon, { ICON_MAP } from '@render/components/Common/Icon';

/**
 * name → react-icons/md 导出名全表（Icon.tsx ICON_MAP 基线清单，共 132 项）。
 * 本表即"图标清单全表"交付物：与 ICON_MAP 双向对账 + 逐项组件身份比对。
 */
const ICON_INVENTORY: Record<string, string> = {
  'close': 'MdClose',
  'check': 'MdCheck',
  'copy': 'MdContentCopy',
  'edit': 'MdEdit',
  'refresh': 'MdRefresh',
  'delete': 'MdDeleteOutline',
  'search': 'MdSearch',
  'chevron-right': 'MdChevronRight',
  'chevron-left': 'MdChevronLeft',
  'add': 'MdAdd',
  'remove': 'MdRemove',
  'settings': 'MdSettings',
  'arrow-down': 'MdKeyboardArrowDown',
  'arrow-up': 'MdKeyboardArrowUp',
  'file-upload': 'MdFileUpload',
  'image': 'MdImage',
  'attach': 'MdOutlineAttachFile',
  'photo': 'MdOutlinePhotoCamera',
  'link': 'MdLink',
  'web': 'MdWeb',
  'folder': 'MdFolderOpen',
  'folder-open': 'MdFolderOpen',
  'folder-outline': 'MdOutlineFolder',
  'folder-new': 'MdOutlineCreateNewFolder',
  'folder-move': 'MdOutlineDriveFileMove',
  'file': 'MdInsertDriveFile',
  'file-outline': 'MdOutlineFilePresent',
  'file-open': 'MdOutlineFileOpen',
  'file-copy': 'MdOutlineFileCopy',
  'file-edit': 'MdOutlineEditNote',
  'file-note': 'MdDescription',
  'file-add': 'MdNoteAdd',
  'file-sync': 'MdOutlineSync',
  'lightning': 'MdOutlineElectricBolt',
  'question': 'MdOutlineQuestionMark',
  'warning': 'MdOutlineWarning',
  'error': 'MdOutlineError',
  'check-circle': 'MdOutlineCheckCircle',
  'cancel': 'MdOutlineCancel',
  'schedule': 'MdOutlineSchedule',
  'pending': 'MdOutlinePending',
  'done': 'MdOutlineDone',
  'close-circle': 'MdOutlineClose',
  'rocket': 'MdOutlineRocket',
  'info': 'MdOutlineInfo',
  'lock': 'MdOutlineLock',
  'chat': 'MdOutlineChat',
  'robot': 'MdOutlineSmartToy',
  'memory': 'MdOutlineMemory',
  'psychology': 'MdOutlinePsychology',
  'build': 'MdOutlineBuild',
  'code': 'MdOutlineCode',
  'data': 'MdOutlineDataObject',
  'auto-mode': 'MdOutlineAutoMode',
  'auto-fix': 'MdOutlineAutoFixHigh',
  'compare': 'MdOutlineCompareArrows',
  'source': 'MdOutlineSource',
  'playlist-add': 'MdOutlinePlaylistAdd',
  'paste': 'MdOutlineContentPaste',
  'globe': 'MdPublic',
  'delete-sweep': 'MdOutlineDeleteSweep',
  'arrow-back': 'MdOutlineArrowBack',
  'note-add': 'MdOutlineNoteAdd',
  'science': 'MdOutlineScience',
  'bolt': 'MdFlashOn',
  'visibility': 'MdOutlineVisibility',
  'visibility-off': 'MdOutlineVisibilityOff',
  'star': 'MdOutlineStar',
  'star-border': 'MdOutlineStarBorder',
  'bookmark': 'MdBookmark',
  'bookmark-border': 'MdBookmarkBorder',
  'pin': 'MdOutlinePushPin',
  'more-vert': 'MdMoreVert',
  'more-horiz': 'MdMoreHoriz',
  'arrow-drop-down': 'MdArrowDropDown',
  'sort': 'MdOutlineSort',
  'filter': 'MdFilterList',
  'calendar': 'MdOutlineCalendarToday',
  'time': 'MdOutlineAccessTime',
  'loop': 'MdOutlineLoop',
  'stop': 'MdOutlineStop',
  'play': 'MdOutlinePlayArrow',
  'pause': 'MdOutlinePause',
  'skip-next': 'MdOutlineSkipNext',
  'fast-forward': 'MdOutlineFastForward',
  'rewind': 'MdFastRewind',
  'volume': 'MdOutlineVolumeUp',
  'volume-off': 'MdOutlineVolumeOff',
  'fullscreen': 'MdOutlineFullscreen',
  'fullscreen-exit': 'MdOutlineFullscreenExit',
  'zoom-in': 'MdOutlineZoomIn',
  'zoom-out': 'MdOutlineZoomOut',
  'fit-screen': 'MdOutlineFitScreen',
  'aspect-ratio': 'MdOutlineAspectRatio',
  'crop': 'MdOutlineCrop',
  'transform': 'MdOutlineTransform',
  'rotate': 'MdOutlineRotateRight',
  'flip': 'MdOutlineFlip',
  'tune': 'MdOutlineTune',
  'palette': 'MdOutlinePalette',
  'brush': 'MdOutlineBrush',
  'paint': 'MdOutlineFormatPaint',
  'color-lens': 'MdOutlineColorLens',
  'gradient': 'MdOutlineGradient',
  'texture': 'MdOutlineTexture',
  'blur': 'MdOutlineBlurOn',
  'flare': 'MdOutlineFlare',
  'sunny': 'MdOutlineWbSunny',
  'night': 'MdOutlineNightlight',
  'contrast': 'MdOutlineContrast',
  'opacity': 'MdOutlineOpacity',
  'invert': 'MdOutlineInvertColors',
  'tonality': 'MdOutlineTonality',
  'exposure': 'MdOutlineExposure',
  'bold': 'MdFormatBold',
  'italic': 'MdFormatItalic',
  'underline': 'MdFormatUnderlined',
  'strikethrough': 'MdFormatStrikethrough',
  'code-inline': 'MdCode',
  'highlight': 'MdOutlineHighlight',
  'link-insert': 'MdInsertLink',
  'image-insert': 'MdOutlineImage',
  'math': 'MdOutlineFunctions',
  'table': 'MdOutlineGridOn',
  'unlink': 'MdLinkOff',
  'eraser': 'MdOutlineAutoFixNormal',
  'image-edit': 'MdEdit',
  'image-inline': 'MdOutlineImage',
  'align-left': 'MdOutlineFormatAlignLeft',
  'align-center': 'MdOutlineFormatAlignCenter',
  'align-right': 'MdOutlineFormatAlignRight',
  'image-remove': 'MdDeleteOutline',
};

describe('Icon 图标清单全表（B10 七-1 红线）', () => {
  afterEach(() => {
    cleanup();
  });

  it('ICON_MAP 键集合与清单全表完全一致（无图标消失/凭空新增）', () => {
    expect(Object.keys(ICON_MAP).sort()).toEqual(Object.keys(ICON_INVENTORY).sort());
  });

  it('每个 name 映射到清单指定的同一组件（无图标变样）', () => {
    for (const [name, exportName] of Object.entries(ICON_INVENTORY)) {
      const expected = MdIcons[exportName as keyof typeof MdIcons];
      expect(expected, `清单项 ${name} 的导出 ${exportName} 应存在`).toBeTruthy();
      expect(ICON_MAP[name], `icon "${name}" 应映射到 ${exportName}`).toBe(expected);
    }
  });

  it('清单中每个图标渲染为非空 SVG（视觉回归断言）', () => {
    for (const name of Object.keys(ICON_INVENTORY)) {
      const { container } = render(<Icon icon={name} size={16} />);
      const svg = container.querySelector('svg');
      expect(svg, `icon "${name}" 应渲染 <svg>`).not.toBeNull();
      expect(svg?.innerHTML.length ?? 0, `icon "${name}" 的 svg 内容非空`).toBeGreaterThan(0);
      cleanup();
    }
  });

  it('未知图标名降级渲染首字母（既有降级行为不回归）', () => {
    const { container } = render(<Icon icon="not-exist-icon" size={16} />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toBe('N');
  });
});
