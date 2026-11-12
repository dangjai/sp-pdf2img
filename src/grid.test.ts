import { describe, expect, it } from 'vitest';
import { fileBase, getCells, imageName, validateGrid } from './grid';

const SAMPLE_GRID = {
  rows: 4, columns: 2,
  top: 54.12 / 792 * 100, bottom: 72.48 / 792 * 100,
  left: 17.88 / 612 * 100, right: 25.44 / 612 * 100,
};

describe('crop geometry', () => {
  it('matches the Sample.pdf table, excluding paper margins', () => {
    const cells = getCells(612, 792, SAMPLE_GRID);
    expect(cells).toHaveLength(8);
    expect(cells[0]).toMatchObject({ x: 18, y: 54, row: 0, column: 0 });
    expect(cells[7]).toMatchObject({ row: 3, column: 1 });
    expect(cells[7].x + cells[7].width).toBe(587);
    expect(cells[7].y + cells[7].height).toBe(720);
  });

  it('covers the rounded crop area exactly without gaps or overlaps', () => {
    const grid = { rows: 7, columns: 3, top: 7.3, bottom: 13.8, left: 5.1, right: 8.9 };
    const cells = getCells(1001, 799, grid);
    const area = cells.reduce((sum, cell) => sum + cell.width * cell.height, 0);
    expect(area).toBe((Math.round(1001 * 0.911) - Math.round(1001 * 0.051)) * (Math.round(799 * 0.862) - Math.round(799 * 0.073)));
    for (const cell of cells) {
      expect(cell.width).toBeGreaterThan(0);
      expect(cell.height).toBeGreaterThan(0);
      if (cell.column < grid.columns - 1) expect(cell.x + cell.width).toBe(cells[cell.index + 1].x);
      if (cell.row < grid.rows - 1) expect(cell.y + cell.height).toBe(cells[cell.index + grid.columns].y);
    }
  });

  it('supports a full-page single image', () => {
    expect(getCells(123, 456, { rows: 1, columns: 1, top: 0, bottom: 0, left: 0, right: 0 }))
      .toEqual([{ x: 0, y: 0, width: 123, height: 456, index: 0, row: 0, column: 0 }]);
  });

  it.each([
    { rows: 0 }, { rows: 1.5 }, { columns: 21 }, { top: NaN }, { bottom: -1 },
    { left: 60, right: 40 }, { top: 90, bottom: 20 }, { right: Infinity },
  ])('rejects invalid settings %j', (override) => {
    expect(validateGrid({ ...SAMPLE_GRID, ...override })).toBeTruthy();
    expect(() => getCells(100, 100, { ...SAMPLE_GRID, ...override })).toThrow();
  });

  it('rejects crops smaller than the number of cells', () => {
    expect(() => getCells(2, 2, SAMPLE_GRID)).toThrow('พื้นที่ตัดเล็กเกินไป');
  });
});

it('names images in page order and removes path characters from filenames', () => {
  expect(fileBase('ใบงาน.PDF')).toBe('ใบงาน');
  expect(fileBase('../a\\b.pdf')).not.toMatch(/[\\/]/);
  const names = [1, 2].flatMap((page) => Array.from({ length: 8 }, (_, cell) => imageName('Sample', page, cell + 1)));
  expect(new Set(names).size).toBe(16);
  expect(names[0]).toBe('Sample_page-01_cell-01.jpg');
  expect(names[15]).toBe('Sample_page-02_cell-08.jpg');
});

it.each(['pdf', 'jpg', 'jpeg', 'png', 'webp', 'bmp'])('removes the %s extension from output names', (extension) => {
  expect(fileBase(`receipt.${extension.toUpperCase()}`)).toBe('receipt');
});

it('rejects invalid cut positions and cells that round to zero pixels', () => {
  for (const rowCuts of [[], [0, 0.5, 0.75], [0.5, 0.25, 0.75], [0.25, 0.5, 1], [0.25, NaN, 0.75]]) {
    expect(() => getCells(600, 800, { ...SAMPLE_GRID, rowCuts })).toThrow('ตำแหน่งแนวตัด');
  }
  expect(() => getCells(600, 800, { ...SAMPLE_GRID, rowCuts: [0.00001, 0.5, 0.75] }))
    .toThrow('พื้นที่ตัดเล็กเกินไป');
});
