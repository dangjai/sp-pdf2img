import { readFile } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('pdfjs-dist', () => import('pdfjs-dist/legacy/build/pdf.mjs'));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdfjs-dist/legacy/build/pdf.worker.mjs' }));

import { detectPdfGrids, getDocument, splitPdf, splitImage } from './pdf';

afterEach(() => vi.unstubAllGlobals());

it('detects every page of Sample.pdf and exports 16 JPEGs without user settings', async () => {
  vi.stubGlobal('document', { createElement: () => createCanvas(1, 1) });
  const pdf = await getDocument({ data: new Uint8Array(await readFile('Sample.pdf')) }).promise;
  try {
    const grids = await detectPdfGrids(pdf);
    expect(grids).toHaveLength(2);
    for (const grid of grids) {
      expect(grid).toMatchObject({ rows: 4, columns: 2 });
      // Measured blue outer borders in PDF points (Letter, 612 × 792).
      expect(Math.abs(grid.left / 100 * 612 - 17.88)).toBeLessThan(1);
      expect(Math.abs(grid.top / 100 * 792 - 54.12)).toBeLessThan(1);
      expect(Math.abs(grid.bottom / 100 * 792 - 72.48)).toBeLessThan(1);
      expect(Math.abs(grid.right / 100 * 612 - 25.44)).toBeLessThan(1);
    }
    const progress = vi.fn();
    const images = await splitPdf(pdf, 'Sample.pdf', grids, progress);
    expect(images).toHaveLength(16);
    expect(images[0].name).toBe('Sample_page-01_cell-01.jpg');
    expect(images[15].name).toBe('Sample_page-02_cell-08.jpg');
    for (const image of images) {
      expect(new Uint8Array(await image.blob.arrayBuffer()).slice(0, 3)).toEqual(new Uint8Array([255, 216, 255]));
    }
    expect(progress).toHaveBeenLastCalledWith(16, 16);
  } finally {
    await pdf.destroy();
  }
}, 30_000);

it('reports the page missing blue frames instead of guessing a crop', async () => {
  vi.stubGlobal('document', { createElement: () => createCanvas(1, 1) });
  const page = {
    getViewport: () => ({ width: 600, height: 800 }),
    render: () => ({ promise: Promise.resolve() }),
    cleanup: vi.fn(),
  };
  const pdf = { numPages: 2, getPage: vi.fn().mockResolvedValue(page) };
  await expect(detectPdfGrids(pdf as unknown as Parameters<typeof detectPdfGrids>[0]))
    .rejects.toThrow('ไม่พบกรอบสีน้ำเงินที่แบ่งช่องในหน้า 1');
  expect(page.cleanup).toHaveBeenCalled();
});


it.each(['png', 'jpeg', 'webp'] as const)('splits a %s image into JPEGs at original resolution', async (format) => {
  vi.stubGlobal('document', { createElement: () => createCanvas(1, 1) });
  const source = createCanvas(2400, 3200);
  const context = source.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, source.width, source.height);
  context.fillStyle = '#00f';
  for (const x of [80, 1200, 2320]) context.fillRect(x, 200, 8, 2728);
  for (const y of [200, 880, 1560, 2240, 2920]) context.fillRect(80, y, 2248, 8);
  const mime = `image/${format}` as 'image/png' | 'image/jpeg' | 'image/webp';
  const encoded = format === 'png' ? await source.encode('png') : await source.encode(format);
  const file = new File([new Uint8Array(encoded)], `receipts.${format}`, { type: mime });
  const close = vi.fn();
  vi.stubGlobal('createImageBitmap', async (input: File) => {
    const image = await loadImage(Buffer.from(await input.arrayBuffer()));
    return Object.assign(image, { close });
  });
  const progress = vi.fn();
  const images = await splitImage(file, progress);
  expect(images).toHaveLength(8);
  expect(images[0].name).toBe('receipts_page-01_cell-01.jpg');
  expect(images[7].name).toBe('receipts_page-01_cell-08.jpg');
  for (const image of images) {
    expect(image.blob.type).toBe('image/jpeg');
    const output = await loadImage(Buffer.from(await image.blob.arrayBuffer()));
    expect(output.width).toBeGreaterThan(1100);
    expect(output.height).toBeGreaterThan(675);
  }
  expect(progress).toHaveBeenLastCalledWith(8, 8);
  expect(close).toHaveBeenCalledOnce();
});

it('rejects corrupt images with an actionable message', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode failed')));
  await expect(splitImage(new File(['broken'], 'broken.png'), vi.fn())).rejects.toThrow('ไม่สามารถอ่านรูปภาพได้');
});

it('rejects oversized images and releases the decoded bitmap', async () => {
  vi.stubGlobal('document', { createElement: () => createCanvas(1, 1) });
  const close = vi.fn();
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 20000, height: 3000, close }));
  await expect(splitImage(new File([], 'large.png'), vi.fn())).rejects.toThrow('รูปภาพมีขนาดใหญ่เกินไป');
  expect(close).toHaveBeenCalledOnce();
});

it('rejects images without blue frames and releases the decoded bitmap', async () => {
  vi.stubGlobal('document', { createElement: () => createCanvas(1, 1) });
  const close = vi.fn();
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(Object.assign(createCanvas(600, 800), { close })));
  await expect(splitImage(new File([], 'blank.png'), vi.fn())).rejects.toThrow('ไม่พบกรอบสีน้ำเงิน');
  expect(close).toHaveBeenCalledOnce();
});

it('cuts all eight unequal cells in Sample2.png along their actual borders', async () => {
  vi.stubGlobal('document', { createElement: () => createCanvas(1, 1) });
  const close = vi.fn();
  vi.stubGlobal('createImageBitmap', async (file: File) =>
    Object.assign(await loadImage(Buffer.from(await file.arrayBuffer())), { close }));
  const file = new File([new Uint8Array(await readFile('Sample2.png'))], 'Sample2.png', { type: 'image/png' });
  const images = await splitImage(file, vi.fn());
  expect(images).toHaveLength(8);
  const dimensions = await Promise.all(images.map(async (image) => {
    const output = await loadImage(Buffer.from(await image.blob.arrayBuffer()));
    const canvas = createCanvas(output.width, output.height);
    const context = canvas.getContext('2d');
    context.drawImage(output, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const blue = (x: number, y: number) => {
      const offset = (y * canvas.width + x) * 4;
      return data[offset + 2] - data[offset] > 40 && data[offset + 2] - data[offset + 1] > 40;
    };
    for (const y of [0, canvas.height - 1]) {
      const coverage = Array.from({ length: canvas.width }, (_, x) => blue(x, y)).filter(Boolean).length / canvas.width;
      expect(coverage, `${image.name}: horizontal border at ${y}`).toBeGreaterThan(0.9);
    }
    for (const x of [0, canvas.width - 1]) {
      const coverage = Array.from({ length: canvas.height }, (_, y) => blue(x, y)).filter(Boolean).length / canvas.height;
      expect(coverage, `${image.name}: vertical border at ${x}`).toBeGreaterThan(0.9);
    }
    return [output.width, output.height];
  }));
  expect(dimensions).toEqual([
    [271, 70], [280, 70],
    [271, 72], [280, 72],
    [271, 69], [280, 69],
    [271, 81], [280, 81],
  ]);
  expect(close).toHaveBeenCalledOnce();
});
