// ============================================
// WeaveMD — 结构化任务拆分计划（agent-multi-intent 任务 1）
// ============================================
// 拆分结果必须随 AgentInteractionPayload（拆分确认卡）跨 main→render 下发，
// 渲染层不能 import @main，故类型放在 shared；严格校验器与 Schema 字面量
// 只被主进程消费，见 src/main/ai/agent/taskPlannerSchema.ts。

import type { IntentName } from './agent';

/** 单个子任务定义（拆分确认卡与子任务链的最小执行单元）。 */
export interface SubtaskDef {
  /** 子任务唯一标识（如 s1/s2），链内引用与串行标注用。 */
  id: string;
  intent: IntentName;
  /** 具体动作动词（如 search / write / summarize）。 */
  action: string;
  /** 操作对象（文件路径、知识库查询词或话题）。 */
  object: string;
  /** 工具参数字典（宽松放行，校验层仅要求对象）。 */
  params?: Record<string, string | number | boolean>;
  /** 确信度，归一到 [0,1]（只驱动追问，不参与轮次分配）。 */
  confidence: number;
  /** read=只读；write=会写入文件或笔记（铁律一确认范围）。 */
  rw: 'read' | 'write';
  /** 执行前置条件（normalizeTaskPlan 会给不同对象写追加 serial_after 标注）。 */
  preconditions?: string[];
  /** 低置信子任务需先向用户追问（任务 3 消费）。 */
  needsClarification?: boolean;
}

/** LLM 结构化拆分出参（parseTaskPlan 校验 + normalizeTaskPlan 规范化后的形状）。 */
export interface AgentTaskPlan {
  subtasks: SubtaskDef[];
  /** 超过 5 条上限被截断的子任务数（normalizeTaskPlan 生成，未截断时缺省）。 */
  omittedCount?: number;
  /** 整次输入的主意图（拆分前 classifyIntent 结果，Schema 出参可省）。 */
  primaryIntent?: IntentName;
}
