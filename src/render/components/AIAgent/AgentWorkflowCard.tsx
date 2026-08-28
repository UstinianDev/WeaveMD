// ============================================
// WeaveMD — AI Agent 工作流模块化折叠卡片
// ============================================
// 参照 Notus TaskActivityCard 设计：每条 AI 回复内的工具调用步骤
// 变为可折叠区块，顶部有整体折叠/展开控制。
// 每个模块显示：工具图标+名称、关键参数、执行结果的结构化摘要。
// 模块间有明显的视觉分界（边框 + 左侧色条）。

import React, { useState, useMemo, useCallback } from 'react';
import type { IAgentToolCall } from '@shared/ai';
import Icon from '../Common/Icon';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

interface AgentWorkflowCardProps {
  /** 当前消息的工具调用列表（流式时从 agentStore.toolCalls 读取）。 */
  toolCalls: IAgentToolCall[];
  /** 处理耗时（毫秒）。 */
  duration?: number;
}

/** 分组后的单轮步骤。 */
interface GroupedStep {
  /** 轮次索引（loopIndex）。 */
  roundIndex: number;
  /** 该轮的工具调用列表。 */
  calls: IAgentToolCall[];
  /** 该轮是否全部成功。 */
  allOk: boolean;
  /** 该轮是否有进行中的调用。 */
  hasRunning: boolean;
}

// ---------------------------------------------------------------------------
// 工具图标映射
// ---------------------------------------------------------------------------

/** 工具名 → Icon 组件图标名。 */
const TOOL_ICONS: Record<string, string> = {
  searchKB: 'search',
  readFile: 'file-outline',
  readLocalFile: 'file-outline',
  listFiles: 'folder-outline',
  listLocalDirectory: 'folder-outline',
  analyze_folder: 'folder',
  createFile: 'file-add',
  createFolder: 'folder-new',
  create_note: 'file-add',
  renameFile: 'file-edit',
  moveFile: 'folder-move',
  deleteFile: 'delete',
  editLocalFile: 'edit',
  editBlocks: 'edit',
  preview_file_revision: 'check-circle',
  preview_patch_files: 'check-circle',
  preview_file_operations: 'check-circle',
  runSkill: 'bolt',
  ask_question_card: 'question',
  check_links: 'link',
  get_task_activity: 'schedule',
  web_search: 'web',
  research_search: 'search',
  list_skills: 'bolt',
  get_skill_details: 'bolt',
  load_skill: 'bolt',
  read_skill_file: 'bolt',
  create_skill_draft: 'bolt',
  update_global_agent_file: 'file-sync',
  read_global_agent_file: 'file-outline',
  load_mcp_tool: 'code',
};

function getToolIcon(name: string): string {
  return TOOL_ICONS[name] ?? 'build';
}

/** 步骤卡片背景色循环（5 种深色系，带左侧色条）。 */
const STEP_COLORS = [
  { bg: 'rgba(37, 99, 235, 0.08)', border: '#2563eb', bar: '#2563eb' },    // 蓝
  { bg: 'rgba(5, 150, 105, 0.08)', border: '#059669', bar: '#059669' },    // 绿
  { bg: 'rgba(217, 119, 6, 0.08)',  border: '#d97706', bar: '#d97706' },    // 橙
  { bg: 'rgba(124, 58, 237, 0.08)', border: '#7c3aed', bar: '#7c3aed' },   // 紫
  { bg: 'rgba(6, 182, 212, 0.08)',  border: '#06b6d4', bar: '#06b6d4' },    // 青
];

function getStepColor(roundIndex: number) {
  return STEP_COLORS[roundIndex % STEP_COLORS.length];
}

// ---------------------------------------------------------------------------
// 工具摘要提取
// ---------------------------------------------------------------------------

