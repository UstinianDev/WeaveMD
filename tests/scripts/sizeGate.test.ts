// ============================================
// WeaveMD — scripts/sizeGate 体积门禁单测（doc-pipeline B10 七-3）
// 双口径断言：release/*.exe|*.msi ≤500MB、release/win-unpacked ≤1GB，超限 fail build。
// 基线（2026-09-25 源文档 §0 实测）：Setup 147.68MB / win-unpacked 602.1MB / app.asar 287.09MB。
// 门禁只做本地 stat，不依赖网络。
// ============================================
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ASAR_FORBIDDEN,
  ASAR_REQUIRED,
  INSTALLER_LIMIT_BYTES,
  UNPACKED_LIMIT_BYTES,
  checkAsarContent,
  collectInstallerArtifacts,
  evaluateGates,
  formatMB,
  groupAsarEntries,
  readAsarEntries,
  topAsarFiles,
  topContributors,
  walkDirSize,
} from '../../scripts/sizeGate.mjs';

/** 构造最小合法 asar 字节流（pickle 头 + JSON 头 + 伪数据区）。 */
function buildAsarBuffer(header: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const jsonPadded = (json.length + 3) & ~3;
  const p2Payload = 4 + jsonPadded;
  const p2Total = 4 + p2Payload;
  const buf = Buffer.alloc(8 + p2Total + 16);
  buf.writeUInt32LE(4, 0);
  buf.writeUInt32LE(p2Total, 4);
  buf.writeUInt32LE(p2Payload, 8);
  buf.writeUInt32LE(json.length, 12);
  json.copy(buf, 16);
  buf.write('DATA', 8 + p2Total);
  return buf;
}

const tmpDirs: string[] = [];
function mkTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sizegate-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    fs.rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
  }
});

describe('sizeGate — 双口径限额（七-3②）', () => {
  it('安装包限额 500MB、win-unpacked 限额 1GB（二进制 MB）', () => {
    expect(INSTALLER_LIMIT_BYTES).toBe(500 * 1024 * 1024);
    expect(UNPACKED_LIMIT_BYTES).toBe(1024 * 1024 * 1024);
  });

  it('formatMB 输出二进制 MB 保留两位小数', () => {
    expect(formatMB(147.68 * 1024 * 1024)).toBe('147.68 MB');
    expect(formatMB(0)).toBe('0.00 MB');
  });

  it('全部低于限额 → ok，无 violations', () => {
    const result = evaluateGates([
      { name: 'Setup.exe', path: '/r/Setup.exe', bytes: 400 * 1024 * 1024, limitBytes: INSTALLER_LIMIT_BYTES },
      { name: 'win-unpacked', path: '/r/win-unpacked', bytes: 900 * 1024 * 1024, limitBytes: UNPACKED_LIMIT_BYTES },
    ]);
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('任一超限 → ok=false 且 violations 精确命中该条目（fail build 依据）', () => {
    const over = { name: 'Setup.exe', path: '/r/Setup.exe', bytes: 501 * 1024 * 1024, limitBytes: INSTALLER_LIMIT_BYTES };
    const under = { name: 'win-unpacked', path: '/r/win-unpacked', bytes: 600 * 1024 * 1024, limitBytes: UNPACKED_LIMIT_BYTES };
    const result = evaluateGates([under, over]);
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.name).toBe('Setup.exe');
    expect(result.violations[0]?.bytes).toBeGreaterThan(result.violations[0]?.limitBytes ?? 0);
  });
});

describe('sizeGate — top-N 体积贡献者（七-3②）', () => {
  it('按体积降序取前 N 条', () => {
    const entries = [
      { path: '/a', bytes: 10 },
      { path: '/b', bytes: 500 },
      { path: '/c', bytes: 50 },
      { path: '/d', bytes: 5000 },
    ];
    expect(topContributors(entries, 2)).toEqual([
      { path: '/d', bytes: 5000 },
      { path: '/b', bytes: 500 },
    ]);
  });

  it('N 大于条目数时返回全部', () => {
    expect(topContributors([{ path: '/a', bytes: 1 }], 5)).toHaveLength(1);
  });

  it('topAsarFiles 按 asar 头 size 字段排序（不是惰性保持插入序）', () => {
    const entries = [
      { path: '/package.json', size: 1286 },
      { path: '/node_modules/big/a.js', size: 5 * 1024 * 1024 },
      { path: '/dist-render/index.html', size: 300 },
    ];
    expect(topAsarFiles(entries, 2)).toEqual([
      { path: '/node_modules/big/a.js', bytes: 5 * 1024 * 1024 },
      { path: '/package.json', bytes: 1286 },
    ]);
  });

  it('groupAsarEntries 普通包按顶层包聚合（修复 node_modules 双前缀）', () => {
    const groups = groupAsarEntries([
      { path: '/node_modules/jieba-wasm/pkg/nodejs/jieba_rs_wasm_bg.wasm', size: 4000000 },
      { path: '/node_modules/jieba-wasm/package.json', size: 1000 },
    ]);
    expect(groups).toEqual([{ path: '/node_modules/jieba-wasm', bytes: 4001000 }]);
  });

  it('groupAsarEntries 作用域包按 @scope/name 聚合', () => {
    const groups = groupAsarEntries([
      { path: '/node_modules/@llamaindex/liteparse/dist/lib.js', size: 100 },
      { path: '/node_modules/@llamaindex/liteparse-win32-x64-msvc/package.json', size: 200 },
      { path: '/dist-render/assets/index.js', size: 50 },
    ]);
    expect(groups).toEqual(
      expect.arrayContaining([
        { path: '/node_modules/@llamaindex/liteparse', bytes: 100 },
        { path: '/node_modules/@llamaindex/liteparse-win32-x64-msvc', bytes: 200 },
        { path: '/dist-render', bytes: 50 },
      ]),
    );
  });
});

describe('sizeGate — 本地 stat IO', () => {
  it('walkDirSize 递归求和所有文件字节', () => {
    const dir = mkTmpDir();
    fs.writeFileSync(path.join(dir, 'a.txt'), Buffer.alloc(10));
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'b.bin'), Buffer.alloc(20));
    expect(walkDirSize(dir)).toBe(30);
  });

  it('collectInstallerArtifacts 只收 release 顶层 *.exe / *.msi', () => {
    const dir = mkTmpDir();
    fs.writeFileSync(path.join(dir, 'WeaveMD-Setup-1.0.exe'), Buffer.alloc(5));
    fs.writeFileSync(path.join(dir, 'WeaveMD-1.0.msi'), Buffer.alloc(6));
    fs.writeFileSync(path.join(dir, 'latest.yml'), Buffer.alloc(2));
    fs.mkdirSync(path.join(dir, 'win-unpacked'));
    fs.writeFileSync(path.join(dir, 'win-unpacked', 'WeaveMD.exe'), Buffer.alloc(9));
    const items = collectInstallerArtifacts(dir);
    expect(items.map((i) => path.basename(i.path)).sort()).toEqual(['WeaveMD-1.0.msi', 'WeaveMD-Setup-1.0.exe']);
    expect(items.every((i) => i.bytes > 0)).toBe(true);
  });

  it('readAsarEntries 解析 asar 头列出全部文件与字节', () => {
    const dir = mkTmpDir();
    const asarPath = path.join(dir, 'app.asar');
    fs.writeFileSync(
      asarPath,
      buildAsarBuffer({
        files: {
          'dist-render': { files: { 'index.html': { size: 3 } } },
          'node_modules': {
            files: {
              'react-icons': { files: { 'index.mjs': { size: 100 } } },
              'better-sqlite3': {
                files: { build: { files: { Release: { files: { 'better_sqlite3.node': { size: 50 } } } } } },
              },
            },
          },
        },
      }),
    );
    const entries = readAsarEntries(asarPath);
    expect(entries).toEqual(
      expect.arrayContaining([
        { path: '/dist-render/index.html', size: 3 },
        { path: '/node_modules/react-icons/index.mjs', size: 100 },
        { path: '/node_modules/better-sqlite3/build/Release/better_sqlite3.node', size: 50 },
      ]),
    );
    expect(entries).toHaveLength(3);
  });
});

