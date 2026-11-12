import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

// A minimal PDF with a standard encryption dictionary. No password is supplied by the UI.
function lockedPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>',
    `<< /Filter /Standard /V 1 /R 2 /O <${'00'.repeat(32)}> /U <${'00'.repeat(32)}> /P -4 >>`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size 5 /Root 1 0 R /Encrypt 4 0 R /ID [<${'00'.repeat(16)}> <${'00'.repeat(16)}>] >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

test('Sample.pdf produces 16 valid JPEGs, individual downloads, and a complete ZIP', async ({ page }, testInfo) => {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1') externalRequests.push(request.url());
  });
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles('Sample.pdf');
  await expect(page.locator('.result-card')).toHaveCount(16);
  await expect(page.getByRole('button', { name: /แยกเป็น JPG/ })).toHaveCount(0);
  await expect(page.getByTestId('cut-overlay')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('16px "Noto Sans Thai"', 'ทดสอบภาษาไทย'))).toBe(true);

  const dimensions = await page.locator('.result-card img').evaluateAll(async (elements) => {
    return Promise.all(elements.map(async (element) => {
      const image = element as HTMLImageElement;
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    }));
  });
  expect(dimensions.every(({ width, height }) => width >= 785 && width <= 795 && height >= 459 && height <= 465)).toBe(true);

  const individualDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'บันทึก Sample_page-01_cell-01.jpg', exact: true }).click();
  const image = await individualDownload;
  expect(image.suggestedFilename()).toBe('Sample_page-01_cell-01.jpg');
  const imagePath = testInfo.outputPath('first-cell.jpg');
  await image.saveAs(imagePath);
  expect((await readFile(imagePath)).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));

  const zippedDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ดาวน์โหลดทั้งหมด ZIP' }).click();
  const download = await zippedDownload;
  expect(download.suggestedFilename()).toBe('Sample_images.zip');
  const zipPath = testInfo.outputPath('Sample_images.zip');
  await download.saveAs(zipPath);
  const zip = await JSZip.loadAsync(await readFile(zipPath));
  const entries = Object.values(zip.files);
  expect(entries).toHaveLength(16);
  expect(entries.map((entry) => entry.name)).toEqual([1, 2].flatMap((p) => Array.from({ length: 8 }, (_, c) => `Sample_page-0${p}_cell-0${c + 1}.jpg`)));
  for (const entry of entries) expect((await entry.async('nodebuffer')).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  await page.screenshot({ path: testInfo.outputPath('sample-results.png'), fullPage: true });
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test('automatic cropping needs no settings and replacing the file releases results', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles('Sample.pdf');
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  await expect(page.locator('.result-card')).toHaveCount(16);
  const previousUrl = await page.locator('.result-card img').first().getAttribute('src');
  await page.getByTestId('pdf-input').setInputFiles({ name: 'replacement.pdf', mimeType: 'application/pdf', buffer: await readFile('Sample.pdf') });
  await expect(page.getByText('replacement.pdf', { exact: true })).toBeVisible();
  await expect(page.locator('.result-card')).toHaveCount(16);
  await expect(page.locator('.result-card img').first()).not.toHaveAttribute('src', previousUrl!);
  expect(await page.evaluate(async (url) => { try { await fetch(url!); return true; } catch { return false; } }, previousUrl)).toBe(false);
});

test('invalid files show actionable errors; mobile layout fits the viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') });
  await expect(page.getByRole('alert')).toContainText('ไม่สามารถอ่าน PDF ได้');
  await page.getByTestId('pdf-input').setInputFiles({ name: 'empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) });
  await expect(page.getByRole('alert')).toContainText('กรุณาเลือกไฟล์ PDF หรือรูปภาพที่มีข้อมูล');
  await page.getByTestId('pdf-input').setInputFiles({ name: 'locked.pdf', mimeType: 'application/pdf', buffer: lockedPdf() });
  await expect(page.getByRole('alert')).toContainText('เข้ารหัสหรือมีรหัสผ่าน');
  await page.getByTestId('pdf-input').setInputFiles('Sample.pdf');
  await expect(page.locator('.result-card')).toHaveCount(16);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
});

