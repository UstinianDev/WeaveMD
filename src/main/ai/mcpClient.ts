// ============================================
// WeaveMD — MCP 客户端（简化实现）
// ============================================
// MCP (Model Context Protocol) 客户端管理（M1）。
// 简化实现：仅提供配置管理，实际 MCP 连接需要 @modelcontextprotocol/sdk。

export interface McpServerConfig {
  id: string;
  name: string;
  type: 'stdio' | 'sse';
  /** stdio 模式的命令。 */
  command?: string;
  /** stdio 模式的参数。 */
  args?: string[];
  /** SSE 模式的 URL。 */
  url?: string;
  /** 是否启用。 */
  enabled: boolean;
}

export interface McpServerStatus {
  id: string;
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  error?: string;
}

/** 内存中的 MCP 服务器配置。 */
const mcpServers = new Map<string, McpServerConfig>();

/** 获取所有 MCP 服务器配置。 */
export function getMcpServers(): McpServerConfig[] {
  return Array.from(mcpServers.values());
}

/** 获取单个 MCP 服务器配置。 */
export function getMcpServer(id: string): McpServerConfig | null {
  return mcpServers.get(id) ?? null;
}

/** 添加 MCP 服务器配置。 */
export function addMcpServer(config: Omit<McpServerConfig, 'id'>): McpServerConfig {
  const id = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fullConfig: McpServerConfig = { ...config, id };
  mcpServers.set(id, fullConfig);
  return fullConfig;
}

/** 更新 MCP 服务器配置。 */
export function updateMcpServer(
  id: string,
  updates: Partial<Omit<McpServerConfig, 'id'>>
): McpServerConfig | null {
  const existing = mcpServers.get(id);
  if (!existing) return null;

  const updated = { ...existing, ...updates };
  mcpServers.set(id, updated);
  return updated;
}

/** 删除 MCP 服务器配置。 */
export function deleteMcpServer(id: string): boolean {
  return mcpServers.delete(id);
}

/** 获取 MCP 服务器状态（简化实现：返回配置的启用状态）。 */
export function getMcpServerStatus(id: string): McpServerStatus | null {
  const config = mcpServers.get(id);
  if (!config) return null;

  return {
    id: config.id,
    name: config.name,
    status: config.enabled ? 'connected' : 'disconnected',
  };
}

/** 检查 MCP 服务器是否可用。 */
export function isMcpServerAvailable(id: string): boolean {
  const config = mcpServers.get(id);
  return config?.enabled ?? false;
}
