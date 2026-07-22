export function getHeadingLevelFromLine(line: string): number | undefined {
  const match = line.match(/^(#{1,6})[ \t]+/);
  if (!match) {
    return undefined;
  }
  return match[1].length;
}
