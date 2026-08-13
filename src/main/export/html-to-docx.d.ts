// ============================================
// WeaveMD — html-to-docx 类型声明
// ============================================
// npm 包未自带 .d.ts，这里按 CJS 默认导出声明（esModuleInterop 下 `import HTMLtoDOCX from` 生效）。

declare module 'html-to-docx' {
  interface HtmlToDocxMargins {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
    header?: number;
    footer?: number;
    gutter?: number;
  }

  interface HtmlToDocxOptions {
    orientation?: 'portrait' | 'landscape';
    margins?: HtmlToDocxMargins;
    title?: string;
    subject?: string;
    creator?: string;
    keywords?: string;
    description?: string;
    lastModifiedBy?: string;
    revision?: number;
    createdAt?: Date;
    modifiedAt?: Date;
    font?: string;
    fontSize?: number;
    complexScriptFontSize?: number;
  }

  /** CJS 默认导出：HTML 字符串 → DOCX Buffer（Node） */
  function HTMLtoDOCX(
    htmlString: string,
    headerHTMLString?: string | null,
    documentOptions?: HtmlToDocxOptions,
    footerHTMLString?: string | null,
  ): Promise<Buffer>;

  export default HTMLtoDOCX;
}
