# 审查报告：image-media-display-fix

> 日期：2026-08-11 | 审查范围：工作树 diff（src/main/index.ts、src/main/media-protocol.ts、tests/main/mediaProtocol.test.ts、docs）

## 结论

**无 Critical / High / Medium / Low 问题。** 改动为单点主进程特权配置 + 回归单测 + 文档同步，范围受控。

## 审查关注点逐项

| 关注点 | 结论 |
|---|---|
| 缺少测试 | 无。新增特权集断言（无 standard）直接防本 bug 回归；既有 decodeMediaUrl/toImgSrc 单测继续有效；Electron 隔离复现 + Playwright `_electron` 真机验证（LOAD:1x1）留档 |
| 安全回退 | 无。未引入 `bypassCSP`；`secure:true` 保持；非 standard 仅影响 URL 解析方式，不涉及认证/权限/数据 |
| 绕过权限 | 无。未触碰认证/权限代码 |
| 记录敏感信息 | 无新增日志 |
| 密钥泄漏 | 无。`git diff` 复查无密钥/路径硬编码敏感物 |
| N+1 查询 | 不适用（无数据库变更） |
| 数据迁移风险 | 无迁移 |
| 部署风险 | 需重启主进程生效（dev 下 vite-plugin-electron 自动重启）；生产部署需重新构建 |
| 修改无关文件 | 无。仅任务相关 3 个源文件 + 2 个文档；`e2e/drag-selection-markers.spec.ts` 未改动 |

## 正向发现（已核验）

1. **根因定位精确**：隔离 Electron 实验证明 `standard:true` 下 `media://C%3A/...`（host 解码为 `C:` 非法）请求不达 handler（`request.url=[]`），去 `standard` 后原样透传并 LOAD——非猜测，实证。
2. **修复最小化**：URL 形态、`decodeMediaUrl`、渲染层 `toImgSrc` 全部保持，仅主进程特权集去 `standard`；既有 716 单测零改动仍全绿。
3. **回归保护到位**：特权集下沉为 `MEDIA_SCHEME_PRIVILEGES` 常量 + 单测断言无 `standard`，未来若有人按旧文档加回会立刻红。
4. **契约文档同步**：`docs/plan/editor-link-image-fix.plan.md`、`docs/requirements/editor-link-image-fix.req.md` 特权描述已更新并标注修正原因。

## 验证证据

vitest 718 passed（41 files）；tsc 0 error；eslint 0 error；vite build 通过（dist-main 核验不含 standard）；playwright 54 passed / 5 failed（全部为 `drag-selection-markers` 既有「当前 RED」）；Playwright `_electron` 真机 `RESULT:LOAD:1x1`。
