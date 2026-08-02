import type { editor as MonacoEditor, IDisposable } from 'monaco-editor';
import { prepareMarkdownForRendering, renderMarkdownToHtml } from '../../services/markdown';
import type { BlockInfo } from '../../services/markdownBlockDetector';

type MonacoModule = typeof import('monaco-editor');

type RenderedBlockPayload = {
  block: BlockInfo;
  html: string;
};

type WidgetRecord = {
  block: BlockInfo;
  domNode: HTMLDivElement;
  widget: MonacoEditor.IContentWidget;
};

export const RENDERED_BLOCK_WIDGET_CLASS =
  'markdown-block-widget markdown-block-widget--pass-through';

function normalizeDocumentLines(content: string) {
  return prepareMarkdownForRendering(content).split('\n');
}

export function extractRenderableBlockMarkdown(
  content: string,
  block: Pick<BlockInfo, 'startLine' | 'endLine'>
) {
  const lines = normalizeDocumentLines(content);
  return lines.slice(block.startLine - 1, block.endLine).join('\n');
}

export function buildRenderedBlockHtml(block: Pick<BlockInfo, 'id' | 'type'>, innerHtml: string) {
  return [
    `<div class="markdown-preview markdown-block-rendered markdown-block-rendered--${block.type}"`,
    ` data-block-id="${escapeAttribute(block.id)}">`,
    innerHtml,
    '</div>',
  ].join('');
}

