// ============================================
// doc-pipeline B12 — 样例 PDF 生成（PoC 真值基准）
// 产出 sample.pdf：
//   P1 全宽标题 + 双栏散文（L01..L20 / R01..R20 阅读顺序标记）
//   P2 标题 + 无框线表格(4x3, Item/Q3/Q4) + 单栏散文 A01..A03
//   P3 标题 + 跨页表格上半(表头+D1..D4)
//   P4 表格下半(D5..D8, 锚点对齐) + 收尾散文 Z01..Z02
// 真值（ground truth）一并写入 sample-truth.json。
// ============================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PAGE_W = 612;
const PAGE_H = 792;
const LEFT_X = 54;
const RIGHT_X = 318;
const COL_MAX_W = 240; // 左栏文本不得越过 gutter(≈299)，防全宽标题/文本桥接吞掉分栏空洞
const FILLER = 'the quick brown fox jumps over the lazy dog';

const GT_TABLE1 = [
  ['Item', 'Q3', 'Q4'],
  ['Alpha', '120', '145'],
  ['Beta', '98', '103'],
  ['Gamma', '215', '199'],
];

const GT_TABLE2 = [
  ['Region', 'Product', 'Q3', 'Q4', 'Delta'],
  ['North', 'Widget', '120', '145', '+25'],
  ['North', 'Gadget', '98', '103', '+5'],
  ['South', 'Widget', '215', '199', '-16'],
  ['South', 'Gadget', '77', '86', '+9'],
  ['East', 'Widget', '142', '150', '+8'],
  ['East', 'Gadget', '65', '71', '+6'],
  ['West', 'Widget', '188', '205', '+17'],
  ['West', 'Gadget', '90', '88', '-2'],
];

function markerLine(prefix, i) {
  return `${prefix}${String(i).padStart(2, '0')} ${FILLER}`;
}

async function main() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0, 0, 0);

  // --- P1: 标题 + 双栏 ---
  const p1 = doc.addPage([PAGE_W, PAGE_H]);
  const title = 'Docling PoC Sample';
  const titleW = bold.widthOfTextAtSize(title, 18);
  if (LEFT_X + titleW >= RIGHT_X - 10) {
    throw new Error(`title bridges gutter: width=${titleW.toFixed(1)}`);
  }
  p1.drawText(title, { x: LEFT_X, y: 750, size: 18, font: bold, color: black });
  for (let i = 1; i <= 20; i += 1) {
    const y = 700 - (i - 1) * 14;
    const left = markerLine('L', i);
    const right = markerLine('R', i);
    if (font.widthOfTextAtSize(left, 10) > COL_MAX_W) throw new Error(`left line too wide: ${left}`);
    if (RIGHT_X + font.widthOfTextAtSize(right, 10) > PAGE_W - 54) throw new Error(`right line too wide: ${right}`);
    p1.drawText(left, { x: LEFT_X, y, size: 10, font, color: black });
    p1.drawText(right, { x: RIGHT_X, y, size: 10, font, color: black });
  }

  // --- P2: 表格(4x3) ---
  const p2 = doc.addPage([PAGE_W, PAGE_H]);
  p2.drawText('Quarterly Numbers', { x: LEFT_X, y: 750, size: 14, font: bold, color: black });
  const t1x = [72, 250, 400];
  GT_TABLE1.forEach((row, r) => {
    const y = 700 - r * 16;
    row.forEach((cell, c) => {
      p2.drawText(cell, { x: t1x[c], y, size: 10, font, color: black });
    });
  });
  ['A01 ' + FILLER, 'A02 ' + FILLER, 'A03 ' + FILLER].forEach((line, i) => {
    p2.drawText(line, { x: LEFT_X, y: 590 - i * 16, size: 10, font, color: black });
  });

  // --- P3: 跨页表格上半（表头 + D1..D4） ---
  const p3 = doc.addPage([PAGE_W, PAGE_H]);
  p3.drawText('Regional Breakdown', { x: LEFT_X, y: 750, size: 14, font: bold, color: black });
  const t2x = [60, 170, 260, 350, 450];
  GT_TABLE2.slice(0, 5).forEach((row, r) => {
    const y = 700 - r * 16;
    row.forEach((cell, c) => {
      p3.drawText(cell, { x: t2x[c], y, size: 10, font, color: black });
    });
  });

  // --- P4: 表格下半（D5..D8）+ 收尾散文 ---
  const p4 = doc.addPage([PAGE_W, PAGE_H]);
  GT_TABLE2.slice(5).forEach((row, r) => {
    const y = 700 - r * 16;
    row.forEach((cell, c) => {
      p4.drawText(cell, { x: t2x[c], y, size: 10, font, color: black });
    });
  });
  ['Z01 ' + FILLER, 'Z02 ' + FILLER].forEach((line, i) => {
    p4.drawText(line, { x: LEFT_X, y: 560 - i * 16, size: 10, font, color: black });
  });

  const bytes = await doc.save();
  fs.writeFileSync(path.join(__dirname, 'sample.pdf'), bytes);

  const truth = {
    pageCount: 4,
    // 双栏阅读顺序真值：先读完左栏再读右栏（P1 全部标记，按期望顺序）
    readingOrderMarkers: [
      ...Array.from({ length: 20 }, (_, i) => `L${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 20 }, (_, i) => `R${String(i + 1).padStart(2, '0')}`),
    ],
    tables: [
      { name: 'table1-page2', rows: GT_TABLE1 },
      { name: 'table2-p3p4-crosspage', rows: GT_TABLE2 },
    ],
  };
  fs.writeFileSync(path.join(__dirname, 'sample-truth.json'), `${JSON.stringify(truth, null, 2)}\n`);
  console.log(`sample.pdf written (${bytes.length} bytes), sample-truth.json written`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
