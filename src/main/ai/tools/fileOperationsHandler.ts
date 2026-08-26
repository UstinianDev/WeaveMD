import { handleRenameFileDirect, handleMoveFileDirect, handleDeleteFileDirect } from './fileOperations';
import type { ToolCtx, ToolResult } from '../toolTypes';

export function handleRenameFile(args: Record<string, unknown>, ctx: ToolCtx): ToolResult {
  return handleRenameFileDirect(args, ctx);
}

export function handleMoveFile(args: Record<string, unknown>, ctx: ToolCtx): ToolResult {
  return handleMoveFileDirect(args, ctx);
}

export function handleDeleteFile(args: Record<string, unknown>, ctx: ToolCtx): ToolResult {
  return handleDeleteFileDirect(args, ctx);
}
