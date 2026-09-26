// ============================================
// WeaveMD — 体积门禁脚本（doc-pipeline B10 七-3）
// 双口径断言：release/*.exe|*.msi ≤500MB、release/win-unpacked ≤1GB，超限直接 fail build。
// 仅本地 stat，不依赖网络；输出 top-N 体积贡献者便于定位回归。
//
// 基线（2026-09-25 源文档 §0 实测）：Setup 147.68MB / win-unpacked 602.1MB / app.asar 287.09MB
// （其中 react-icons 81.9MB、monaco-editor 68.5MB、liteparse Linux 冗余 31.9MB、jieba-wasm 15.4MB）
// B10 瘦身后实测数字见 docs/plan/doc-pipeline.status.md B10 小节。
// ============================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 安装包（*.exe / *.msi）限额：500MB 目标 + 门禁。 */
export const INSTALLER_LIMIT_BYTES = 500 * 1024 * 1024;
/** 安装后（win-unpacked 目录）限额：1GB 硬红线。 */
export const UNPACKED_LIMIT_BYTES = 1024 * 1024 * 1024;
/** top-N 输出条数。 */
const TOP_N = 10;

/**
 * asar 必含项：files 反向排除的"误伤探测"。
 * better-sqlite3 原生件被排除会直接导致应用起不来（七-1② L4 高危点）。
 */
export const ASAR_REQUIRED = [
  'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
];

/**
 * asar / app.asar.unpacked 禁含项：排除 glob 静默失效探测（七-1 / 七-2）。
 * 覆盖：liteparse Linux 原生件、jieba 冗余平台件、better-sqlite3 构建源码、
 * react-icons（Vite 已内联）、monaco-editor（运行时验证为死重后剔除）。
 */
export const ASAR_FORBIDDEN = [
  'node_modules/react-icons/',
  'node_modules/monaco-editor/',
  'node_modules/jieba-wasm/pkg/web/',
  'node_modules/jieba-wasm/pkg/deno/',
  'node_modules/jieba-wasm/pkg/bundler/',
  'node_modules/better-sqlite3/deps/',
  'liteparse.linux-x64-gnu.node',
  'libpdfium.so',
];

/** 字节数 → 二进制 MB 字符串（与源文档口径一致：147.68MB = 154854703B/1024²）。 */
export function formatMB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** 双口径断言：任一条目超限即 ok=false（调用方据此 fail build）。 */
export function evaluateGates(items) {
  const violations = items.filter((item) => item.bytes > item.limitBytes);
  return { ok: violations.length === 0, items, violations };
}

/** 按体积降序取前 N 条体积贡献者。 */
export function topContributors(entries, count) {
  return [...entries].sort((a, b) => b.bytes - a.bytes).slice(0, Math.max(0, count));
}

/** 递归收集目录下所有文件（lstat，不跟随符号链接，防环）。 */
function walkFiles(dir) {
  const result = [];
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
      let names = [];
      try {
        names = fs.readdirSync(current);
      } catch {
        continue;
      }
      for (const name of names) {
        stack.push(path.join(current, name));
      }
    } else if (stat.isFile()) {
      result.push({ path: current, bytes: stat.size });
    }
  }
  return result;
}

/** 目录总字节数（本地 stat，无网络依赖）。 */
export function walkDirSize(dir) {
  return walkFiles(dir).reduce((sum, file) => sum + file.bytes, 0);
}

/** 收集 release 顶层 *.exe / *.msi 安装包（不含子目录，避免误收 win-unpacked 内 exe）。 */
export function collectInstallerArtifacts(releaseDir) {
  if (!fs.existsSync(releaseDir)) return [];
  return fs
    .readdirSync(releaseDir)
    .filter((name) => /\.(exe|msi)$/i.test(name))
    .filter((name) => {
      try {
        return fs.statSync(path.join(releaseDir, name)).isFile();
      } catch {
        return false;
      }
    })
    .map((name) => {
      const filePath = path.join(releaseDir, name);
      return { path: filePath, bytes: fs.statSync(filePath).size };
    });
}

/**
 * 解析 app.asar 头，列出包内全部文件路径与字节。
 * asar 格式：[u32=4][u32 pickle2 总长][u32 pickle2 payload][u32 jsonLen][JSON...]，JSON 自偏移 16 起。
 */
