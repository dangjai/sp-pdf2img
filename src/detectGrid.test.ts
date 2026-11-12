import { describe, expect, it } from 'vitest';
import { detectGrid } from './detectGrid';
import { getCells } from './grid';

function table(horizontal: number[], vertical = [20, 300, 580]) {
  const width = 600;
  const height = 840;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  function rectangle(left: number, top: number, right: number, bottom: number, blue = false) {
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const offset = (y * width + x) * 4;
      data[offset] = data[offset + 1] = 0;
      data[offset + 2] = blue ? 255 : 0;
    }
  }
  for (const y of horizontal) rectangle(vertical[0], y, vertical.at(-1)! + 2, y + 2, true);
  for (const x of vertical) rectangle(x, horizontal[0], x + 2, horizontal.at(-1)! + 2, true);
  // Nested receipt table borders must not be mistaken for whole-page cell borders.
  rectangle(60, 130, 260, 132);
  rectangle(60, 150, 260, 152);
  rectangle(340, 130, 540, 132);
  rectangle(340, 150, 540, 152);
  rectangle(60, 130, 62, 170);
  return { width, height, data };
}

describe('table detection', () => {
  it('measures the actual table rather than using fixed sample margins', () => {
    const first = detectGrid(table([54, 218, 382, 546, 710]));
    const second = detectGrid(table([54, 224, 394, 564, 734]));
    expect(first).toMatchObject({ rows: 4, columns: 2, top: 54 / 840 * 100 });
    expect(second).toMatchObject({ rows: 4, columns: 2, bottom: 104 / 840 * 100 });
    expect(second!.bottom).toBeLessThan(first!.bottom);
  });

  it('ignores black tables when there are no blue frames', () => {
    const image = table([54, 224, 394, 564, 734]);
    for (let offset = 0; offset < image.data.length; offset += 4) {
      if (image.data[offset] === 0) image.data[offset + 2] = 0;
    }
    expect(detectGrid(image)).toBeNull();
  });

  it('preserves actual borders when rows and columns have unequal sizes', () => {
    const grid = detectGrid(table([54, 220, 480, 600, 734], [20, 250, 580]));
    expect(grid).toMatchObject({ rows: 4, columns: 2 });
    const cells = getCells(600, 840, grid!);
    expect(cells.map((cell) => [cell.x, cell.y, cell.width, cell.height])).toEqual([
      [20, 54, 232, 168], [250, 54, 332, 168],
      [20, 220, 232, 262], [250, 220, 332, 262],
      [20, 480, 232, 122], [250, 480, 332, 122],
      [20, 600, 232, 136], [250, 600, 332, 136],
    ]);
  });

  it('requires both horizontal and vertical table borders', () => {
    const blank = table([], []);
    expect(detectGrid(blank)).toBeNull();
    const image = table([54, 224, 394, 564, 734], [20]);
    expect(detectGrid(image)).toBeNull();
  });
});
