// ============================================
// doc-pipeline B12 — Docling PoC 对比 runner（可插拔后端）
// 后端接口：Backend = { name, run(samplePath) => { markdown, coldMs, warmMs?, notes } }
//   - aRoute   : @llamaindex/liteparse textItems → src/main/ai/files/pdfLayout.analyzePdfLayout（A 路线现状）
//   - docling  : docling.rs（docling-rs Node 绑定）+ 本目录 .models/.pdfium（按需下载，零进包）
// 量化四项：双栏阅读顺序正确率 / 表格行列还原准确率 / 单页解析耗时 / 装机体积增量
// 用法：node runPoc.mjs [--backend=aRoute|docling|all]
// ============================================
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// docling 按 cwd 解析 ./models 与 ./.pdfium —— 固定工作目录
process.chdir(__dirname);

const SAMPLE = path.join(__dirname, 'sample.pdf');
const TRUTH = JSON.parse(fs.readFileSync(path.join(__dirname, 'sample-truth.json'), 'utf-8'));
const ROOT = path.resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// 通用评估
// ---------------------------------------------------------------------------

function normalizeCell(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

/** 解析 markdown 中全部管道表格（起始行 + 紧随分隔行的连续行组）。 */
function parseMdTables(markdown) {
  const lines = markdown.split(/\r?\n/);
  const isRow = /^\s*\|.*\|\s*$/;
  const isSep = /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/;
  const tables = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!isRow.test(lines[i]) || i + 1 >= lines.length || !isSep.test(lines[i + 1])) continue;
    const rows = [];
    let j = i;
    while (j < lines.length && isRow.test(lines[j])) {
      if (j !== i + 1) {
        // 跳过分隔行（| --- |），只收数据行
        const raw = lines[j].trim().replace(/^\|/, '').replace(/\|$/, '');
        rows.push(raw.split('|').map((c) => normalizeCell(c)));
      }
      j += 1;
    }
    if (rows.length >= 2) tables.push(rows);
    i = j - 1;
  }
  return tables;
}

/**
 * 表格行列还原准确率（单元格级）：按表头定位真值表；
 * 行数不足时吸收其后的续表（docling 跨页可能不合并——按真值行数截断合并）。
 */
function tableAccuracy(markdown, gtTables) {
  const tables = parseMdTables(markdown);
  const detail = [];
  let matched = 0;
  let total = 0;
  for (const gt of gtTables) {
    const gtHeader = gt.rows[0].map(normalizeCell);
    const startIdx = tables.findIndex(
      (t) => t[0].length === gtHeader.length && t[0].every((c, i) => c === gtHeader[i])
    );
    if (startIdx < 0) {
      detail.push({ name: gt.name, found: false, score: 0 });
      total += gt.rows.length * gtHeader.length;
      continue;
    }
    let rows = [...tables[startIdx]];
    for (let k = startIdx + 1; k < tables.length && rows.length < gt.rows.length; k += 1) {
      rows = rows.concat(tables[k]);
    }
    rows = rows.slice(0, gt.rows.length);
    let hit = 0;
    let cells = 0;
    for (let r = 0; r < gt.rows.length; r += 1) {
      for (let c = 0; c < gtHeader.length; c += 1) {
        cells += 1;
        const actual = rows[r]?.[c] ?? '';
        if (actual === normalizeCell(gt.rows[r][c])) hit += 1;
      }
    }
    matched += hit;
    total += cells;
    detail.push({ name: gt.name, found: true, rows: rows.length, hit, cells });
  }
  return { accuracy: total > 0 ? matched / total : 0, matched, total, detail };
}

/**
 * 双栏阅读顺序正确率：期望相邻标记对 (a,b) 在输出中保持相对先后的比例。
 * 全部标记缺失或乱序均计失败。
 */
function readingOrderAccuracy(markdown, expected) {
  const seq = [];
  const re = /\b([LR]\d{2})\b/g;
  let m;
  while ((m = re.exec(markdown)) !== null) seq.push(m[1]);
  const pos = new Map();
  for (let i = 0; i < seq.length; i += 1) if (!pos.has(seq[i])) pos.set(seq[i], i);
  let pass = 0;
  const misses = [];
  for (let i = 0; i + 1 < expected.length; i += 1) {
    const a = pos.get(expected[i]);
    const b = pos.get(expected[i + 1]);
    if (a !== undefined && b !== undefined && a < b) pass += 1;
    else misses.push(`${expected[i]}>${expected[i + 1]}`);
  }
  const pairs = expected.length - 1;
  return { accuracy: pairs > 0 ? pass / pairs : 0, pass, pairs, missing: misses.length, sampleMiss: misses.slice(0, 5) };
}

