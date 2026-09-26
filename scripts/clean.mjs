// ============================================
// WeaveMD — 构建产物清理脚本（doc-pipeline B10 七-1）
// vite-plugin-electron 不清空 outDir，dist-main 历史哈希分片持续累积
// （2026-09-27 实测 211 个文件约 176MB，其中 index-*.js 哈希分片 204 份），
// 且 build.files 配了 dist-main/**/*，不清则全部打进安装包。
// prebuild 钩子自动执行；vite build 会重新生成全部产物。
// ============================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
// 只清完全由构建生成的目录；public/、release/ 不动
const TARGETS = ['dist-main', 'dist-render'];

for (const name of TARGETS) {
  const dir = path.join(projectRoot, name);
  if (!fs.existsSync(dir)) continue;
  let fileCount = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) stack.push(path.join(current, entry));
    } else {
      fileCount += 1;
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  process.stdout.write(`[clean] removed ${name}/ (${fileCount} files)\n`);
}
