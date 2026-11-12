import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  Alert, Box, Button, Chip, Container, IconButton, LinearProgress,
  Paper, Typography,
} from '@mui/material';
import {
  ArrowOutwardRounded, CheckCircleOutlineRounded,
  CloudUploadOutlined, DownloadRounded, InsertDriveFileOutlined,
  LockOutlined, ViewModuleOutlined,
} from '@mui/icons-material';
import { fileBase } from './grid';
import { createZip, detectPdfGrids, downloadBlob, errorMessage, getDocument, splitPdf, splitImage, type ExportedImage } from './pdf';

type ImageResult = ExportedImage & { url: string };
type Phase = 'idle' | 'loading' | 'converting' | 'zipping';

export default function App() {
  const [pageCount, setPageCount] = useState(0);
  const [filename, setFilename] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [total, setTotal] = useState(0);
  const [results, setResults] = useState<ImageResult[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const taskRef = useRef<ReturnType<typeof getDocument> | null>(null);
  const operation = useRef(false);
  const mounted = useRef(true);
  const busy = phase !== 'idle';

  useEffect(() => () => { results.forEach((image) => URL.revokeObjectURL(image.url)); }, [results]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void taskRef.current?.destroy();
    };
  }, []);

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const items = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'));
      if (!items.length) return;
      event.preventDefault();
      if (operation.current) return;
      if (items.length !== 1) {
        setError('กรุณาวางรูปภาพครั้งละ 1 รูป');
        return;
      }
      const file = items[0].getAsFile();
      if (!file) return;
      const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/bmp': 'bmp' } as Record<string, string>)[file.type];
      if (!extension) {
        setError('รูปแบบรูปภาพไม่รองรับ กรุณาวางรูป JPG, PNG, WebP หรือ BMP');
        return;
      }
      const image = /\.(jpe?g|png|webp|bmp)$/i.test(file.name)
        ? file
        : new File([file], `clipboard.${extension}`, { type: file.type });
      void loadFile(image);
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  async function loadFile(file: File) {
    if (operation.current) return;
    setError('');
    if (!/\.(pdf|jpe?g|png|webp|bmp)$/i.test(file.name) || file.size === 0) {
      setError('กรุณาเลือกไฟล์ PDF หรือรูปภาพที่มีข้อมูล (JPG, PNG, WebP, BMP)');
      return;
    }
    operation.current = true;
    setPhase('loading');
    setResults([]);
    setPageCount(0);
    setTotal(0);
    setCompleted(0);
    setFilename('');
    setProgress(0);
    try {
      setFilename(file.name);
      setFileSize(file.size);
      const onProgress = (count: number, countTotal: number) => {
        if (mounted.current) {
          setTotal(countTotal);
          setCompleted(count);
          setProgress(count / countTotal * 100);
        }
      };
      let images: ExportedImage[];
      if (/\.pdf$/i.test(file.name)) {
        const data = new Uint8Array(await file.arrayBuffer());
        if (!mounted.current) return;
        const task = getDocument({ data });
        taskRef.current = task;
        const document = await task.promise;
        const detected = await detectPdfGrids(document);
        if (!mounted.current) return;
        setTotal(detected.reduce((sum, grid) => sum + grid.rows * grid.columns, 0));
        setPageCount(document.numPages);
        setPhase('converting');
        images = await splitPdf(document, file.name, detected, onProgress);
      } else {
        setPageCount(1);
        setPhase('converting');
        images = await splitImage(file, onProgress);
      }
      if (mounted.current) setResults(images.map((image) => ({ ...image, url: URL.createObjectURL(image.blob) })));
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure));
    } finally {
      await taskRef.current?.destroy();
      taskRef.current = null;
      operation.current = false;
      if (mounted.current) setPhase('idle');
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void loadFile(file);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (operation.current) return;
    if (event.dataTransfer.files.length !== 1) {
      setError('กรุณาเลือกไฟล์ครั้งละ 1 ไฟล์');
      return;
    }
    void loadFile(event.dataTransfer.files[0]);
  }

  async function downloadZip() {
    if (!results.length || operation.current) return;
    operation.current = true;
    setPhase('zipping');
    setProgress(0);
    setError('');
    try {
      const blob = await createZip(results, (value) => { if (mounted.current) setProgress(value); });
      if (mounted.current) downloadBlob(blob, `${fileBase(filename)}_images.zip`);
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure));
    } finally {
      operation.current = false;
      if (mounted.current) setPhase('idle');
    }
  }

  return <>
    <header className="app-header"><Container maxWidth="xl" className="header-inner">
      <a className="brand" href="./" aria-label="PDF เป็น JPG หน้าหลัก"><span className="brand-icon"><ViewModuleOutlined /></span><span>ตัดกรอบ</span></a>
    </Container></header>

    <Container maxWidth="xl" component="main" className="main-content">
      <div className="intro">
        <Typography color="text.secondary">อัปโหลด PDF หรือวางรูปภาพ แล้วระบบจะแยกภาพตาม<span className="blue-frame-label">กรอบสีน้ำเงิน</span>ให้ทันที</Typography>
      </div>

      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 3 }}>{error}</Alert>}

      <div className="workspace">
        <aside className="settings-column">
          <Paper variant="outlined" className="panel">
            <div className="panel-title"><span className="step-number">1</span><Typography component="h2" variant="h6">เลือกเอกสาร</Typography></div>
            <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.bmp,application/pdf,image/jpeg,image/png,image/webp,image/bmp" hidden onChange={onFileChange} disabled={busy} data-testid="pdf-input" />
            <Box className={`drop-zone ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
              <span className="upload-icon"><CloudUploadOutlined fontSize="large" /></span>
              <Typography fontWeight={600}>ลากไฟล์ PDF หรือรูปภาพมาวางที่นี่</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>เลือกไฟล์ หรือคัดลอกรูปแล้วกด Ctrl+V / ⌘V บนหน้านี้</Typography>
              <Button variant="outlined" disabled={busy} onClick={() => inputRef.current?.click()}>เลือกไฟล์ PDF หรือรูปภาพ <ArrowOutwardRounded sx={{ ml: 1, fontSize: 16 }} /></Button>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>PDF หลายหน้า · JPG · PNG · WebP · BMP</Typography>
            </Box>
            {pageCount > 0 && <div className="file-info"><InsertDriveFileOutlined color="secondary" /><div><strong title={filename}>{filename}</strong><span>{pageCount} หน้า · {(fileSize / 1024).toLocaleString('th-TH', { maximumFractionDigits: 0 })} KB</span></div><CheckCircleOutlineRounded color="primary" fontSize="small" /></div>}
            {phase === 'loading' && <><LinearProgress sx={{ mt: 2 }} /><Typography role="status" variant="body2" sx={{ mt: 1 }}>กำลังอ่านไฟล์…</Typography></>}
          </Paper>

          {phase === 'converting' && <Paper variant="outlined" className="panel" role="status">
            <Typography fontWeight={600}>กำลังแยกภาพ…</Typography>
            <LinearProgress variant="determinate" value={progress} sx={{ my: 1 }} />
            <Typography variant="caption">แปลงแล้ว {completed} / {total} ภาพ</Typography>
          </Paper>}
          <div className="local-note"><LockOutlined fontSize="small" /><span>แปลงไฟล์ในเบราว์เซอร์ของคุณ<br />ไม่มีการอัปโหลดเอกสารไปยังเซิร์ฟเวอร์</span></div>
        </aside>

        <section className="preview-column" aria-label="ภาพผลลัพธ์">
          {!results.length && <Paper variant="outlined" className="panel">
            <div className="empty-state">
              <InsertDriveFileOutlined sx={{ fontSize: 48, mb: 2 }} />
              <Typography variant="h6">{busy ? 'กำลังเตรียมภาพของคุณ…' : 'อัปโหลด PDF หรือรูปภาพ เพื่อแยกภาพ'}</Typography>
              <Typography color="text.secondary" variant="body2">ระบบจะแยกเป็น JPG อัตโนมัติ แล้วดาวน์โหลดได้รายภาพหรือรวม ZIP</Typography>
              <Chip label="ไม่ต้องตั้งค่าแนวตัด" size="small" variant="outlined" sx={{ mt: 2.5 }} />
            </div>
          </Paper>}

          {results.length > 0 && <Paper variant="outlined" className="panel">
            <div className="results-heading"><div><span className="eyebrow">READY TO DOWNLOAD</span><Typography variant="h6" component="h2">แยกภาพเรียบร้อย <span className="result-count">{results.length} ภาพ</span></Typography></div><Button variant="contained" startIcon={<DownloadRounded />} disabled={busy} onClick={() => void downloadZip()}>ดาวน์โหลดทั้งหมด ZIP</Button></div>
            {phase === 'zipping' && <Box role="status" sx={{ mb: 2 }}><Typography variant="body2">กำลังสร้าง ZIP… {Math.round(progress)}%</Typography><LinearProgress variant="determinate" value={progress} /></Box>}
            <div className="results-grid">{results.map((image) => <article className="result-card" key={image.name}>
              <a href={image.url} download={image.name} className="result-image-link" aria-label={`ดาวน์โหลด ${image.name}`}><img src={image.url} alt={`หน้า ${image.page} ช่อง ${image.cell}`} loading="lazy" /></a>
              <div className="result-card-info"><div><strong>หน้า {image.page} · ช่อง {image.cell}</strong><span title={image.name}>{image.name}</span></div><IconButton component="a" href={image.url} download={image.name} aria-label={`บันทึก ${image.name}`} size="small"><DownloadRounded fontSize="small" /></IconButton></div>
            </article>)}</div>
          </Paper>}
        </section>
      </div>
      <footer className="app-footer"><span>PDF / JPG</span><span>เอกสารเดิมยังอยู่ครบ · ภาพที่ต้องการพร้อมใช้งาน</span></footer>
    </Container>
  </>;
}
