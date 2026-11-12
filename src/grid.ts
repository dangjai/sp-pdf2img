export type GridSettings = {
  rows: number;
  columns: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  // Internal cut positions as fractions of the cropped area, from 0 to 1.
  rowCuts?: number[];
  columnCuts?: number[];
  // Include shared border pixels in both adjacent images.
  rowCutEnds?: number[];
  columnCutEnds?: number[];
};

export function validateGrid(grid: GridSettings): string | null {
  if (![grid.rows, grid.columns].every((value) => Number.isInteger(value) && value >= 1 && value <= 20)) {
    return 'จำนวนแถวและคอลัมน์ต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง 20';
  }
  if (![grid.top, grid.bottom, grid.left, grid.right].every((value) => Number.isFinite(value) && value >= 0 && value < 100)) {
    return 'ขอบพื้นที่ตัดต้องเป็นตัวเลขตั้งแต่ 0 และน้อยกว่า 100%';
  }
  if (grid.top + grid.bottom >= 100 || grid.left + grid.right >= 100) {
    return 'ขอบตรงข้ามรวมกันต้องน้อยกว่า 100% เพื่อให้เหลือพื้นที่ตัด';
  }
  for (const [cuts, count] of [[grid.rowCuts, grid.rows], [grid.columnCuts, grid.columns]] as const) {
    if (cuts && (cuts.length !== count - 1 || cuts.some((cut, index) =>
      !Number.isFinite(cut) || cut <= (index === 0 ? 0 : cuts[index - 1]) || cut >= 1))) {
      return 'ตำแหน่งแนวตัดต้องเรียงจากน้อยไปมากและอยู่ภายในพื้นที่ตัด';
    }
  }
  for (const [cuts, ends] of [[grid.rowCuts, grid.rowCutEnds], [grid.columnCuts, grid.columnCutEnds]] as const) {
    if (ends && (!cuts || ends.length !== cuts.length || ends.some((end, index) =>
      !Number.isFinite(end) || end <= cuts[index] || end > (cuts[index + 1] ?? 1)))) {
      return 'ขอบแนวตัดต้องครอบคลุมเส้นกรอบและไม่เกินช่องถัดไป';
    }
  }
  return null;
}

export function getCells(width: number, height: number, grid: GridSettings) {
  const error = validateGrid(grid);
  if (error) throw new Error(error);
  const left = Math.round((width * grid.left) / 100);
  const right = Math.round(width * (1 - grid.right / 100));
  const top = Math.round((height * grid.top) / 100);
  const bottom = Math.round(height * (1 - grid.bottom / 100));
  if (right - left < grid.columns || bottom - top < grid.rows) {
    throw new Error('พื้นที่ตัดเล็กเกินไป กรุณาลดจำนวนช่องหรือขอบพื้นที่ตัด');
  }
  return Array.from({ length: grid.rows * grid.columns }, (_, index) => {
    const row = Math.floor(index / grid.columns);
    const column = index % grid.columns;
    const x = left + Math.round((right - left) * (column === 0 ? 0 : grid.columnCuts?.[column - 1] ?? column / grid.columns));
    const y = top + Math.round((bottom - top) * (row === 0 ? 0 : grid.rowCuts?.[row - 1] ?? row / grid.rows));
    const endX = left + Math.round((right - left) * (grid.columnCutEnds?.[column] ?? grid.columnCuts?.[column] ?? (column + 1) / grid.columns));
    const endY = top + Math.round((bottom - top) * (grid.rowCutEnds?.[row] ?? grid.rowCuts?.[row] ?? (row + 1) / grid.rows));
    if (endX <= x || endY <= y) throw new Error('พื้นที่ตัดเล็กเกินไป กรุณาลดจำนวนช่องหรือขอบพื้นที่ตัด');
    return { x, y, width: endX - x, height: endY - y, row, column, index };
  });
}

export function fileBase(name: string) {
  return name.replace(/\.(pdf|jpe?g|png|webp|bmp)$/i, '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_') || 'document';
}

export function imageName(base: string, page: number, cell: number) {
  return `${base}_page-${String(page).padStart(2, '0')}_cell-${String(cell).padStart(2, '0')}.jpg`;
}