/** 从 args JSON 中提取关键参数的摘要。工具名与 toolRegistry 注册名一致（camelCase / 混合）。 */
function extractToolSummary(call: IAgentToolCall): string {
  const { name, args } = call;

  try {
    const parsed: Record<string, unknown> = args ? JSON.parse(args) : {};

    switch (name) {
      // 知识库检索
      case 'searchKB':
        return `查询: "${String(parsed.query ?? '').slice(0, 60)}"`;

      // 文件读取（DB 或本地磁盘）
      case 'readFile': {
        const fileId = String(parsed.file_id ?? '');
        return fileId ? `读取: ${fileId.slice(0, 20)}` : '读取文件';
      }
      case 'readLocalFile': {
        const path = String(parsed.path ?? parsed.file_path ?? '');
        const shortPath = path.split('/').pop() ?? path;
        return shortPath || '读取本地文件';
      }

      // 目录列表
      case 'listFiles':
        return '列出文件';
      case 'listLocalDirectory': {
        const dir = String(parsed.path ?? parsed.dir_path ?? '');
        return dir ? `目录: ${dir}` : '浏览目录';
      }
      case 'analyze_folder': {
        const dir = String(parsed.path ?? parsed.dir_path ?? '');
        return dir ? `分析: ${dir}` : '分析目录';
      }

      // 文件创建
      case 'createFile':
        return String(parsed.file_name ?? parsed.name ?? '创建文件');
      case 'createFolder':
        return String(parsed.folder_name ?? parsed.name ?? '创建文件夹');

      // 文件操作
      case 'renameFile':
        return String(parsed.new_name ?? parsed.name ?? '重命名');
      case 'moveFile':
        return String(parsed.target_path ?? parsed.path ?? '移动文件');
      case 'deleteFile':
        return String(parsed.file_id ?? parsed.name ?? '删除文件');
      case 'editLocalFile': {
        const editPath = String(parsed.file_path ?? '');
        const shortEditName = editPath.split('/').pop() ?? editPath;
        return shortEditName ? `编辑: ${shortEditName}` : '编辑本地文件';
      }

      // 块级改写 / 文件修订
      case 'editBlocks': {
        const ops = parsed.block_ops;
        if (Array.isArray(ops)) {
          return `改写 ${ops.length} 个块`;
        }
        return '块级改写';
      }
      case 'preview_file_revision': {
        const filePath = String(parsed.file_path ?? parsed.path ?? '');
        const shortName = filePath.split('/').pop() ?? filePath;
        return shortName ? `修订: ${shortName}` : '文件修订';
      }
      case 'preview_patch_files': {
        const filePath = String(parsed.file_path ?? parsed.path ?? '');
        const shortName = filePath.split('/').pop() ?? filePath;
        return shortName ? `补丁: ${shortName}` : '文件补丁';
      }

      // 技能 / 交互
      case 'runSkill':
        return String(parsed.skill ?? parsed.name ?? '调用技能');
      case 'ask_question_card': {
        const questions = parsed.questions;
        if (Array.isArray(questions)) {
          return `生成 ${questions.length} 个提问`;
        }
        return '生成提问卡片';
      }

      // 搜索
      case 'web_search':
        return `搜索: "${String(parsed.query ?? '').slice(0, 40)}"`;
      case 'research_search':
        return `研究: "${String(parsed.query ?? '').slice(0, 40)}"`;

      // 链接 / 任务
      case 'check_links':
        return '检查内部链接';
      case 'get_task_activity':
        return '读取任务活动';

      default: {
        // 通用摘要：取第一个字符串参数
        const firstStr = Object.values(parsed).find((v) => typeof v === 'string' && v.length > 0);
        if (firstStr && typeof firstStr === 'string') {
          return firstStr.length > 50 ? `${firstStr.slice(0, 50)}…` : firstStr;
        }
        return name;
      }
    }
  } catch {
    // args 解析失败
    if (args && args.length > 0) {
      return args.length > 50 ? `${args.slice(0, 50)}…` : args;
    }
    return name;
  }
}

/** 从 result 中提取结果摘要。 */
function extractResultSummary(call: IAgentToolCall): string | null {
  if (call.status === 'error') {
    const err = call.errorDesc ?? call.result ?? '';
    return err.length > 80 ? `${err.slice(0, 80)}…` : err || '执行失败';
  }

  const result = call.result;
  if (!result) return null;

  // 尝试解析 JSON 结果
  try {
    const parsed: Record<string, unknown> = JSON.parse(result);

    // search_knowledge 结果
    if (Array.isArray(parsed.results)) {
      return `找到 ${parsed.results.length} 条结果`;
    }
    // list_files 结果
    if (Array.isArray(parsed.files)) {
      return `${parsed.files.length} 个文件`;
    }
    // load_skill 结果
    if (parsed.skill_name || parsed.name) {
      return `已加载: ${String(parsed.skill_name ?? parsed.name)}`;
    }
    // 通用
    if (typeof parsed.summary === 'string') {
      return parsed.summary.slice(0, 80);
    }
  } catch {
    // 非 JSON，取前 80 字符
    return result.length > 80 ? `${result.slice(0, 80)}…` : result;
  }

  return null;
}

// ---------------------------------------------------------------------------
// 分组逻辑
// ---------------------------------------------------------------------------

