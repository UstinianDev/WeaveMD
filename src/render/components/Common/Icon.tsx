// ============================================
// WeaveMD — 共享 Icon 组件（react-icons mdi 封装）
// ============================================
// 统一图标接口，基于 react-icons/md（Material Design Icons）。
// 所有 AI 面板组件通过此组件引用图标，避免 emoji 和 CDN 依赖。

import React from 'react';
import {
  MdClose,
  MdCheck,
  MdContentCopy,
  MdEdit,
  MdRefresh,
  MdDeleteOutline,
  MdSearch,
  MdChevronRight,
  MdChevronLeft,
  MdAdd,
  MdRemove,
  MdSettings,
  MdKeyboardArrowDown,
  MdKeyboardArrowUp,
  MdFileUpload,
  MdImage,
  MdLink,
  MdWeb,
  MdFolderOpen,
  MdInsertDriveFile,
  MdDescription,
  MdFlashOn,
  MdOutlineQuestionMark,
  MdOutlineWarning,
  MdOutlineError,
  MdOutlineCheckCircle,
  MdOutlineCancel,
  MdOutlineSchedule,
  MdOutlineAutoMode,
  MdOutlineEditNote,
  MdOutlineSource,
  MdNoteAdd,
  MdOutlineFolder,
  MdOutlineFileOpen,
  MdOutlineFilePresent,
  MdOutlineCreateNewFolder,
  MdOutlineDriveFileMove,
  MdOutlineFileCopy,
  MdOutlineSync,
  MdOutlinePending,
  MdOutlineDone,
  MdOutlineClose,
  MdOutlineFormatAlignLeft,
  MdOutlineFormatAlignCenter,
  MdOutlineFormatAlignRight,
  MdOutlineRocket,
  MdOutlineChat,
  MdOutlineSmartToy,
  MdOutlineMemory,
  MdOutlinePsychology,
  MdOutlineBuild,
  MdOutlineCode,
  MdOutlineDataObject,
  MdOutlineManageSearch,
  MdOutlineTravelExplore,
  MdOutlineAutoFixHigh,
  MdOutlineCompareArrows,
  MdOutlinePlaylistAdd,
  MdOutlineContentPaste,
  MdOutlineAttachFile,
  MdOutlinePhotoCamera,
  MdPublic,
  MdOutlineDeleteSweep,
  MdOutlineArrowBack,
  MdOutlineNoteAdd,
  MdOutlineScience,
  MdOutlineElectricBolt,
  MdOutlineVisibility,
  MdOutlineVisibilityOff,
  MdOutlineInfo,
  MdOutlineStar,
  MdOutlineStarBorder,
  MdBookmark,
  MdBookmarkBorder,
  MdOutlinePushPin,
  MdMoreVert,
  MdMoreHoriz,
  MdArrowDropDown,
  MdOutlineSort,
  MdFilterList,
  MdOutlineCalendarToday,
  MdOutlineAccessTime,
  MdOutlineLoop,
  MdOutlineStop,
  MdOutlinePlayArrow,
  MdOutlinePause,
  MdOutlineSkipNext,
  MdOutlineFastForward,
  MdFastRewind,
  MdOutlineVolumeUp,
  MdOutlineVolumeOff,
  MdOutlineFullscreen,
  MdOutlineFullscreenExit,
  MdOutlineZoomIn,
  MdOutlineZoomOut,
  MdOutlineFitScreen,
  MdOutlineAspectRatio,
  MdOutlineCrop,
  MdOutlineTransform,
  MdOutlineRotateRight,
  MdOutlineFlip,
  MdOutlineTune,
  MdOutlinePalette,
  MdOutlineBrush,
  MdOutlineFormatPaint,
  MdOutlineColorLens,
  MdOutlineGradient,
  MdOutlineTexture,
  MdOutlineBlurOn,
  MdOutlineFlare,
  MdOutlineWbSunny,
  MdOutlineNightlight,
  MdOutlineContrast,
  MdOutlineOpacity,
  MdOutlineInvertColors,
  MdOutlineTonality,
  MdOutlineExposure,
  // 浮动工具栏格式化图标
  MdFormatBold,
  MdFormatItalic,
  MdFormatUnderlined,
  MdFormatStrikethrough,
  MdCode,
  MdOutlineHighlight,
  MdInsertLink,
  MdOutlineImage,
  MdOutlineFunctions,
  MdOutlineGridOn,
  MdLinkOff,
  MdOutlineAutoFixNormal,
  MdOutlineLock,
} from 'react-icons/md';

