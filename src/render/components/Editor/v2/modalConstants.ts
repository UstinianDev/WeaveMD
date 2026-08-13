// ============================================
// WeaveMD Editor v2 — 弹层共享常量
// ============================================
// InsertUrlModal 与 ImageEditTool 共用：URL 空值校验文案。
// 两组件各自维护 Escape 关闭 / open reset / error 清空逻辑（props 差异大，
// M 级不抽共享 hook），仅收敛重复字面量到单一来源。

/** URL 输入为空时的校验提示（InsertUrlModal / ImageEditTool 共用） */
export const EMPTY_URL_MESSAGE = 'URL 不能为空';
