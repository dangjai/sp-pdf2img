import type { GridSettings } from './grid';

type Line = { start: number; end: number };

function findLines(counts: Uint32Array, minimum: number): Line[] {
  const lines: Line[] = [];
  for (let index = 0; index < counts.length; index++) {
    if (counts[index] < minimum) continue;
    const start = index;
    while (index + 1 < counts.length && counts[index + 1] >= minimum) index++;
    lines.push({ start, end: index + 1 });
  }
  return lines;
}

function hasBorders(lines: Line[]) {
  return lines.length >= 2 && lines.length <= 21
    && lines.every((line, index) => index === 0 || line.start - lines[index - 1].end >= 4);
}

// Count blue borders only, so receipt text and black inner tables cannot become cut lines.
export function detectGrid({ data, width, height }: Pick<ImageData, 'data' | 'width' | 'height'>): GridSettings | null {
  const horizontal = new Uint32Array(height);
  const vertical = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const alpha = data[offset + 3];
      if (blue >= 100 && blue - red >= 40 && blue - green >= 40 && alpha >= 128) {
        horizontal[y]++;
        vertical[x]++;
      }
    }
  }
  // Inner tables aligned across columns can cover most of a scanline too.
  const rows = findLines(horizontal, Math.max(width * 0.6, horizontal.reduce((max, count) => Math.max(max, count), 0) * 0.9));
  const columns = findLines(vertical, Math.max(height * 0.5, vertical.reduce((max, count) => Math.max(max, count), 0) * 0.9));
  if (!hasBorders(rows) || !hasBorders(columns)) return null;
  return {
    rows: rows.length - 1,
    rowCuts: rows.slice(1, -1).map((line) => (line.start - rows[0].start) / (rows.at(-1)!.end - rows[0].start)),
    columnCuts: columns.slice(1, -1).map((line) => (line.start - columns[0].start) / (columns.at(-1)!.end - columns[0].start)),
    rowCutEnds: rows.slice(1, -1).map((line) => (line.end - rows[0].start) / (rows.at(-1)!.end - rows[0].start)),
    columnCutEnds: columns.slice(1, -1).map((line) => (line.end - columns[0].start) / (columns.at(-1)!.end - columns[0].start)),
    columns: columns.length - 1,
    top: rows[0].start / height * 100,
    bottom: (height - rows.at(-1)!.end) / height * 100,
    left: columns[0].start / width * 100,
    right: (width - columns.at(-1)!.end) / width * 100,
  };
}