// ---------------------------------------------------------------------------
// 后端 A：liteparse + pdfLayout（现状 A 路线）
// ---------------------------------------------------------------------------

async function loadPdfLayout() {
  const esbuild = await import('esbuild');
  const entry = path.join(ROOT, 'src', 'main', 'ai', 'files', 'pdfLayout.ts');
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

async function runARoute() {
  const notes = [];
  const layoutMod = await loadPdfLayout();
  const lite = await import('@llamaindex/liteparse');
  const LiteParse = lite.LiteParse ?? lite.default;
  const buffer = fs.readFileSync(SAMPLE);

  const t0 = performance.now();
  const reader = new LiteParse({ outputFormat: 'text', ocrEnabled: false, quiet: true, keepHeadersFooters: true });
  const result = await reader.parse(new Uint8Array(buffer));
  const t1 = performance.now();
  const pages = result.pages.map((pg) => ({
    pageNum: pg.pageNum,
    width: pg.width,
    height: pg.height,
    items: (pg.textItems ?? []).map((ti) => ({
      text: ti.text,
      x: ti.x,
      y: ti.y,
      width: ti.width,
      height: ti.height,
      ...(ti.fontName != null ? { fontName: ti.fontName } : {}),
      ...(ti.fontSize != null ? { fontSize: ti.fontSize } : {}),
    })),
  }));
  const layout = layoutMod.analyzePdfLayout(pages);
  const t2 = performance.now();
  notes.push(`liteparse=${(t1 - t0).toFixed(1)}ms layout=${(t2 - t1).toFixed(1)}ms pages=${pages.length}`);
  notes.push(`signals=${JSON.stringify(layout.analysis)}`);
  notes.push(`headersFooters=${JSON.stringify(layout.metadata.headersFooters)}`);
  return {
    name: 'aRoute',
    markdown: layout.text,
    pageCount: pages.length,
    coldMs: t2 - t0,
    warmMs: t2 - t0, // A 路线无模型冷启动，单次即稳态
    notes,
  };
}

// ---------------------------------------------------------------------------
// 后端 B：docling.rs（可插拔新后端）
// ---------------------------------------------------------------------------

async function runDocling() {
  const notes = [];
  const dl = await import('docling.rs');
  const deps = typeof dl.checkDependencies === 'function' ? dl.checkDependencies() : null;
  if (deps) notes.push(`deps=${JSON.stringify({ home: deps.home, ready: deps.ready, missing: deps.missing })}`);

  const t0 = performance.now();
  await dl.convertFileAsync(SAMPLE, { to: 'markdown' });
  const t1 = performance.now();
  notes.push(`cold(one-shot, 含管线+模型加载)=${(t1 - t0).toFixed(1)}ms`);

  // 热管线：Pipeline 复用模型，计时取第 2 次
  const pipeline = new dl.Pipeline({ strict: true });
  await pipeline.convertFileAsync(SAMPLE, { to: 'markdown' });
  const t2 = performance.now();
  const warm = await pipeline.convertFileAsync(SAMPLE, { to: 'markdown' });
  const t3 = performance.now();
  notes.push(`pipeline 首次(加载)=${(t2 - t0).toFixed(1)}ms warm=${(t3 - t2).toFixed(1)}ms`);

  return {
    name: 'docling',
    markdown: warm.content,
    pageCount: TRUTH.pageCount,
    coldMs: t1 - t0,
    warmMs: t3 - t2,
    notes,
  };
}

const BACKENDS = { aRoute: runARoute, docling: runDocling };

// ---------------------------------------------------------------------------
// 体积评估
// ---------------------------------------------------------------------------

function dirBytes(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    let st;
    try {
      st = fs.lstatSync(cur);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(cur)) stack.push(path.join(cur, name));
    } else total += st.size;
  }
  return total;
}

function gzipBytes(file) {
  const buf = fs.readFileSync(file);
  return zlib.gzipSync(buf, { level: 9 }).length;
}

function mb(bytes) {
  return +(bytes / (1024 * 1024)).toFixed(2);
}

