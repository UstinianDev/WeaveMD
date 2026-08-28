// ============================================
// WeaveMD — 设置·MCP 面板（R11，占位）
// ============================================
// 真 MCP server 管理已延期，此页仅注明占位，不提供任何配置项。

import React from 'react';
import { useI18n } from '@render/i18n';

const McpPanel: React.FC = () => {
  const { t } = useI18n();
  return (
    <p className="text-[15px] text-text-muted" style={{ fontFamily: "Consolas, 'Alibaba PuHuiTi 2.0', '阿里巴巴普惠体', sans-serif" }} data-testid="mcp-deferred">
      {t('ai.settings.mcpDeferred')}
    </p>
  );
};

export default McpPanel;
