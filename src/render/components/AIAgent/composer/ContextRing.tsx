// ============================================
// WeaveMD — 圆环形上下文指示器
// ============================================
// 类似 opencode 的上下文检测组件：
// - 圆环形，从零点方向（12 点钟）顺时针显示
// - 鼠标悬停显示上下文占比
// - 颜色随比例变化（绿<50% / 黄50-80% / 红>80%）

import React from 'react';

interface ContextRingProps {
  /** 已使用的 token 数量 */
  usedTokens: number;
  /** 最大 token 数量 */
  maxTokens: number;
  /** 使用比例 (0-1) */
  ratio: number;
  /** 工具提示文本 */
  tooltip: string;
  /** 圆环尺寸（px），默认 24 */
  size?: number;
}

/** 根据比例返回环形颜色（CSS 变量） */
const getRingColor = (ratio: number): string => {
  if (ratio > 0.8) return 'var(--color-red-500, #ef4444)';
  if (ratio > 0.5) return 'var(--color-yellow-500, #eab308)';
  return 'var(--color-green-500, #22c55e)';
};

const ContextRing: React.FC<ContextRingProps> = ({
  usedTokens,
  maxTokens,
  ratio,
  tooltip,
  size = 24,
}) => {
  // 圆环参数
  const strokeWidth = size <= 20 ? 2.5 : 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  // 从零点（12点钟）顺时针：stroke-dashoffset 从 circumference（0%）到 0（100%）
  const dashoffset = circumference * (1 - Math.min(ratio, 1));
  const color = getRingColor(ratio);

  // 格式化显示文本
  const displayText =
    usedTokens >= 1000 ? `${Math.round(usedTokens / 1000)}k` : String(usedTokens);

  return (
    <div className="relative flex items-center gap-1 ml-1 cursor-help group">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="transform -rotate-90"
      >
        {/* 背景环 */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border, #e5e7eb)"
          strokeWidth={strokeWidth}
        />
        {/* 进度环 */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={dashoffset}
          strokeLinecap="round"
          className="transition-all duration-300 ease-in-out"
        />
      </svg>
      <span className="text-[11px] text-text-muted">{displayText}</span>
      {/* 悬停提示 */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-bg-quaternary text-text-primary text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
        {tooltip}
      </div>
    </div>
  );
};

export default ContextRing;