test('PDF drag and drop accepts one file and rejects multiple files', async ({ page }) => {
  await page.goto('/');
  const bytes = [...await readFile('Sample.pdf')];
  const transfer = await page.evaluateHandle((data) => {
    const drop = new DataTransfer();
    drop.items.add(new File([new Uint8Array(data)], 'dropped.pdf', { type: 'application/pdf' }));
    return drop;
  }, bytes);
  await page.locator('.drop-zone').dispatchEvent('drop', { dataTransfer: transfer });
  await expect(page.getByText('dropped.pdf', { exact: true })).toBeVisible();
  await expect(page.locator('.result-card')).toHaveCount(16);
  const multiple = await page.evaluateHandle(() => {
    const drop = new DataTransfer();
    drop.items.add(new File(['one'], 'one.pdf'));
    drop.items.add(new File(['two'], 'two.pdf'));
    return drop;
  });
  await page.locator('.drop-zone').dispatchEvent('drop', { dataTransfer: multiple });
  await expect(page.getByRole('alert').filter({ hasText: 'ครั้งละ 1 ไฟล์' })).toBeVisible();
  await transfer.dispose();
  await multiple.dispose();
});


test('uploading an image automatically exports its cells and rejects corrupt images', async ({ page }) => {
  await page.goto('/');
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 800;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 600, 800);
    context.fillStyle = '#00f';
    for (const x of [20, 300, 580]) context.fillRect(x, 50, 2, 682);
    for (const y of [50, 220, 390, 560, 730]) context.fillRect(20, y, 562, 2);
    return canvas.toDataURL('image/png');
  });
  await page.getByTestId('pdf-input').setInputFiles({
    name: 'receipts.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64'),
  });
  await expect(page.locator('.result-card')).toHaveCount(8);
  await expect(page.getByRole('link', { name: 'บันทึก receipts_page-01_cell-01.jpg', exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ดาวน์โหลดทั้งหมด ZIP' }).click();
  expect((await download).suggestedFilename()).toBe('receipts_images.zip');
  await expect(page.getByTestId('pdf-input')).toBeEnabled();
  await page.getByTestId('pdf-input').setInputFiles({
    name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image'),
  });
  await expect(page.getByRole('alert')).toContainText('ไม่สามารถอ่านรูปภาพได้');
  await expect(page.locator('.result-card')).toHaveCount(0);
  await expect(page.getByTestId('pdf-input')).toBeEnabled();
});

test('pasting an image splits it automatically; text paste and multiple images preserve results', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 800;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 600, 800);
    context.fillStyle = '#00f';
    for (const x of [20, 300, 580]) context.fillRect(x, 50, 2, 682);
    for (const y of [50, 220, 390, 560, 730]) context.fillRect(20, y, 562, 2);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((image) => resolve(image!), 'image/png'));
    const clipboard = new DataTransfer();
    clipboard.items.add('copied image', 'text/plain');
    // Clipboard images do not always have a filename extension.
    clipboard.items.add(new File([blob], 'image', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('.result-card')).toHaveCount(8);
  await expect(page.getByRole('link', { name: 'บันทึก clipboard_page-01_cell-01.jpg', exact: true })).toBeVisible();
  await expect(page.getByTestId('pdf-input')).toBeEnabled();
  const firstUrl = await page.locator('.result-card img').first().getAttribute('src');
  const textPasteAllowed = await page.evaluate(() => {
    const clipboard = new DataTransfer();
    clipboard.items.add('ordinary text', 'text/plain');
    return document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, cancelable: true }));
  });
  expect(textPasteAllowed).toBe(true);
  await page.evaluate(() => {
    const clipboard = new DataTransfer();
    clipboard.items.add(new File(['one'], 'one.png', { type: 'image/png' }));
    clipboard.items.add(new File(['two'], 'two.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard }));
  });
  await expect(page.getByRole('alert')).toContainText('กรุณาวางรูปภาพครั้งละ 1 รูป');
  await expect(page.locator('.result-card')).toHaveCount(8);
  await expect(page.locator('.result-card img').first()).toHaveAttribute('src', firstUrl!);
});