function sizeReport() {
  const nm = path.join(__dirname, 'node_modules');
  const jsPkg = dirBytes(path.join(nm, 'docling.rs'));
  const nativePkgDir = path.join(nm, 'docling.rs-win32-x64-msvc');
  const nativePkg = dirBytes(nativePkgDir);
  const nativeNode = path.join(nativePkgDir, 'docling-rs.win32-x64-msvc.node');
  const gzipNative = fs.existsSync(nativeNode) ? gzipBytes(nativeNode) : 0;
  const models = dirBytes(path.join(__dirname, '.models'));
  const pdfium = dirBytes(path.join(__dirname, '.pdfium'));

  // 装机口径：docling 后端若转正，进包的只有 JS 壳 + win32 原生件（asarUnpack）
  const packagedUnpacked = jsPkg + nativePkg;
  const installerDeltaEst = gzipNative + jsPkg; // NSIS/LZMA ≈ gzip -9 量级，作估算下限口径

  // 现状基线（release 实测，B10 后）
  const setupFile = fs.readdirSync(path.join(ROOT, 'release'))
    .find((f) => /^WeaveMD-Setup-.*\.exe$/.test(f));
  const setupNow = setupFile ? fs.statSync(path.join(ROOT, 'release', setupFile)).size : 0;
  const unpackedNow = fs.existsSync(path.join(ROOT, 'release', 'win-unpacked'))
    ? dirBytes(path.join(ROOT, 'release', 'win-unpacked'))
    : 0;

  const GATE_INSTALLER = 500 * 1024 * 1024;
  const GATE_UNPACKED = 1024 * 1024 * 1024;
  const projectedSetup = setupNow + installerDeltaEst;
  const projectedUnpacked = unpackedNow + packagedUnpacked;

  return {
    packaged: {
      'docling.rs (JS壳, unpacked)': mb(jsPkg),
      'docling.rs-win32-x64-msvc (原生件, unpacked)': mb(nativePkg),
      '原生件 gzip -9 (安装包增量估算下限)': mb(gzipNative),
      '进包合计 (unpacked)': mb(packagedUnpacked),
      '安装包增量估算': mb(installerDeltaEst),
    },
    devOnly: {
      '.models (模型, 零进包)': mb(models),
      '.pdfium (pdfium, 零进包)': mb(pdfium),
    },
    baseline: {
      '当前 Setup (实测)': mb(setupNow),
      '当前 win-unpacked (实测)': mb(unpackedNow),
    },
    projection: {
      'Setup + 增量估算': mb(projectedSetup),
      'Setup 门禁 500MB': { pass: projectedSetup <= GATE_INSTALLER },
      'win-unpacked + 增量': mb(projectedUnpacked),
      'win-unpacked 门禁 1GB': { pass: projectedUnpacked <= GATE_UNPACKED },
    },
  };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
  const arg = process.argv.find((a) => a.startsWith('--backend='));
  const which = arg ? arg.split('=')[1] : 'all';
  const names = which === 'all' ? Object.keys(BACKENDS) : [which];

  const results = {};
  for (const name of names) {
    if (!BACKENDS[name]) throw new Error(`unknown backend: ${name}`);
    try {
      results[name] = await BACKENDS[name]();
    } catch (err) {
      results[name] = { name, error: err instanceof Error ? err.message : String(err), notes: [] };
    }
  }

  const evaluation = {};
  for (const [name, r] of Object.entries(results)) {
    if (r.error) {
      evaluation[name] = { error: r.error };
      continue;
    }
    // 原始产物留档（报告对照证据）
    fs.writeFileSync(path.join(__dirname, `out-${name}.md`), r.markdown);
    const pages = r.pageCount || 1;
    evaluation[name] = {
      readingOrder: readingOrderAccuracy(r.markdown, TRUTH.readingOrderMarkers),
      tables: tableAccuracy(r.markdown, TRUTH.tables),
      timing: {
        coldMs: +r.coldMs.toFixed(1),
        warmMs: r.warmMs != null ? +r.warmMs.toFixed(1) : null,
        pageCount: pages,
        warmMsPerPage: r.warmMs != null ? +(r.warmMs / pages).toFixed(1) : null,
      },
      markdownBytes: Buffer.byteLength(r.markdown),
      notes: r.notes,
    };
  }

  const report = {
    sample: path.basename(SAMPLE),
    truth: { pages: TRUTH.pageCount, markers: TRUTH.readingOrderMarkers.length, tables: TRUTH.tables.length },
    evaluation,
    size: sizeReport(),
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(__dirname, 'poc-result.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