export function readAsarEntries(asarPath) {
  const fd = fs.openSync(asarPath, 'r');
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    if (head.readUInt32LE(0) !== 4) {
      throw new Error(`asar header magic mismatch: ${asarPath}`);
    }
    const jsonLen = head.readUInt32LE(12);
    const jsonBuf = Buffer.alloc(jsonLen);
    fs.readSync(fd, jsonBuf, 0, jsonLen, 16);
    const header = JSON.parse(jsonBuf.toString('utf8'));
    const entries = [];
    const collect = (files, prefix) => {
      if (files == null || typeof files !== 'object') return;
      for (const [name, node] of Object.entries(files)) {
        if (node == null || typeof node !== 'object') continue;
        const nodePath = `${prefix}/${name}`;
        if (node.files != null) {
          collect(node.files, nodePath);
        } else if (typeof node.size === 'number') {
          entries.push({ path: nodePath, size: node.size });
        }
      }
    };
    collect(header.files, '');
    return entries;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 内容断言：必含缺失（误伤）+ 禁含命中（排除失效）。
 * extraPaths 用于并入 app.asar.unpacked 中的物理文件路径。
 */
export function checkAsarContent(entries, extraPaths = []) {
  const all = [...entries.map((entry) => entry.path), ...extraPaths].map((p) =>
    p.replace(/\\/g, '/'),
  );
  const missingRequired = ASAR_REQUIRED.filter(
    (required) => !all.some((p) => p.includes(required)),
  );
  const forbiddenFound = [];
  for (const p of all) {
    for (const forbidden of ASAR_FORBIDDEN) {
      if (p.includes(forbidden)) {
        forbiddenFound.push(p);
        break;
      }
    }
  }
  return { missingRequired, forbiddenFound };
}

/** 收集目录内文件相对路径列表（供 forbidden 断言并入 unpacked）。 */
function collectPathList(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return walkFiles(dir).map((file) => `/${path.relative(base, file.path).replace(/\\/g, '/')}`);
}

/** asar 头条目（size 字段）→ top-N 文件清单（换算为 bytes 口径）。 */
export function topAsarFiles(entries, count) {
  return topContributors(
    entries.map((entry) => ({ path: entry.path, bytes: entry.size })),
    count,
  );
}

/** asar 条目按 node_modules 包聚合（作用域包按 @scope/name 两段）。 */
export function groupAsarEntries(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const segs = entry.path.split('/').slice(1);
    let group;
    if (segs[0] === 'node_modules') {
      const pkg = segs[1] ?? 'unknown';
      group = pkg.startsWith('@') && segs[2] != null
        ? `/node_modules/${pkg}/${segs[2]}`
        : `/node_modules/${pkg}`;
    } else {
      group = `/${segs[0] ?? 'root'}`;
    }
    groups.set(group, (groups.get(group) ?? 0) + entry.size);
  }
  return [...groups.entries()].map(([path, bytes]) => ({ path, bytes }));
}

function printLine(text) {
  process.stdout.write(`${text}\n`);
}

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const releaseDir = path.resolve(scriptDir, '..', 'release');
  const unpackedDir = path.join(releaseDir, 'win-unpacked');
  const asarPath = path.join(unpackedDir, 'resources', 'app.asar');
  const unpackedResources = path.join(unpackedDir, 'resources', 'app.asar.unpacked');

  const installers = collectInstallerArtifacts(releaseDir);
  const hasUnpacked = fs.existsSync(unpackedDir);
  const items = installers.map((installer) => ({
    name: path.basename(installer.path),
    path: installer.path,
    bytes: installer.bytes,
    limitBytes: INSTALLER_LIMIT_BYTES,
  }));
  if (hasUnpacked) {
    const bytes = walkDirSize(unpackedDir);
    items.push({
      name: 'win-unpacked/',
      path: unpackedDir,
      bytes,
      limitBytes: UNPACKED_LIMIT_BYTES,
    });
  }

  if (items.length === 0 && !fs.existsSync(asarPath)) {
    printLine('sizeGate: no release artifacts found, skipping (run npm run build first).');
    return 0;
  }

  printLine('== WeaveMD size gate (七-3) ==');
  printLine(
    `baseline 2026-09-25: Setup 147.68MB / win-unpacked 602.1MB / app.asar 287.09MB`,
  );
  printLine('limits: installer <=500MB, win-unpacked <=1GB');

  for (const item of items) {
    const limitMB = (item.limitBytes / (1024 * 1024)).toFixed(0);
    const status = item.bytes > item.limitBytes ? 'FAIL' : 'ok';
    printLine(`  [${status}] ${item.name}: ${formatMB(item.bytes)} (limit ${limitMB}MB)`);
  }

  // asar 内容断言（误伤探测 + 排除失效探测）
  let content = { missingRequired: [], forbiddenFound: [] };
  if (fs.existsSync(asarPath)) {
    const entries = readAsarEntries(asarPath);
    const unpackedPaths = collectPathList(unpackedResources);
    content = checkAsarContent(entries, unpackedPaths);
    for (const required of content.missingRequired) {
      printLine(`  [FAIL] required missing (files 排除误伤?): ${required}`);
    }
    const MAX_FORBIDDEN_PRINT = 20;
    content.forbiddenFound.slice(0, MAX_FORBIDDEN_PRINT).forEach((forbidden) => {
      printLine(`  [FAIL] forbidden present (排除 glob 静默失效?): ${forbidden}`);
    });
    if (content.forbiddenFound.length > MAX_FORBIDDEN_PRINT) {
      printLine(
        `  [FAIL] ... and ${content.forbiddenFound.length - MAX_FORBIDDEN_PRINT} more forbidden files`,
      );
    }

    // top-N 体积贡献者
    printLine('-- top asar files --');
    for (const entry of topAsarFiles(entries, TOP_N)) {
      printLine(`  ${formatMB(entry.bytes).padStart(12)}  ${entry.path}`);
    }
    printLine('-- top asar groups --');
    for (const group of topContributors(groupAsarEntries(entries), TOP_N)) {
      printLine(`  ${formatMB(group.bytes).padStart(12)}  ${group.path}`);
    }
  }
  if (hasUnpacked) {
    printLine('-- top win-unpacked files --');
    for (const file of topContributors(walkFiles(unpackedDir), TOP_N)) {
      const rel = path.relative(releaseDir, file.path).replace(/\\/g, '/');
      printLine(`  ${formatMB(file.bytes).padStart(12)}  ${rel}`);
    }
  }

  const gate = evaluateGates(items);
  const contentOk = content.missingRequired.length === 0 && content.forbiddenFound.length === 0;
  if (gate.ok && contentOk) {
    printLine('size gate PASSED');
    return 0;
  }
  for (const violation of gate.violations) {
    printLine(
      `size gate VIOLATION: ${violation.name} ${formatMB(violation.bytes)} > ${formatMB(violation.limitBytes)}`,
    );
  }
  printLine('size gate FAILED');
  return 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  process.exit(main());
}
