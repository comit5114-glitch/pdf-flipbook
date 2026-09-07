'use client';

import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Expand, FileUp, Grid2X2, Maximize2, RotateCcw, Volume2, VolumeX, X, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

type PdfDocument = import('pdfjs-dist').PDFDocumentProxy;
type PdfPage = import('pdfjs-dist').PDFPageProxy;

function useMedia(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

const PaperPage = forwardRef<HTMLDivElement, { pdf: PdfDocument; pageNumber: number; width: number; height: number; active: boolean; onReady: (page: number) => void }>(function PaperPage({ pdf, pageNumber, width, height, active, onReady }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let task: ReturnType<PdfPage['render']> | undefined;
    void (async () => {
      const page = await pdf.getPage(pageNumber);
      if (cancelled || !canvasRef.current) return;
      const base = page.getViewport({ scale: 1 });
      const cssScale = Math.min(width / base.width, height / base.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const naturalArea = base.width * base.height * cssScale * cssScale * dpr * dpr;
      const memoryScale = naturalArea > 5_000_000 ? Math.sqrt(5_000_000 / naturalArea) : 1;
      const viewport = page.getViewport({ scale: cssScale * dpr * memoryScale });
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${base.width * cssScale}px`; canvas.style.height = `${base.height * cssScale}px`;
      task = page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport });
      await task.promise;
      if (!cancelled) { setReady(true); onReady(pageNumber); }
    })().catch((error) => { if (error?.name !== 'RenderingCancelledException') console.error(error); });
    return () => { cancelled = true; task?.cancel(); };
  }, [active, height, onReady, pageNumber, pdf, width]);
  return <div ref={ref} className="paper-page" data-density={pageNumber === 1 ? 'hard' : 'soft'}>
    {!ready && <div className="page-skeleton" />}
    <div className="canvas-stage"><canvas ref={canvasRef} aria-label={`${pageNumber}페이지`} /></div>
    <span className="page-folio">{pageNumber}</span>
  </div>;
});

function Thumbnail({ pdf, pageNumber, selected, onClick }: { pdf: PdfDocument; pageNumber: number; selected: boolean; onClick: () => void }) {
  const rootRef = useRef<HTMLButtonElement>(null); const canvasRef = useRef<HTMLCanvasElement>(null); const [visible, setVisible] = useState(false);
  useEffect(() => { if (!rootRef.current) return; const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setVisible(true), { rootMargin: '240px' }); observer.observe(rootRef.current); return () => observer.disconnect(); }, []);
  useEffect(() => {
    if (!visible || !canvasRef.current) return; let cancelled = false; let task: ReturnType<PdfPage['render']> | undefined;
    void pdf.getPage(pageNumber).then((page) => { if (cancelled || !canvasRef.current) return; const base = page.getViewport({ scale: 1 }); const viewport = page.getViewport({ scale: 150 / base.width }); const canvas = canvasRef.current; canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height); task = page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }); return task.promise; }).catch(() => undefined);
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, pageNumber, visible]);
  return <button ref={rootRef} onClick={onClick} className={`thumbnail ${selected ? 'selected' : ''}`} aria-label={`${pageNumber}페이지로 이동`}><span className="thumb-paper"><canvas ref={canvasRef} /></span><span>{pageNumber}</span></button>;
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null); const bookRef = useRef<any>(null); const bookElementRef = useRef<HTMLDivElement>(null); const viewerRef = useRef<HTMLDivElement>(null); const audioRef = useRef<AudioContext | null>(null); const soundSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const isSingle = useMedia('(max-width: 780px)');
  const [pdf, setPdf] = useState<PdfDocument | null>(null); const [title, setTitle] = useState(''); const [pageCount, setPageCount] = useState(0); const [pageIndex, setPageIndex] = useState(0);
  const [ratio, setRatio] = useState(.707); const [viewport, setViewport] = useState({ width: 520, height: 735 }); const [zoom, setZoom] = useState(1); const [sound, setSound] = useState(true);
  const [thumbsOpen, setThumbsOpen] = useState(false); const [loading, setLoading] = useState(false); const [prepared, setPrepared] = useState(0); const [error, setError] = useState('');
  const measure = useCallback(() => { const availableW = Math.max(280, window.innerWidth - (isSingle ? 28 : 96)); const availableH = Math.max(360, window.innerHeight - 178); const width = Math.floor(Math.min(availableH * ratio, availableW / (isSingle ? 1 : 2), 650)); setViewport({ width, height: Math.floor(width / ratio) }); }, [isSingle, ratio]);
  useEffect(() => { measure(); window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }, [measure]);
  const unlockAudio = useCallback(() => {
    const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtor) return;
    const context = audioRef.current ?? new AudioCtor();
    audioRef.current = context;
    if (context.state === 'suspended') void context.resume();
  }, []);
  const playFlip = useCallback(() => {
    if (!sound) return;
    unlockAudio();
    const context = audioRef.current;
    if (!context) return;
    const renderSound = () => {
      soundSourceRef.current?.stop();
      const now = context.currentTime; const length = Math.floor(context.sampleRate * .19); const buffer = context.createBuffer(1, length, context.sampleRate); const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) { const fade = Math.pow(1 - i / length, 2.2); data[i] = (Math.random() * 2 - 1) * fade * (.55 + .45 * Math.sin(i / 42)); }
      const source = context.createBufferSource(); const filter = context.createBiquadFilter(); const gain = context.createGain(); filter.type = 'bandpass'; filter.Q.value = .7; filter.frequency.setValueAtTime(1450, now); filter.frequency.exponentialRampToValueAtTime(360, now + .19); gain.gain.setValueAtTime(.095, now); gain.gain.exponentialRampToValueAtTime(.001, now + .19); source.buffer = buffer; source.connect(filter).connect(gain).connect(context.destination); source.start(now); soundSourceRef.current = source; source.onended = () => { if (soundSourceRef.current === source) soundSourceRef.current = null; };
    };
    if (context.state === 'running') renderSound(); else void context.resume().then(renderSound).catch(() => undefined);
  }, [sound, unlockAudio]);
  useEffect(() => {
    if (!pdf || !bookElementRef.current) return;
    let disposed = false;
    const mount = () => {
      if (disposed || !bookElementRef.current || !(window as any).St?.PageFlip) return;
      bookRef.current?.destroy?.();
      const instance = new (window as any).St.PageFlip(bookElementRef.current, { width: viewport.width, height: viewport.height, size: 'fixed', minWidth: 240, maxWidth: 700, minHeight: 320, maxHeight: 990, showCover: true, usePortrait: isSingle, drawShadow: true, flippingTime: 680, maxShadowOpacity: .28, mobileScrollSupport: true, clickEventForward: true, useMouseEvents: true, swipeDistance: 20, showPageCorners: true, disableFlipByClick: false, startPage: pageIndex, autoSize: false, startZIndex: 0 });
      instance.loadFromHTML(bookElementRef.current.querySelectorAll('.paper-page'));
      instance.on('flip', (event: any) => { setPageIndex(event.data); playFlip(); });
      bookRef.current = instance;
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-page-flip]');
    if ((window as any).St?.PageFlip) mount();
    else if (existing) existing.addEventListener('load', mount, { once: true });
    else { const script = document.createElement('script'); script.src = '/page-flip.browser.js'; script.dataset.pageFlip = 'true'; script.onload = mount; document.head.appendChild(script); }
    return () => { disposed = true; existing?.removeEventListener('load', mount); bookRef.current?.destroy?.(); bookRef.current = null; };
  }, [isSingle, pageCount, pdf, playFlip, viewport.height, viewport.width]);
  const openFile = useCallback(async (file?: File) => {
    if (!file) return; if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { setError('PDF 파일을 선택해주세요.'); return; }
    setLoading(true); setPrepared(0); setError(''); setPdf(null);
    try { const browserPdfPath = '/pdf.min.mjs'; const importBrowserModule = new Function('path', 'return import(path)') as (path: string) => Promise<any>; const pdfjs = await importBrowserModule(browserPdfPath); pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'; const bytes = new Uint8Array(await file.arrayBuffer()); const task = pdfjs.getDocument({ data: bytes }); task.onPassword = (updatePassword: (password: string) => void, reason: number) => { const password = window.prompt(reason === 1 ? '이 PDF는 암호가 필요합니다. 암호를 입력해주세요.' : '암호가 올바르지 않습니다. 다시 입력해주세요.'); if (password === null) task.destroy(); else updatePassword(password); }; const document = await task.promise; const first = await document.getPage(1); const size = first.getViewport({ scale: 1 }); setRatio(size.width / size.height); await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); setTitle(file.name.replace(/\.pdf$/i, '')); setPageCount(document.numPages); setPageIndex(0); setZoom(1); setPdf(document); }
    catch (cause: any) { setLoading(false); setError(cause?.name === 'PasswordException' ? '암호가 필요한 PDF입니다. 암호를 확인해주세요.' : 'PDF 파일을 열 수 없습니다.'); }
  }, []);
  const onReady = useCallback((page: number) => { setPrepared((value) => Math.max(value, page)); if (page === 1) setLoading(false); }, []);
  const flip = useCallback((where: 'first' | 'prev' | 'next' | 'last') => { const api = bookRef.current; if (!api) return; if (where === 'first') api.flip(0); if (where === 'prev') api.flipPrev(); if (where === 'next') api.flipNext(); if (where === 'last') api.flip(pageCount - 1); }, [pageCount]);
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') unlockAudio(); if (event.key === 'ArrowLeft') flip('prev'); if (event.key === 'ArrowRight') flip('next'); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [flip, unlockAudio]);
  const visibleStart = pageIndex + 1;
  const visibleEnd = isSingle || pageIndex === 0 ? visibleStart : Math.min(pageIndex + 2, pageCount);
  const range = visibleEnd === visibleStart ? `${visibleStart}` : `${visibleStart}-${visibleEnd}`;

  if (!pdf) return <main className="welcome-shell"><input ref={inputRef} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => void openFile(e.target.files?.[0])} /><section className="welcome-card"><div className="book-mark"><BookOpen size={31} strokeWidth={1.5} /></div><p className="eyebrow">PRIVATE PDF READER</p><h1>책장을 넘기다</h1><p className="welcome-copy">PDF 파일을 선택하면 실제 책처럼 넘겨볼 수 있습니다.</p><Button size="lg" onClick={() => inputRef.current?.click()} className="upload-button"><FileUp size={19} /> PDF 파일 선택</Button><p className="privacy-note">파일은 서버로 전송되지 않고 이 브라우저 안에서만 열립니다.</p>{error && <p className="error-message" role="alert">{error}</p>}</section><p className="welcome-footer">나만의 조용한 디지털 서재</p></main>;

  return <main ref={viewerRef} className="reader-shell" onPointerDownCapture={unlockAudio}>
    <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => void openFile(e.target.files?.[0])} />
    <header className="reader-header"><div className="title-block"><BookOpen size={19} /><h1 title={title}>{title}</h1></div><div className="toolbar"><Button variant="outline" size="sm" onClick={() => setThumbsOpen(true)}><Grid2X2 /><span>페이지 목록</span></Button><div className="button-cluster"><Button variant="ghost" size="icon-sm" aria-label="축소" onClick={() => setZoom((z) => Math.max(.7, +(z - .1).toFixed(1)))}><ZoomOut /></Button><span className="zoom-label">{Math.round(zoom * 100)}%</span><Button variant="ghost" size="icon-sm" aria-label="확대" onClick={() => setZoom((z) => Math.min(2, +(z + .1).toFixed(1)))}><ZoomIn /></Button></div><Button variant="outline" size="sm" onClick={() => setZoom(1)}><Expand /><span>화면 맞춤</span></Button><Button variant="outline" size="icon-sm" aria-label={sound ? '소리 끄기' : '소리 켜기'} onClick={() => { if (!sound) unlockAudio(); setSound((v) => !v); }}>{sound ? <Volume2 /> : <VolumeX />}</Button><Button variant="outline" size="sm" onClick={() => document.fullscreenElement ? document.exitFullscreen() : viewerRef.current?.requestFullscreen()}><Maximize2 /><span>크게 보기</span></Button><Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}><RotateCcw /><span>다른 PDF</span></Button></div></header>
    <section className={`book-viewport ${zoom > 1 ? 'is-zoomed' : ''}`}><div className="ambient-shadow" /><div className="zoom-stage" style={{ width: viewport.width * (isSingle ? 1 : 2), height: viewport.height, transform: `scale(${zoom})` }}><div key={`${title}-${viewport.width}-${isSingle}`} ref={bookElementRef} className="flip-book">{Array.from({ length: pageCount }, (_, index) => <PaperPage key={index + 1} pdf={pdf} pageNumber={index + 1} width={viewport.width} height={viewport.height} active={Math.abs(index - pageIndex) <= 4 || index === 0} onReady={onReady} />)}</div></div></section>
    <footer className="reader-footer"><div className="nav-pair"><Button variant="outline" size="sm" onClick={() => flip('first')} disabled={pageIndex === 0}>처음</Button><Button variant="outline" size="sm" onClick={() => flip('prev')} disabled={pageIndex === 0}><ChevronLeft /> 이전</Button></div><div className="page-status"><span>{range}</span><span className="slash">/</span><span>{pageCount}</span></div><div className="nav-pair"><Button variant="outline" size="sm" onClick={() => flip('next')} disabled={pageIndex >= pageCount - 1}>다음 <ChevronRight /></Button><Button variant="outline" size="sm" onClick={() => flip('last')} disabled={pageIndex >= pageCount - 1}>마지막</Button></div></footer>
    {loading && <div className="loading-overlay"><div className="loading-card"><BookOpen className="loading-book" /><h2>책을 준비하고 있습니다...</h2><p>{Math.max(1, prepared)} / {pageCount || '—'} 페이지 준비 중</p><Progress value={pageCount ? prepared / pageCount * 100 : 8} /></div></div>}
    <Sheet open={thumbsOpen} onOpenChange={setThumbsOpen}><SheetContent side="right" className="thumb-sheet"><SheetHeader><SheetTitle>페이지 목록</SheetTitle></SheetHeader><Button variant="ghost" size="icon" className="sheet-close" onClick={() => setThumbsOpen(false)} aria-label="페이지 목록 닫기"><X /></Button><div className="thumbnail-grid">{Array.from({ length: pageCount }, (_, index) => <Thumbnail key={index + 1} pdf={pdf} pageNumber={index + 1} selected={Math.abs(index - pageIndex) <= (isSingle ? 0 : 1)} onClick={() => { bookRef.current?.flip(index); setThumbsOpen(false); }} />)}</div></SheetContent></Sheet>
  </main>;
}
