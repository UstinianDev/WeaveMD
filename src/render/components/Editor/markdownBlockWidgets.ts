import type { editor as MonacoEditor } from 'monaco-editor';
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
  zoneId: string | null;
  zoneDomNode: HTMLDivElement;
  widget: MonacoEditor.IContentWidget;
};

export const RENDERED_BLOCK_WIDGET_CLASS = 'markdown-block-widget markdown-block-widget--pass-through';

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

  constructor(
    private readonly editor: MonacoEditor.IStandaloneCodeEditor,
    private readonly monaco: MonacoModule
  ) {}

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

    this.editor.changeViewZones((accessor) => {
      for (const record of this.widgetRecords.values()) {
        if (record.zoneId) {
          accessor.removeZone(record.zoneId);
          record.zoneId = null;
        }

        const sourceHeight = this.getBlockSourceHeight(record.block);
        const renderedHeight = Math.ceil(record.domNode.getBoundingClientRect().height);
        const extraHeight = Math.max(0, renderedHeight - sourceHeight);

        if (extraHeight <= 0) {
          continue;
        }

        record.zoneId = accessor.addZone({
          afterLineNumber: record.block.endLine,
          domNode: record.zoneDomNode,
          heightInPx: extraHeight,
          showInHiddenAreas: true,
        });
      }
    });
  }

  clear() {
    this.renderVersion += 1;
    this.cancelScheduledRelayout();
    this.prune(new Set());
  }

  dispose() {
    this.disposed = true;
    this.clear();
  }

  private upsertWidget({ block, html }: RenderedBlockPayload) {
    const widgetId = getRenderedBlockWidgetId(block.id);
    let record = this.widgetRecords.get(block.id);

    if (!record) {
      const domNode = document.createElement('div');
      domNode.className = RENDERED_BLOCK_WIDGET_CLASS;
      domNode.dataset.blockId = block.id;
      const nextRecord = {} as WidgetRecord;

      const widget: MonacoEditor.IContentWidget = {
        allowEditorOverflow: false,
        suppressMouseDown: false,
        getId: () => widgetId,
        getDomNode: () => domNode,
        getPosition: () => ({
          position: {
            lineNumber: nextRecord.block.startLine,
            column: nextRecord.block.startColumn,
          },
          preference: [this.monaco.editor.ContentWidgetPositionPreference.EXACT],
        }),
      };

      record = {
        block,
        domNode,
        zoneId: null,
        zoneDomNode: document.createElement('div'),
        widget,
      };
      Object.assign(nextRecord, record);

      this.widgetRecords.set(block.id, record);
      this.editor.addContentWidget(widget);
    }

    record.block = block;
    record.domNode.innerHTML = html;
    record.domNode.dataset.blockType = block.type;
    record.zoneDomNode.className = 'markdown-block-zone';
    record.zoneDomNode.dataset.blockId = block.id;
    this.editor.layoutContentWidget(record.widget);
  }

  private prune(nextIds: Set<string>) {
    this.editor.changeViewZones((accessor) => {
      for (const [blockId, record] of this.widgetRecords.entries()) {
        if (nextIds.has(blockId)) {
          continue;
        }

        if (record.zoneId) {
          accessor.removeZone(record.zoneId);
        }

        this.editor.removeContentWidget(record.widget);
        this.widgetRecords.delete(blockId);
      }
    });
  }

  private getBlockSourceHeight(block: BlockInfo) {
    const rawOptions = this.editor.getRawOptions();
    const lineHeight = typeof rawOptions.lineHeight === 'number' ? rawOptions.lineHeight : 24;
    return (block.endLine - block.startLine + 1) * lineHeight;
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