describe('sizeGate — asar 内容黑名单/白名单（防误伤 + 防排失效）', () => {
  const okEntries = [
    { path: '/node_modules/better-sqlite3/build/Release/better_sqlite3.node' },
    { path: '/node_modules/electron-updater/out/main.js' },
    { path: '/dist-render/index.html' },
  ];

  it('全部排除生效且必需件在位 → 无缺失、无禁含', () => {
    const report = checkAsarContent(okEntries);
    expect(report.missingRequired).toEqual([]);
    expect(report.forbiddenFound).toEqual([]);
  });

  it('better-sqlite3 原生件缺失 → 命中 missingRequired（files 排除误伤探测）', () => {
    const report = checkAsarContent([{ path: '/dist-render/index.html' }]);
    expect(report.missingRequired.some((p) => p.includes('better_sqlite3.node'))).toBe(true);
  });

  it('禁含项重新出现（glob 静默失效）→ 命中 forbiddenFound', () => {
    const report = checkAsarContent([
      ...okEntries,
      { path: '/node_modules/react-icons/md/index.mjs' },
      { path: '/node_modules/@llamaindex/liteparse/libpdfium.so' },
    ]);
    expect(report.forbiddenFound.some((p) => p.includes('react-icons'))).toBe(true);
    expect(report.forbiddenFound.some((p) => p.includes('libpdfium.so'))).toBe(true);
  });

  it('unpacked 目录中的禁含文件同样命中（检查对象含 asar.unpacked）', () => {
    const report = checkAsarContent(okEntries, ['/resources/app.asar.unpacked/x/libpdfium.so']);
    expect(report.forbiddenFound.some((p) => p.includes('libpdfium.so'))).toBe(true);
  });

  it('ASAR_REQUIRED 含 better_sqlite3.node（七-1② 高危点防误伤）', () => {
    expect(ASAR_REQUIRED.some((p) => p.includes('better_sqlite3.node'))).toBe(true);
  });

  it('ASAR_FORBIDDEN 覆盖四项瘦身 + monaco 死重（七-1/七-2）', () => {
    const fragments = [
      'node_modules/react-icons/',
      'node_modules/monaco-editor/',
      'node_modules/jieba-wasm/pkg/web/',
      'node_modules/jieba-wasm/pkg/deno/',
      'node_modules/jieba-wasm/pkg/bundler/',
      'node_modules/better-sqlite3/deps/',
      'liteparse.linux-x64-gnu.node',
      'libpdfium.so',
    ];
    for (const frag of fragments) {
      expect(ASAR_FORBIDDEN, `ASAR_FORBIDDEN 应包含 ${frag}`).toContain(frag);
    }
  });
});