function groupByRound(toolCalls: IAgentToolCall[]): GroupedStep[] {
  const groups = new Map<number, IAgentToolCall[]>();

  for (const call of toolCalls) {
    const key = call.loopIndex ?? 0;
    const arr = groups.get(key);
    if (arr) {
      arr.push(call);
    } else {
      groups.set(key, [call]);
    }
  }

  const steps: GroupedStep[] = [];
  for (const [roundIndex, calls] of groups) {
    const allOk = calls.every((c) => c.status === 'ok');
    steps.push({ roundIndex, calls, allOk, hasRunning: false });
  }

  return steps.sort((a, b) => a.roundIndex - b.roundIndex);
}

// ---------------------------------------------------------------------------
// 格式化耗时
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms >= 60_000) {
    const min = Math.floor(ms / 60_000);
    const sec = Math.floor((ms % 60_000) / 1000);
    return `${min}分${sec}秒`;
  }
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}秒`;
  }
  return `${ms}ms`;
}

// ---------------------------------------------------------------------------
// 子组件：单个工具调用行
// ---------------------------------------------------------------------------

interface ToolCallRowProps {
  call: IAgentToolCall;
}

const ToolCallRow: React.FC<ToolCallRowProps> = ({ call }) => {
  const isError = call.status === 'error';
  const icon = getToolIcon(call.name);
  const summary = extractToolSummary(call);
  const resultSummary = extractResultSummary(call);

  return (
    <div className="flex items-start gap-2.5 py-1.5">
      {/* 状态指示器 */}
      <span className="flex-shrink-0 mt-0.5">
        {isError ? (
          <Icon icon="close" size={14} className="text-red-400" />
        ) : (
          <Icon icon="check" size={14} className="text-green-400" />
        )}
      </span>

      {/* 内容 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Icon icon={icon} size={16} className="text-text-sub flex-shrink-0" />
          <span
            className={`text-[14px] font-semibold ${
              isError ? 'text-red-400' : 'text-text-primary'
            }`}
          >
            {call.name}
          </span>
        </div>
        {/* 参数摘要 */}
        <div className="text-[13px] text-text-sub mt-1 pl-6 break-all">
          <span className="text-text-muted text-[12px] mr-1">参数:</span>
          <code className="text-[12px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-primary">{summary}</code>
        </div>
        {/* 结果摘要 */}
        {resultSummary && (
          <div
            className={`text-[13px] mt-1 pl-6 break-all ${
              isError ? 'text-red-400' : 'text-green-400'
            }`}
          >
            <span className="text-text-muted text-[12px] mr-1">结果:</span>
            {resultSummary}
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 子组件：单个步骤卡片（可折叠）
// ---------------------------------------------------------------------------

interface StepCardProps {
  step: GroupedStep;
  expanded: boolean;
  onToggle: () => void;
}

const StepCard: React.FC<StepCardProps> = ({ step, expanded, onToggle }) => {
  const firstCall = step.calls[0];
  const hasError = step.calls.some((c) => c.status === 'error');

  // 步骤标题：取第一个调用的名称，多个调用时显示数量
  const title =
    step.calls.length === 1
      ? firstCall.name
      : `${firstCall.name} +${step.calls.length - 1}`;

  // 主摘要
  const mainSummary = extractToolSummary(firstCall);

  // 每步不同色
  const color = getStepColor(step.roundIndex);
  const barColor = hasError ? '#ef4444' : color.bar;

  return (
    <div
      className="rounded-lg overflow-hidden transition-all duration-300"
      style={{
        backgroundColor: hasError ? 'rgba(239, 68, 68, 0.06)' : color.bg,
        borderLeft: `4px solid ${barColor}`,
        border: `1px solid ${hasError ? 'rgba(239, 68, 68, 0.2)' : color.border}20`,
        borderLeftWidth: '4px',
        borderLeftColor: barColor,
      }}
    >
      {/* 标题行（可点击折叠） */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:opacity-80 transition-all duration-300"
        style={{ fontFamily: "Consolas, 'Alibaba PuHuiTi 2.0', '阿里巴巴普惠体', sans-serif" }}
      >
        {/* 折叠箭头 */}
        <svg
          className={`w-3.5 h-3.5 text-text-muted transition-transform duration-300 flex-shrink-0 ${
            expanded ? 'rotate-90' : ''
          }`}
          viewBox="0 0 16 16"
          fill="currentColor"
          style={{ transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }}
        >
          <path d="M6 4l4 4-4 4V4z" />
        </svg>

        {/* 工具图标 + 名称 */}
        <Icon icon={getToolIcon(firstCall.name)} size={18} className="flex-shrink-0" style={{ color: barColor }} />
        <span
          className={`text-[14px] font-semibold flex-shrink-0 ${
            hasError ? 'text-red-400' : 'text-text-primary'
          }`}
        >
          {title}
        </span>

        {/* 状态徽章 */}
        {hasError && (
          <span className="ml-auto flex-shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-red-400/15 text-red-400 border border-red-400/20">
            失败
          </span>
        )}

        {/* 摘要（折叠时显示） */}
        {!expanded && (
          <span className="ml-1 text-[13px] text-text-muted truncate">{mainSummary}</span>
        )}
      </button>

      {/* 展开内容（弹性动画） */}
      <div
        className="overflow-hidden transition-all duration-300"
        style={{
          maxHeight: expanded ? '500px' : '0',
          opacity: expanded ? 1 : 0,
          transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        <div className="px-3 pb-2.5 pt-1 border-t border-border/30 space-y-1">
          {step.calls.map((call) => (
            <ToolCallRow key={call.toolCallId} call={call} />
          ))}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 主组件：AgentWorkflowCard
// ---------------------------------------------------------------------------

const AgentWorkflowCard: React.FC<AgentWorkflowCardProps> = ({ toolCalls, duration }) => {
  // 整体折叠状态
  const [allCollapsed, setAllCollapsed] = useState(false);

  // 各步骤的展开状态（Map<roundIndex, boolean>）
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(() => new Set());

  // 分组
  const steps = useMemo(() => groupByRound(toolCalls), [toolCalls]);

  // 初始化展开状态：新步骤默认展开
  const knownRounds = useMemo(() => new Set(steps.map((s) => s.roundIndex)), [steps]);

  // 确保新步骤默认展开
  React.useEffect(() => {
    if (allCollapsed) return;
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      for (const round of knownRounds) {
        if (!prev.has(round)) {
          next.add(round);
        }
      }
      return next;
    });
  }, [knownRounds, allCollapsed]);

  // 切换单个步骤
  const toggleStep = useCallback(
    (roundIndex: number) => {
      setExpandedSteps((prev) => {
        const next = new Set(prev);
        if (next.has(roundIndex)) {
          next.delete(roundIndex);
        } else {
          next.add(roundIndex);
        }
        return next;
      });
      // 任何单步操作后退出整体折叠模式
      if (allCollapsed) {
        setAllCollapsed(false);
      }
    },
    [allCollapsed],
  );

  // 整体折叠/展开
  const toggleAll = useCallback(() => {
    if (allCollapsed) {
      // 展开所有
      setExpandedSteps(new Set(knownRounds));
      setAllCollapsed(false);
    } else {
      // 收起所有
      setExpandedSteps(new Set());
      setAllCollapsed(true);
    }
  }, [allCollapsed, knownRounds]);

  if (steps.length === 0) return null;

  const totalCalls = toolCalls.length;
  const errorCount = toolCalls.filter((c) => c.status === 'error').length;

  return (
    <div className="rounded-xl border border-border bg-bg-secondary/60 overflow-hidden glow-card" style={{ fontFamily: "Consolas, 'Alibaba PuHuiTi 2.0', '阿里巴巴普惠体', sans-serif" }}>
      {/* 顶部 Header */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-bg-tertiary/50 border-b border-border">
        {/* 整体折叠按钮 */}
        <button
          type="button"
          onClick={toggleAll}
          className="flex items-center gap-2 text-[14px] text-text-sub hover:text-text-primary transition-colors"
        >
          <svg
            className={`w-4 h-4 transition-transform duration-300 ${allCollapsed ? '' : 'rotate-90'}`}
            viewBox="0 0 16 16"
            fill="currentColor"
            style={{ transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }}
          >
            <path d="M6 4l4 4-4 4V4z" />
          </svg>
          <Icon icon="settings" size={18} className="text-[#2563eb]" />
          <span className="font-semibold">执行过程</span>
        </button>

        {/* 统计信息 */}
        <div className="flex items-center gap-2.5 ml-auto text-[13px] text-text-muted">
          {duration !== undefined && duration > 0 && (
            <span>{formatDuration(duration)}</span>
          )}
          <span>
            {totalCalls} 步
            {errorCount > 0 && <span className="text-red-400 ml-1">· {errorCount} 失败</span>}
          </span>
        </div>
      </div>

      {/* 步骤列表 */}
      <div className="p-2.5 space-y-2">
        {steps.map((step) => (
          <StepCard
            key={step.roundIndex}
            step={step}
            expanded={expandedSteps.has(step.roundIndex)}
            onToggle={() => toggleStep(step.roundIndex)}
          />
        ))}
      </div>
    </div>
  );
};

export default AgentWorkflowCard;
