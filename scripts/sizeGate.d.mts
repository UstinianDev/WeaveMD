// scripts/sizeGate.mjs 的类型声明（供 tests/scripts/sizeGate.test.ts 在 TS strict 下导入）

export interface SizeGateItem {
  name: string;
  path: string;
  bytes: number;
  limitBytes: number;
}

export interface SizeGateResult {
  ok: boolean;
  items: SizeGateItem[];
  violations: SizeGateItem[];
}

export interface AsarEntry {
  path: string;
  size: number;
}

export interface AsarContentReport {
  missingRequired: string[];
  forbiddenFound: string[];
}

export declare const INSTALLER_LIMIT_BYTES: number;
export declare const UNPACKED_LIMIT_BYTES: number;
export declare const ASAR_REQUIRED: string[];
export declare const ASAR_FORBIDDEN: string[];

export declare function formatMB(bytes: number): string;
export declare function evaluateGates(items: SizeGateItem[]): SizeGateResult;
export declare function topContributors(
  entries: ReadonlyArray<{ path: string; bytes: number }>,
  count: number,
): Array<{ path: string; bytes: number }>;
export declare function walkDirSize(dir: string): number;
export declare function collectInstallerArtifacts(
  releaseDir: string,
): Array<{ path: string; bytes: number }>;
export declare function readAsarEntries(asarPath: string): AsarEntry[];
export declare function topAsarFiles(
  entries: ReadonlyArray<AsarEntry>,
  count: number,
): Array<{ path: string; bytes: number }>;
export declare function groupAsarEntries(
  entries: ReadonlyArray<AsarEntry>,
): Array<{ path: string; bytes: number }>;
export declare function checkAsarContent(
  entries: ReadonlyArray<{ path: string }>,
  extraPaths?: ReadonlyArray<string>,
): AsarContentReport;