/** 图标名称到组件的映射表。 */
const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  // 基础操作
  'close': MdClose,
  'check': MdCheck,
  'copy': MdContentCopy,
  'edit': MdEdit,
  'refresh': MdRefresh,
  'delete': MdDeleteOutline,
  'search': MdSearch,
  'chevron-right': MdChevronRight,
  'chevron-left': MdChevronLeft,
  'add': MdAdd,
  'remove': MdRemove,
  'settings': MdSettings,
  'arrow-down': MdKeyboardArrowDown,
  'arrow-up': MdKeyboardArrowUp,

  // 文件操作
  'file-upload': MdFileUpload,
  'image': MdImage,
  'attach': MdOutlineAttachFile,
  'photo': MdOutlinePhotoCamera,
  'link': MdLink,
  'web': MdWeb,
  'folder': MdFolderOpen,
  'folder-open': MdFolderOpen,
  'folder-outline': MdOutlineFolder,
  'folder-new': MdOutlineCreateNewFolder,
  'folder-move': MdOutlineDriveFileMove,
  'file': MdInsertDriveFile,
  'file-outline': MdOutlineFilePresent,
  'file-open': MdOutlineFileOpen,
  'file-copy': MdOutlineFileCopy,
  'file-edit': MdOutlineEditNote,
  'file-note': MdDescription,
  'file-add': MdNoteAdd,
  'file-sync': MdOutlineSync,

  // 状态指示
  'lightning': MdOutlineElectricBolt,
  'question': MdOutlineQuestionMark,
  'warning': MdOutlineWarning,
  'error': MdOutlineError,
  'check-circle': MdOutlineCheckCircle,
  'cancel': MdOutlineCancel,
  'schedule': MdOutlineSchedule,
  'pending': MdOutlinePending,
  'done': MdOutlineDone,
  'close-circle': MdOutlineClose,
  'rocket': MdOutlineRocket,
  'info': MdOutlineInfo,
  'lock': MdOutlineLock,

  // Agent/Chat
  'chat': MdOutlineChat,
  'robot': MdOutlineSmartToy,
  'memory': MdOutlineMemory,
  'psychology': MdOutlinePsychology,
  'build': MdOutlineBuild,
  'code': MdOutlineCode,
  'data': MdOutlineDataObject,
  'auto-mode': MdOutlineAutoMode,
  'auto-fix': MdOutlineAutoFixHigh,
  'compare': MdOutlineCompareArrows,
  'source': MdOutlineSource,

  // 工具栏
  'playlist-add': MdOutlinePlaylistAdd,
  'paste': MdOutlineContentPaste,
  'globe': MdPublic,
  'delete-sweep': MdOutlineDeleteSweep,
  'arrow-back': MdOutlineArrowBack,
  'note-add': MdOutlineNoteAdd,
  'science': MdOutlineScience,
  'bolt': MdFlashOn,
  'visibility': MdOutlineVisibility,
  'visibility-off': MdOutlineVisibilityOff,
  'star': MdOutlineStar,
  'star-border': MdOutlineStarBorder,
  'bookmark': MdBookmark,
  'bookmark-border': MdBookmarkBorder,
  'pin': MdOutlinePushPin,
  'more-vert': MdMoreVert,
  'more-horiz': MdMoreHoriz,
  'arrow-drop-down': MdArrowDropDown,
  'sort': MdOutlineSort,
  'filter': MdFilterList,

  // 时间/播放
  'calendar': MdOutlineCalendarToday,
  'time': MdOutlineAccessTime,
  'loop': MdOutlineLoop,
  'stop': MdOutlineStop,
  'play': MdOutlinePlayArrow,
  'pause': MdOutlinePause,
  'skip-next': MdOutlineSkipNext,
  'fast-forward': MdOutlineFastForward,
  'rewind': MdFastRewind,

  // 视图
  'volume': MdOutlineVolumeUp,
  'volume-off': MdOutlineVolumeOff,
  'fullscreen': MdOutlineFullscreen,
  'fullscreen-exit': MdOutlineFullscreenExit,
  'zoom-in': MdOutlineZoomIn,
  'zoom-out': MdOutlineZoomOut,
  'fit-screen': MdOutlineFitScreen,
  'aspect-ratio': MdOutlineAspectRatio,
  'crop': MdOutlineCrop,
  'transform': MdOutlineTransform,
  'rotate': MdOutlineRotateRight,
  'flip': MdOutlineFlip,

  // 调整/样式
  'tune': MdOutlineTune,
  'palette': MdOutlinePalette,
  'brush': MdOutlineBrush,
  'paint': MdOutlineFormatPaint,
  'color-lens': MdOutlineColorLens,
  'gradient': MdOutlineGradient,
  'texture': MdOutlineTexture,
  'blur': MdOutlineBlurOn,
  'flare': MdOutlineFlare,
  'sunny': MdOutlineWbSunny,
  'night': MdOutlineNightlight,
  'contrast': MdOutlineContrast,
  'opacity': MdOutlineOpacity,
  'invert': MdOutlineInvertColors,
  'tonality': MdOutlineTonality,
  'exposure': MdOutlineExposure,

  // 浮动工具栏格式化
  'bold': MdFormatBold,
  'italic': MdFormatItalic,
  'underline': MdFormatUnderlined,
  'strikethrough': MdFormatStrikethrough,
  'code-inline': MdCode,
  'highlight': MdOutlineHighlight,
  'link-insert': MdInsertLink,
  'image-insert': MdOutlineImage,
  'math': MdOutlineFunctions,
  'table': MdOutlineGridOn,
  'unlink': MdLinkOff,
  'eraser': MdOutlineAutoFixNormal,

  // 图片工具栏
  'image-edit': MdEdit,
  'image-inline': MdOutlineImage,
  'align-left': MdOutlineFormatAlignLeft,
  'align-center': MdOutlineFormatAlignCenter,
  'align-right': MdOutlineFormatAlignRight,
  'image-remove': MdDeleteOutline,
};

export interface IconProps {
  /** 图标名称（mdi 风格短横线命名）。 */
  icon: string;
  /** 尺寸（px），默认 16。 */
  size?: number;
  /** 额外 className。 */
  className?: string;
  /** 额外 style。 */
  style?: React.CSSProperties;
}

/**
 * 共享 Icon 组件。
 * 用法：<Icon icon="close" size={16} className="text-red-400" />
 */
const Icon: React.FC<IconProps> = ({ icon, size = 16, className, style }) => {
  const IconComponent = ICON_MAP[icon];
  if (!IconComponent) {
    // 降级：显示图标名首字母
    return (
      <span
        className={className}
        style={{ width: size, height: size, fontSize: size * 0.7, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', ...style }}
      >
        {icon.charAt(0).toUpperCase()}
      </span>
    );
  }
  if (style) {
    return (
      <span className={className} style={style}>
        <IconComponent size={size} />
      </span>
    );
  }
  return <IconComponent size={size} className={className} />;
};

export default Icon;
