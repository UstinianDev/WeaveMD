import React, { useEffect, useState } from 'react';
import { renderMarkdownToHtml } from '../../services/markdown';
import { useDebouncedCallback } from './EditorView';

interface MarkdownPreviewProps {
  content: string;
}

const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({ content }) => {
  const [html, setHtml] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const renderContent = useDebouncedCallback(async (text: string) => {
    setIsLoading(true);
    try {
      const renderedHtml = await renderMarkdownToHtml(text);
      setHtml(renderedHtml);
    } catch (error) {
      console.error('Failed to render markdown:', error);
      setHtml('');
    } finally {
      setIsLoading(false);
    }
  }, 300);

  useEffect(() => {
    renderContent(content);
  }, [content, renderContent]);

  return (
    <div
      className="markdown-preview w-full h-full overflow-auto p-4"
      style={{
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-primary)',
      }}
    >
      {isLoading ? (
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Loading preview...
            </p>
          </div>
        </div>
      ) : (
        <div
          dangerouslySetInnerHTML={{ __html: html }}
          className="prose prose-sm max-w-none"
          style={
            {
              '--tw-prose-body': 'var(--text-primary)',
              '--tw-prose-headings': 'var(--text-primary)',
              '--tw-prose-links': 'var(--accent)',
              '--tw-prose-code': 'var(--accent-secondary)',
              '--tw-prose-pre-code': 'var(--text-primary)',
              '--tw-prose-pre-bg': 'var(--bg-secondary)',
              '--tw-prose-hr': 'var(--border-color)',
              '--tw-prose-quote-borders': 'var(--accent)',
            } as React.CSSProperties
          }
        />
      )}
    </div>
  );
};

export default MarkdownPreview;