export class MarkdownRenderedBlocksController {
  private readonly widgetRecords = new Map<string, WidgetRecord>();
  private readonly renderCache = new Map<string, string>();
  private renderVersion = 0;
  private disposed = false;
  private relayoutHandle: ReturnType<typeof setTimeout> | number | null = null;
  private scrollListener: IDisposable | null = null;
  private scrollRepositionTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly editor: MonacoEditor.IStandaloneCodeEditor,
    private readonly monaco: MonacoModule
  ) {
    this.scrollListener = editor.onDidScrollChange(() => {
      this.onScroll();
    });
  }

  async sync(
    content: string,
    blocks: BlockInfo[],
    mdSourceBlockId: string | null
  ): Promise<Set<string> | null> {
    const renderVersion = ++this.renderVersion;
    const inactiveBlocks = blocks.filter((block) => block.id !== mdSourceBlockId);
    const renderedBlocks = await Promise.all(
      inactiveBlocks.map(async (block) => {
        const markdown = extractRenderableBlockMarkdown(content, block);
        const cacheKey = `${block.type}:${JSON.stringify(block.metadata ?? {})}:${markdown}`;
        let html = this.renderCache.get(cacheKey);

        if (!html) {
          html = buildRenderedBlockHtml(block, await renderMarkdownToHtml(markdown));
          this.renderCache.set(cacheKey, html);
        }

        return { block, html } satisfies RenderedBlockPayload;
      })
    );

    if (this.disposed || renderVersion !== this.renderVersion) {
      return null;
    }

    const nextIds = new Set(inactiveBlocks.map((block) => block.id));
    this.prune(nextIds);

    for (const renderedBlock of renderedBlocks) {
      this.upsertWidget(renderedBlock);
    }

    this.scheduleRelayout();
    return nextIds;
  }

  relayout() {
    if (this.disposed) {
      return;
    }

    const contentWidth = Math.max(this.editor.getLayoutInfo().contentWidth - 8, 160);
    for (const record of this.widgetRecords.values()) {
      record.domNode.style.width = `${contentWidth}px`;
      this.editor.layoutContentWidget(record.widget);
    }
  }

  clear() {
    this.renderVersion += 1;
    this.cancelScheduledRelayout();
    this.prune(new Set());
  }

  dispose() {
    this.disposed = true;
    this.scrollListener?.dispose();
    this.scrollListener = null;
    if (this.scrollRepositionTimer) {
      clearTimeout(this.scrollRepositionTimer);
      this.scrollRepositionTimer = null;
    }
    this.clear();
  }

  private upsertWidget({ block, html }: RenderedBlockPayload) {
    const widgetId = getRenderedBlockWidgetId(block.id);
    let record = this.widgetRecords.get(block.id);

    if (!record) {
      const domNode = document.createElement('div');
      domNode.className = RENDERED_BLOCK_WIDGET_CLASS;
      domNode.dataset.blockId = block.id;

      // Set width immediately to constrain text wrapping — don't wait for
      // the async relayout(). Without this, width:100% in CSS refers to an
      // unconstrained parent and long lines won't wrap.
      try {
        const contentWidth = Math.max(this.editor.getLayoutInfo().contentWidth - 8, 160);
        domNode.style.width = `${contentWidth}px`;
      } catch {
        // editor not fully initialized yet — relayout() will fix it later
      }

      const widget: MonacoEditor.IContentWidget = {
        allowEditorOverflow: true,
        suppressMouseDown: false,
        getId: () => widgetId,
        getDomNode: () => domNode,
        getPosition: () => {
          let anchorLine = block.startLine;

          // For multi-line blocks, keep the widget alive when the first
          // source line scrolls above the viewport by re-anchoring to the
          // first visible line.
          if (block.endLine > block.startLine) {
            const visibleRanges = this.editor.getVisibleRanges();
            if (visibleRanges.length > 0) {
              const firstVisible = visibleRanges[0].startLineNumber;
              if (block.startLine < firstVisible && block.endLine >= firstVisible) {
                anchorLine = firstVisible;
              }
            }
          }

          return {
            position: {
              lineNumber: anchorLine,
              column: block.startColumn,
            },
            preference: [this.monaco.editor.ContentWidgetPositionPreference.EXACT],
          };
        },
      };

      record = {
        block,
        domNode,
        widget,
      };

      this.widgetRecords.set(block.id, record);
      this.editor.addContentWidget(widget);
    }

    record.block = block;
    record.domNode.innerHTML = html;
    record.domNode.dataset.blockType = block.type;

    // Constrain rendered height to source-line extent, preventing overflow
    // into adjacent blocks. Heading line heights match the decoration typography
    // scale so the rendered heading fits within its source-line budget.
    const defaultLineHeight = this.editor.getOption(this.monaco.editor.EditorOption.lineHeight);
    const lineCount = block.endLine - block.startLine + 1;
    let lineHeight = defaultLineHeight;
    if (block.type === 'heading') {
      const headingLineHeights = [42, 38, 34, 30, 28, 26];
      const level = (block.metadata?.headingLevel ?? 1) - 1;
      lineHeight = headingLineHeights[Math.min(level, headingLineHeights.length - 1)];
    }
    record.domNode.style.maxHeight = `${lineCount * lineHeight}px`;

    this.editor.layoutContentWidget(record.widget);
  }

  private onScroll() {
    if (this.disposed) return;

    // Debounce rapid scroll events so we only re-layout once per frame.
    if (this.scrollRepositionTimer) clearTimeout(this.scrollRepositionTimer);
    this.scrollRepositionTimer = setTimeout(() => {
      this.scrollRepositionTimer = null;
      if (this.disposed) return;

      for (const record of this.widgetRecords.values()) {
        // Only multi-line blocks benefit from scroll-aware repositioning.
        if (record.block.endLine > record.block.startLine) {
          this.syncWidgetScrollOffset(record);
          this.editor.layoutContentWidget(record.widget);
        }
      }
    }, 50);
  }

  /**
   * When a multi-line block's first line scrolls above the viewport,
   * shift the rendered content upward with translateY and clamp the
   * widget height to only the visible portion.  This keeps the rendered
   * overlay aligned with the visible source lines.
   */
  private syncWidgetScrollOffset(record: WidgetRecord) {
    const block = record.block;
    const visibleRanges = this.editor.getVisibleRanges();

    if (visibleRanges.length === 0) {
      record.domNode.style.transform = '';
      return;
    }

    const firstVisible = visibleRanges[0].startLineNumber;
    const lineHeight = this.editor.getOption(this.monaco.editor.EditorOption.lineHeight);
    const totalLines = block.endLine - block.startLine + 1;

    if (block.startLine < firstVisible && block.endLine >= firstVisible) {
      const hiddenLines = firstVisible - block.startLine;
      const visibleLines = block.endLine - firstVisible + 1;
      const offset = hiddenLines * lineHeight;
      record.domNode.style.transform = `translateY(-${offset}px)`;
      record.domNode.style.maxHeight = `${visibleLines * lineHeight}px`;
    } else if (block.startLine >= firstVisible) {
      // Block starts within (or below) the viewport — reset to natural size.
      record.domNode.style.transform = '';
      const defaultLineHeight =
        block.type === 'heading'
          ? [42, 38, 34, 30, 28, 26][Math.min((block.metadata?.headingLevel ?? 1) - 1, 5)]
          : lineHeight;
      record.domNode.style.maxHeight = `${totalLines * defaultLineHeight}px`;
    }
  }

  private prune(nextIds: Set<string>) {
    for (const [blockId, record] of this.widgetRecords.entries()) {
      if (nextIds.has(blockId)) {
        continue;
      }

      this.editor.removeContentWidget(record.widget);
      this.widgetRecords.delete(blockId);
    }
  }

  private scheduleRelayout() {
    this.cancelScheduledRelayout();

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      this.relayoutHandle = window.requestAnimationFrame(() => {
        this.relayoutHandle = null;
        this.relayout();
      });
      return;
    }

    this.relayoutHandle = globalThis.setTimeout(() => {
      this.relayoutHandle = null;
      this.relayout();
    }, 0);
  }

  private cancelScheduledRelayout() {
    if (this.relayoutHandle === null) {
      return;
    }

    if (
      typeof window !== 'undefined' &&
      typeof window.cancelAnimationFrame === 'function' &&
      typeof this.relayoutHandle === 'number'
    ) {
      window.cancelAnimationFrame(this.relayoutHandle);
    } else {
      clearTimeout(this.relayoutHandle);
    }

    this.relayoutHandle = null;
  }
}

function getRenderedBlockWidgetId(blockId: string) {
  return `weavemd-rendered-block:${blockId}`;
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
