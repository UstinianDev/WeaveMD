/**
 * 解析 CommonMark/GFM spec.txt 文件，提取测试用例为 JSON 格式。
 *
 * spec.txt 格式：
 *   ```````````````````````````````` example
 *   markdown 输入
 *   .
 *   期望 HTML 输出
 *   ````````````````````````````````
 *
 * 用法：npx tsx tests/editor/kernel/scripts/parseSpecTxt.ts <spec.txt路径> <输出JSON路径>
 */

import * as fs from 'fs';
import * as path from 'path';

interface SpecExample {
  /** 示例编号（全局递增） */
  exampleNumber: number;
  /** 所在章节标题（如 "2.1 Precedence"） */
  section: string;
  /** Markdown 输入 */
  markdown: string;
  /** 期望 HTML 输出 */
  html: string;
  /** spec.txt 中的起始行号 */
  startLine: number;
}

/** 提取 `#` / `##` 标题作为 section 名 */
function extractSection(line: string): string | null {
  const m = line.match(/^#{1,6}\s+(.+)/);
  return m ? m[1].trim() : null;
}

function parseSpecFile(filePath: string): SpecExample[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const examples: SpecExample[] = [];
  let currentSection = '(preamble)';
  let exampleCount = 0;

  // 示例分隔符：31 个以上反引号后跟 " example"
  const exampleStartRe = /^`{31,}\s*example\s*$/;
  const exampleEndRe = /^`{31,}\s*$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 跟踪章节
    const section = extractSection(line);
    if (section) {
      currentSection = section;
    }

    // 检测示例开始
    if (exampleStartRe.test(line)) {
      const startLine = i + 1; // 1-indexed
      i++; // 跳过开始行

      // 收集 markdown 内容直到 "."
      const mdLines: string[] = [];
      while (i < lines.length && lines[i] !== '.') {
        mdLines.push(lines[i]);
        i++;
      }

      // 跳过 "." 行
      if (lines[i] === '.') {
        i++;
      }

      // 收集 HTML 内容直到结束分隔符
      const htmlLines: string[] = [];
      while (i < lines.length && !exampleEndRe.test(lines[i])) {
        htmlLines.push(lines[i]);
        i++;
      }

      const markdown = mdLines.join('\n');
      const html = htmlLines.join('\n');

      // 跳过空示例（section 分隔符误匹配）
      if (markdown.trim() || html.trim()) {
        exampleCount++;
        examples.push({
          exampleNumber: exampleCount,
          section: currentSection,
          markdown,
          html,
          startLine,
        });
      }
    }
  }

  return examples;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('用法：npx tsx parseSpecTxt.ts <spec.txt路径> <输出JSON路径>');
    process.exit(1);
  }

  const [inputPath, outputPath] = args;

  if (!fs.existsSync(inputPath)) {
    console.error(`输入文件不存在：${inputPath}`);
    process.exit(1);
  }

  const examples = parseSpecFile(inputPath);
  console.log(`解析完成：${examples.length} 个测试用例`);

  // 按章节分组统计
  const sectionCounts = new Map<string, number>();
  for (const ex of examples) {
    sectionCounts.set(ex.section, (sectionCounts.get(ex.section) || 0) + 1);
  }
  console.log('章节分布：');
  for (const [section, count] of sectionCounts) {
    console.log(`  ${section}: ${count}`);
  }

  // 写入 JSON
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(examples, null, 2), 'utf-8');
  console.log(`已写入：${outputPath}`);
}

main();