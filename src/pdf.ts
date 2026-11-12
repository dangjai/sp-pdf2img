import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import JSZip from 'jszip';
import { fileBase, getCells, imageName, type GridSettings } from './grid';
import { detectGrid } from './detectGrid';

GlobalWorkerOptions.workerSrc = workerUrl;
export { getDocument };

export type ExportedImage = { name: string; blob: Blob; page: number; cell: number };

async function detectPdfGrid(pdf: PDFDocumentProxy, pageNumber: number) {
  const page = await pdf.getPage(pageNumber);
  const canvas = document.createElement('canvas');
  try {
    const original = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2, 1600 / original.width, 2000 / original.height) });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('ไม่สามารถตรวจหาตารางได้');
    await page.render({ canvas, canvasContext: context, viewport, background: '#fff' }).promise;
    return detectGrid(context.getImageData(0, 0, canvas.width, canvas.height));
  } finally {
    page.cleanup();
    canvas.width = canvas.height = 0;
  }
}

export async function detectPdfGrids(pdf: PDFDocumentProxy) {
  const grids: GridSettings[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const grid = await detectPdfGrid(pdf, pageNumber);
    if (!grid) throw new Error(`ไม่พบกรอบสีน้ำเงินที่แบ่งช่องในหน้า ${pageNumber} กรุณาตรวจสอบกรอบใน PDF`);
    grids.push(grid);
  }
  return grids;
}

export async function splitPdf(
  pdf: PDFDocumentProxy,
  filename: string,
  grids: GridSettings[],
  onProgress: (completed: number, total: number) => void,
) {
  const images: ExportedImage[] = [];
  if (grids.length !== pdf.numPages) throw new Error('ข้อมูลกรอบไม่ครบทุกหน้า กรุณาเลือก PDF อีกครั้ง');
  const total = grids.reduce((sum, grid) => sum + grid.rows * grid.columns, 0);
  const canvas = document.createElement('canvas');
  const crop = document.createElement('canvas');
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: 200 / 72 });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        if (canvas.width * canvas.height > 40_000_000 || canvas.width > 16384 || canvas.height > 16384) {
          throw new Error('หน้ากระดาษมีขนาดใหญ่เกินกว่าจะแปลงที่ 200 DPI ในเบราว์เซอร์');
        }
        const context = canvas.getContext('2d');
        if (!context) throw new Error('เบราว์เซอร์ไม่สามารถสร้างภาพได้');
        await page.render({ canvas, canvasContext: context, viewport, background: '#ffffff' }).promise;
        await cropCanvas(canvas, crop, filename, pageNumber, grids[pageNumber - 1], (image) => {
          images.push(image);
          onProgress(images.length, total);
        });
      } finally {
        page.cleanup();
        canvas.width = canvas.height = 0;
      }
    }
    return images;
  } finally {
    canvas.width = canvas.height = crop.width = crop.height = 0;
  }
}

async function cropCanvas(
  canvas: HTMLCanvasElement,
  crop: HTMLCanvasElement,
  filename: string,
  pageNumber: number,
  grid: GridSettings,
  onImage: (image: ExportedImage) => void,
) {
  for (const cell of getCells(canvas.width, canvas.height, grid)) {
    crop.width = cell.width;
    crop.height = cell.height;
    const cropContext = crop.getContext('2d');
    if (!cropContext) throw new Error('เบราว์เซอร์ไม่สามารถตัดภาพได้');
    cropContext.fillStyle = '#ffffff';
    cropContext.fillRect(0, 0, crop.width, crop.height);
    cropContext.drawImage(canvas, cell.x, cell.y, cell.width, cell.height, 0, 0, cell.width, cell.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      crop.toBlob((result) => result ? resolve(result) : reject(new Error('ไม่สามารถบันทึก JPG ได้')), 'image/jpeg', 0.9);
    });
    onImage({ name: imageName(fileBase(filename), pageNumber, cell.index + 1), blob, page: pageNumber, cell: cell.index + 1 });
  }
}

export async function splitImage(
  file: File,
  onProgress: (completed: number, total: number) => void,
) {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('ไม่สามารถอ่านรูปภาพได้ ไฟล์อาจเสียหายหรือเป็นรูปแบบที่ไม่รองรับ');
  }
  const canvas = document.createElement('canvas');
  const crop = document.createElement('canvas');
  try {
    if (bitmap.width * bitmap.height > 40_000_000 || bitmap.width > 16384 || bitmap.height > 16384) {
      throw new Error('รูปภาพมีขนาดใหญ่เกินไป รองรับไม่เกิน 40 ล้านพิกเซล และด้านละ 16,384 พิกเซล');
    }
    const scale = Math.min(1, 1600 / bitmap.width, 2000 / bitmap.height);
    canvas.width = Math.ceil(bitmap.width * scale);
    canvas.height = Math.ceil(bitmap.height * scale);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('เบราว์เซอร์ไม่สามารถสร้างภาพได้');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const grid = detectGrid(context.getImageData(0, 0, canvas.width, canvas.height));
    if (!grid) throw new Error('ไม่พบกรอบสีน้ำเงินที่แบ่งช่องในรูปภาพ กรุณาตรวจสอบกรอบในไฟล์');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    const images: ExportedImage[] = [];
    const total = grid.rows * grid.columns;
    await cropCanvas(canvas, crop, file.name, 1, grid, (image) => {
      images.push(image);
      onProgress(images.length, total);
    });
    return images;
  } finally {
    bitmap.close();
    canvas.width = canvas.height = crop.width = crop.height = 0;
  }
}

export async function createZip(images: ExportedImage[], onProgress: (percent: number) => void) {
  const zip = new JSZip();
  for (const image of images) zip.file(image.name, image.blob);
  // JPEG is already compressed. STORE avoids unnecessary CPU work.
  return zip.generateAsync({ type: 'blob', compression: 'STORE' }, (metadata) => onProgress(metadata.percent));
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Allow the browser to start reading the blob before releasing its URL.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function errorMessage(error: unknown) {
  if (error instanceof Error && error.name === 'PasswordException') {
    return 'ไฟล์ PDF นี้เข้ารหัสหรือมีรหัสผ่าน กรุณาปลดรหัสผ่านก่อนอัปโหลด';
  }
  if (error instanceof Error && ['InvalidPDFException', 'MissingPDFException', 'UnexpectedResponseException'].includes(error.name)) {
    return 'ไม่สามารถอ่าน PDF ได้ ไฟล์อาจเสียหายหรือไม่ใช่ PDF ที่ถูกต้อง';
  }
  return error instanceof Error ? error.message : 'เกิดข้อผิดพลาด กรุณาลองอีกครั้ง';
}
