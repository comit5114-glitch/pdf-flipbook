'use client';

import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Clock3, Copy, Ellipsis, Expand, FileUp, Grid2X2, House, Maximize2, RotateCcw, RotateCw, Share2, Trash2, Volume2, VolumeX, X, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

type PdfDocument = import('pdfjs-dist').PDFDocumentProxy;
type PdfPage = import('pdfjs-dist').PDFPageProxy;
type StoredBook = { id: string; title: string; createdAt: string; lastViewedAt: string; expiresAt: string; lastPage: number; ownerVisitorId?: string };

async function downloadPdf(data: { pdfUrl?: string; pdfUrls?: string[] }) {
  const urls = data.pdfUrls?.length ? data.pdfUrls : data.pdfUrl ? [data.pdfUrl] : [];
  if (!urls.length) throw new Error('이 책의 파일을 찾을 수 없습니다.');
  const parts: Blob[] = [];
  for (const url of urls) {
    const response = await fetch(url); if (!response.ok) throw new Error('이 책의 파일을 찾을 수 없습니다.');
    parts.push(await response.blob());
  }
  return new Blob(parts, { type: 'application/pdf' });
}

function visitorId() {
  const key = 'flipbook-visitor-id'; let value = window.localStorage.getItem(key);
  if (!value) { value = crypto.randomUUID(); window.localStorage.setItem(key, value); }
  return value;
}

function expiryDate(expiresAt: string) { return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(expiresAt)).replace(/\. /g, '.').replace('.', '.'); }
function retentionLabel(expiresAt: string) { const hours = (new Date(expiresAt).getTime() - Date.now()) / 3600000; if (hours <= 24) return '오늘 만료'; if (hours <= 48) return '내일까지 보관됩니다'; return `남은 보관기간 ${Math.ceil(hours / 24)}일`; }

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

export default function Home({ sharedToken }: { sharedToken?: string }) {
  const inputRef = useRef<HTMLInputElement>(null); const bookRef = useRef<any>(null); const bookElementRef = useRef<HTMLDivElement>(null); const viewerRef = useRef<HTMLDivElement>(null); const audioRef = useRef<HTMLAudioElement | null>(null); const currentFileRef = useRef<File | null>(null); const savingRef = useRef(false); const audioPrimedRef = useRef(false); const flipSoundModeRef = useRef<'sound' | 'silent' | null>(null); const shouldPlayFlipSoundRef = useRef(false);
  const isMobile = useMedia('(max-width: 780px), (max-width: 1024px) and (pointer: coarse)');
  const isPortrait = useMedia('(orientation: portrait)');
  const [forcedLandscape, setForcedLandscape] = useState(false);
  const mobilePortrait = isMobile && isPortrait && !forcedLandscape;
  const isSingle = false;
  const [pdf, setPdf] = useState<PdfDocument | null>(null); const [title, setTitle] = useState(''); const [pageCount, setPageCount] = useState(0); const [pageIndex, setPageIndex] = useState(0);
  const [ratio, setRatio] = useState(.707); const [viewport, setViewport] = useState({ width: 520, height: 735 }); const [zoom, setZoom] = useState(1); const [sound, setSound] = useState(true);
  const [thumbsOpen, setThumbsOpen] = useState(false); const [loading, setLoading] = useState(false); const [prepared, setPrepared] = useState(0); const [error, setError] = useState('');
  const [recentBooks, setRecentBooks] = useState<StoredBook[]>([]); const [pendingFile, setPendingFile] = useState<File | null>(null); const [storageChoiceOpen, setStorageChoiceOpen] = useState(false); const [shareMenuOpen, setShareMenuOpen] = useState(false); const [shareUrl, setShareUrl] = useState(''); const [sharedExpiry, setSharedExpiry] = useState(''); const [saving, setSaving] = useState(false); const [activeBook, setActiveBook] = useState<StoredBook | null>(null); const [shareSourceBook, setShareSourceBook] = useState<StoredBook | null>(null); const [deleteBook, setDeleteBook] = useState<StoredBook | null>(null); const [notice, setNotice] = useState('');
  const measure = useCallback(() => {
    const physicalWidth = window.visualViewport?.width ?? window.innerWidth;
    const physicalHeight = window.visualViewport?.height ?? window.innerHeight;
    const screenWidth = forcedLandscape && isPortrait ? physicalHeight : physicalWidth;
    const screenHeight = forcedLandscape && isPortrait ? physicalWidth : physicalHeight;
    const horizontalSpace = isMobile ? (mobilePortrait ? 12 : 16) : 96;
    const chromeSpace = isMobile ? (mobilePortrait ? 124 : 96) : 178;
    const availableW = Math.max(240, screenWidth - horizontalSpace);
    const availableH = Math.max(240, screenHeight - chromeSpace);
    const maximumPageWidth = isMobile ? Number.POSITIVE_INFINITY : 650;
    const width = Math.floor(Math.min(availableH * ratio, availableW / (isSingle ? 1 : 2), maximumPageWidth));
    setViewport({ width, height: Math.floor(width / ratio) });
  }, [forcedLandscape, isMobile, isPortrait, mobilePortrait, ratio]);
  useEffect(() => {
    let timer = 0;
    const scheduleMeasure = () => { window.clearTimeout(timer); timer = window.setTimeout(measure, 100); };
    measure(); window.addEventListener('resize', scheduleMeasure); window.visualViewport?.addEventListener('resize', scheduleMeasure);
    return () => { window.clearTimeout(timer); window.removeEventListener('resize', scheduleMeasure); window.visualViewport?.removeEventListener('resize', scheduleMeasure); };
  }, [measure]);
  useEffect(() => {
    const savedSound = window.localStorage.getItem('flipbook-sound-enabled');
    if (savedSound !== null) setSound(savedSound === 'true');
    const audio = new Audio('/audio/page-turn.mp3');
    audio.preload = 'auto'; audio.volume = .35;
    audioRef.current = audio;
    return () => { audio.pause(); audioRef.current = null; };
  }, []);
  const primeAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audioPrimedRef.current) return;
    const volume = audio.volume; audio.volume = 0;
    void audio.play().then(() => { audio.pause(); audio.currentTime = 0; audio.volume = volume; audioPrimedRef.current = true; }).catch(() => { audio.volume = volume; });
  }, []);
  const playFlip = useCallback(() => {
    const audio = audioRef.current;
    if (!sound || !audio) return;
    audio.pause(); audio.currentTime = 0; audio.volume = .35;
    void audio.play().catch(() => undefined);
  }, [sound]);
  useEffect(() => {
    if (!pdf || !bookElementRef.current) return;
    let disposed = false;
    const mount = () => {
      if (disposed || !bookElementRef.current || !(window as any).St?.PageFlip) return;
      bookRef.current?.destroy?.();
      const instance = new (window as any).St.PageFlip(bookElementRef.current, { width: viewport.width, height: viewport.height, size: 'fixed', minWidth: 130, maxWidth: 700, minHeight: 180, maxHeight: 990, showCover: true, usePortrait: isSingle, drawShadow: true, flippingTime: 680, maxShadowOpacity: .28, mobileScrollSupport: true, clickEventForward: true, useMouseEvents: true, swipeDistance: 20, showPageCorners: true, disableFlipByClick: false, startPage: pageIndex, autoSize: false, startZIndex: 0 });
      instance.loadFromHTML(bookElementRef.current.querySelectorAll('.paper-page'));
      instance.on('changeState', (event: any) => {
        if (event.data === 'flipping') shouldPlayFlipSoundRef.current = flipSoundModeRef.current !== 'silent';
      });
      instance.on('flip', (event: any) => {
        setPageIndex(event.data);
        if (shouldPlayFlipSoundRef.current) playFlip();
        shouldPlayFlipSoundRef.current = false; flipSoundModeRef.current = null;
      });
      bookRef.current = instance;
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-page-flip]');
    if ((window as any).St?.PageFlip) mount();
    else if (existing) existing.addEventListener('load', mount, { once: true });
    else { const script = document.createElement('script'); script.src = '/page-flip.browser.js'; script.dataset.pageFlip = 'true'; script.onload = mount; document.head.appendChild(script); }
    return () => { disposed = true; existing?.removeEventListener('load', mount); bookRef.current?.destroy?.(); bookRef.current = null; };
  }, [isSingle, pageCount, pdf, playFlip, viewport.height, viewport.width]);
  const loadPdf = useCallback(async (file: Blob, bookTitle: string, savedPage = 1) => {
    setLoading(true); setPrepared(0); setError(''); setPdf(null);
    try { const browserPdfPath = '/pdf.min.mjs'; const importBrowserModule = new Function('path', 'return import(path)') as (path: string) => Promise<any>; const pdfjs = await importBrowserModule(browserPdfPath); pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'; const bytes = new Uint8Array(await file.arrayBuffer()); const task = pdfjs.getDocument({ data: bytes }); task.onPassword = (updatePassword: (password: string) => void, reason: number) => { const password = window.prompt(reason === 1 ? '이 PDF는 암호가 필요합니다. 암호를 입력해주세요.' : '암호가 올바르지 않습니다. 다시 입력해주세요.'); if (password === null) task.destroy(); else updatePassword(password); }; const document = await task.promise; const first = await document.getPage(1); const size = first.getViewport({ scale: 1 }); const requested = Number.isFinite(savedPage) ? Math.floor(savedPage) - 1 : 0; const start = Math.max(0, Math.min(requested, document.numPages - 1)); setRatio(size.width / size.height); await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); setTitle(bookTitle.replace(/\.pdf$/i, '')); setPageCount(document.numPages); setPageIndex(start); setZoom(1); setPdf(document); return { document, first }; }
    catch (cause: any) { setLoading(false); setError(cause?.name === 'PasswordException' ? '암호가 필요한 PDF입니다. 암호를 확인해주세요.' : 'PDF 파일을 열 수 없습니다.'); }
  }, []);
  const openFile = useCallback((file?: File) => { if (!file) return; if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { setError('PDF 파일을 선택해주세요.'); return; } setPendingFile(file); setStorageChoiceOpen(true); }, []);
  const savePdf = useCallback(async (file: File, shareOnly = false) => {
    if (savingRef.current) return null; savingRef.current = true; setSaving(true); setError(''); setNotice(shareOnly ? '공유 링크를 준비하는 중입니다…' : 'PDF를 7일간 보관하는 중입니다…');
    try {
      const ownerVisitorId = shareOnly ? `share-${crypto.randomUUID()}` : visitorId();
      const response = await fetch('/api/books', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitorId: ownerVisitorId, title: file.name.replace(/\.pdf$/i, ''), contentType: 'application/pdf', fileSize: file.size }) });
      const responseText = await response.text(); let data: any = {}; try { data = responseText ? JSON.parse(responseText) : {}; } catch { throw new Error(response.ok ? '업로드 준비 응답을 확인할 수 없습니다.' : `업로드를 준비하지 못했습니다. (${response.status})`); }
      if (!response.ok) throw new Error(data.error ?? `업로드를 준비하지 못했습니다. (${response.status})`);
      const uploadUrls = Array.isArray(data.uploadUrls) ? data.uploadUrls as string[] : [];
      const partSize = Number(data.partSize); if (!uploadUrls.length || !Number.isFinite(partSize)) throw new Error('PDF 업로드 정보를 확인할 수 없습니다.');
      for (let index = 0; index < uploadUrls.length; index += 1) {
        const part = file.slice(index * partSize, Math.min(file.size, (index + 1) * partSize), 'application/pdf');
        const uploadBody = new FormData(); uploadBody.append('cacheControl', '3600'); uploadBody.append('', part, `book-${index + 1}.pdf`);
        const uploadResponse = await fetch(uploadUrls[index], { method: 'PUT', headers: { 'x-upsert': 'false' }, body: uploadBody });
        if (!uploadResponse.ok) { void fetch(`/api/books/${data.book.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitorId: ownerVisitorId }) }); throw new Error(`PDF를 저장하지 못했습니다. (${uploadResponse.status})`); }
      }
      const book = { ...data.book, ownerVisitorId } as StoredBook;
      if (shareOnly) { setShareSourceBook(book); setNotice('공유 링크를 준비했습니다.'); }
      else { setShareSourceBook(null); setActiveBook(book); setRecentBooks((books) => [book, ...books.filter((item) => item.id !== book.id)]); setNotice(`이 PDF를 7일 동안 보관합니다. ${expiryDate(book.expiresAt)}까지 보관됩니다.`); }
      return book;
    } catch (cause: any) { setNotice(''); setError(cause?.message ?? 'PDF를 보관하지 못했습니다. 잠시 후 다시 시도해주세요.'); return null; }
    finally { savingRef.current = false; setSaving(false); }
  }, []);
  const chooseStorage = useCallback(async (store: boolean) => {
    const file = pendingFile; if (!file) return; setStorageChoiceOpen(false); const loaded = await loadPdf(file, file.name);
    if (!loaded) { setPendingFile(null); return; } currentFileRef.current = file; setActiveBook(null); setShareSourceBook(null); if (store) await savePdf(file); setPendingFile(null);
  }, [loadPdf, pendingFile, savePdf]);
  const continueBook = useCallback(async (book: StoredBook) => { try { setLoading(true); setError(''); const response = await fetch(`/api/books/${book.id}?visitorId=${encodeURIComponent(visitorId())}`); const data = await response.json(); if (!response.ok) throw new Error(data.error); const pdfBlob = await downloadPdf(data); currentFileRef.current = null; setShareSourceBook(null); setActiveBook({ ...book, ...data.book }); await loadPdf(pdfBlob, data.book.title, data.book.lastPage); } catch (cause: any) { setLoading(false); setError(cause?.message ?? '저장된 책을 불러오지 못했습니다.'); } }, [loadPdf]);
  useEffect(() => { if (sharedToken) return; const bookId = window.location.pathname.match(/^\/book\/([^/]+)/)?.[1]; if (bookId) void continueBook({ id: bookId, title: '', createdAt: '', lastViewedAt: '', expiresAt: '', lastPage: 1 }); }, [continueBook, sharedToken]);
  useEffect(() => {
    if (sharedToken) return;
    void fetch(`/api/books?visitorId=${encodeURIComponent(visitorId())}`).then(async (response) => { if (!response.ok) throw new Error(); setRecentBooks((await response.json()).books); }).catch(() => setError('저장된 책을 불러오지 못했습니다.'));
  }, [sharedToken]);
  useEffect(() => { if (!isPortrait) setForcedLandscape(false); }, [isPortrait]);
  useEffect(() => {
    if (!notice && !error) return;
    const timer = window.setTimeout(() => { setNotice(''); setError(''); }, error ? 4500 : 2800);
    return () => window.clearTimeout(timer);
  }, [error, notice]);
  useEffect(() => {
    if (!sharedToken) return; setLoading(true); setError(''); setActiveBook(null); currentFileRef.current = null;
    void fetch(`/api/share/${encodeURIComponent(sharedToken)}`).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); const pdfBlob = await downloadPdf(data); const savedPage = Number(window.localStorage.getItem(`shared-book-${sharedToken}-last-page`)) || 1; setSharedExpiry(data.book.expiresAt); await loadPdf(pdfBlob, data.book.title, savedPage); }).catch((cause) => { setLoading(false); setError(cause?.message ?? '유효하지 않은 공유 링크입니다.'); });
  }, [loadPdf, sharedToken]);
  const onReady = useCallback((page: number) => { setPrepared((value) => Math.max(value, page)); if (page === 1) setLoading(false); }, []);
  const flip = useCallback((where: 'first' | 'prev' | 'next' | 'last') => { const api = bookRef.current; if (!api) return; flipSoundModeRef.current = where === 'prev' || where === 'next' ? 'sound' : 'silent'; if (where === 'first') api.flip(0); if (where === 'prev') api.flipPrev(); if (where === 'next') api.flipNext(); if (where === 'last') api.flip(pageCount - 1); }, [pageCount]);
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') primeAudio(); if (event.key === 'ArrowLeft') flip('prev'); if (event.key === 'ArrowRight') flip('next'); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [flip, primeAudio]);
  const toggleSound = useCallback(() => { setSound((current) => { const next = !current; window.localStorage.setItem('flipbook-sound-enabled', String(next)); if (!next && audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; } else if (next) primeAudio(); return next; }); }, [primeAudio]);
  const requestLandscape = useCallback(async () => {
    if (forcedLandscape) { setForcedLandscape(false); return; }
    setForcedLandscape(true);
    try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); } catch { /* Fullscreen availability varies by mobile browser. */ }
    try {
      const orientation = screen.orientation as ScreenOrientation & { lock?: (value: string) => Promise<void> };
      if (orientation?.lock) await orientation.lock('landscape');
    } catch { /* The user can still rotate the device manually. */ }
  }, [forcedLandscape]);
  useEffect(() => { if (!activeBook) return; const timer = window.setTimeout(() => { void fetch(`/api/books/${activeBook.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitorId: visitorId(), lastPage: pageIndex + 1 }) }); }, 750); return () => window.clearTimeout(timer); }, [activeBook, pageIndex]);
  useEffect(() => { if (sharedToken && pdf) window.localStorage.setItem(`shared-book-${sharedToken}-last-page`, String(pageIndex + 1)); }, [pageIndex, pdf, sharedToken]);
  const openShare = useCallback(async (book: StoredBook) => { try { setError(''); const response = await fetch(`/api/books/${book.id}/share`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitorId: book.ownerVisitorId ?? visitorId() }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setShareSourceBook(book); setShareUrl(`${window.location.origin}/share/${data.shareToken}`); setSharedExpiry(data.expiresAt); setShareMenuOpen(true); } catch (cause: any) { setError(cause?.message ?? '공유 링크를 만들지 못했습니다.'); } }, []);
  const shareCurrentPdf = useCallback(async () => { const existing = activeBook ?? shareSourceBook; if (existing) { await openShare(existing); return; } const file = currentFileRef.current; if (!file) { setError('현재 PDF를 공유할 수 없습니다.'); return; } const book = await savePdf(file, true); if (book) await openShare(book); }, [activeBook, openShare, savePdf, shareSourceBook]);
  const copyShareLink = useCallback(async () => { try { await navigator.clipboard.writeText(shareUrl); setNotice('공유 링크가 복사되었습니다.'); } catch { setNotice('링크를 직접 선택해 복사해주세요.'); } }, [shareUrl]);
  const shareNative = useCallback(async () => {
    if (!shareUrl) { setError('공유 링크가 아직 준비되지 않았습니다.'); return; }
    if (!window.isSecureContext || typeof navigator.share !== 'function') { setError('이 브라우저는 다른 앱으로 공유를 지원하지 않습니다. 스마트폰의 Chrome 또는 Safari에서 열어주세요.'); return; }
    const shareData = { title: title || 'PDF 플립북', text: '책장을 넘기듯 편하게 읽어보세요.', url: shareUrl };
    if (navigator.canShare && !navigator.canShare(shareData)) { setError('이 브라우저에서는 이 공유 링크를 다른 앱으로 보낼 수 없습니다.'); return; }
    try { await navigator.share(shareData); }
    catch (cause: any) { if (cause?.name !== 'AbortError') setError('다른 앱 공유 창을 열지 못했습니다. 잠시 후 다시 시도해주세요.'); }
  }, [shareUrl, title]);
  const stopSharing = useCallback(async () => { const book = shareSourceBook ?? activeBook; if (!book) return; try { const response = await fetch(`/api/books/${book.id}/share`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitorId: book.ownerVisitorId ?? visitorId() }) }); if (!response.ok) throw new Error(); setShareMenuOpen(false); setNotice('공유를 중지했습니다.'); } catch { setError('공유를 중지하지 못했습니다.'); } }, [activeBook, shareSourceBook]);
  const removeBook = useCallback(async () => { if (!deleteBook) return; const target = deleteBook; setRecentBooks((books) => books.filter((book) => book.id !== target.id)); setDeleteBook(null); try { const response = await fetch(`/api/books/${target.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitorId: visitorId() }) }); if (!response.ok) throw new Error(); setNotice('책이 삭제되었습니다.'); } catch { setRecentBooks((books) => [target, ...books].sort((a, b) => new Date(b.lastViewedAt).getTime() - new Date(a.lastViewedAt).getTime())); setError('책을 삭제하지 못했습니다. 잠시 후 다시 시도해주세요.'); } }, [deleteBook]);
  const visibleStart = pageIndex + 1;
  const visibleEnd = isSingle || pageIndex === 0 ? visibleStart : Math.min(pageIndex + 2, pageCount);
  const range = visibleEnd === visibleStart ? `${visibleStart}` : `${visibleStart}-${visibleEnd}`;

  if (!pdf && sharedToken) return <main className="welcome-shell"><section className="welcome-card"><div className="book-mark"><BookOpen size={31} strokeWidth={1.5} /></div><p className="eyebrow">SHARED PDF READER</p><h1>공유받은 책</h1><p className="welcome-copy">{error || '책을 불러오고 있습니다…'}</p>{!error && <Progress value={45} />}{error && <Button onClick={() => { window.location.href = '/'; }}>홈으로</Button>}</section></main>;

  if (!pdf) return <main className="welcome-shell recent-welcome"><input ref={inputRef} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(event) => { void openFile(event.target.files?.[0]); event.target.value = ''; }} />
    <section className="welcome-card library-card"><div className="book-mark"><BookOpen size={31} strokeWidth={1.5} /></div><p className="eyebrow">PRIVATE PDF READER</p><h1>책장을 넘기다</h1>
        {recentBooks.length > 0 && <div className="recent-section"><div className="section-heading"><Clock3 size={17} /><h2>최근에 보던 책</h2></div>{recentBooks.map((book) => <article className="recent-book" key={book.id}><div className="recent-cover"><BookOpen /></div><div className="recent-info"><h3>{book.title}</h3><div className="book-meta"><span>최근 읽은 페이지 <b>{book.lastPage || 1}페이지</b></span><span>보관 만료 <b>{expiryDate(book.expiresAt)}</b></span></div><p className={retentionLabel(book.expiresAt) === '오늘 만료' ? 'expires-today' : ''}>{retentionLabel(book.expiresAt)}</p><div className="recent-actions"><Button size="sm" onClick={() => void continueBook(book)}>계속 보기</Button><Button size="icon-sm" variant="ghost" aria-label="삭제" onClick={() => setDeleteBook(book)}><Trash2 /></Button></div></div></article>)}</div>}
        <p className="welcome-copy">PDF를 열어 바로 보거나 7일간 보관해 다시 읽을 수 있습니다.</p><Button size="lg" onClick={() => inputRef.current?.click()} className="upload-button"><FileUp size={19} /> {recentBooks.length ? '새 PDF 열기' : 'PDF 파일 선택'}</Button><p className="privacy-note">‘이번만 보기’를 선택하면 파일은 서버로 전송되지 않습니다.</p>{notice && <p className="success-message">{notice}</p>}{error && <p className="error-message" role="alert">{error}</p>}
    </section>
    <Dialog open={storageChoiceOpen} onOpenChange={setStorageChoiceOpen}><DialogContent><DialogHeader><DialogTitle>PDF를 어떻게 열까요?</DialogTitle><DialogDescription>보관 방식을 선택해주세요. 나중에 변경할 수 없습니다.</DialogDescription></DialogHeader><div className="storage-options"><button onClick={() => void chooseStorage(false)}><BookOpen /><strong>이번만 보기</strong><span>현재 브라우저에서만 열고 서버에는 저장하지 않습니다.</span></button><button onClick={() => void chooseStorage(true)}><Clock3 /><strong>7일간 보관</strong><span>7일 동안 다시 첨부하지 않고 읽을 수 있습니다.</span></button></div></DialogContent></Dialog>
    <AlertDialog open={Boolean(deleteBook)} onOpenChange={(open) => !open && setDeleteBook(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>이 책을 삭제하시겠습니까?</AlertDialogTitle><AlertDialogDescription>삭제하면 다시 복구할 수 없습니다.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction onClick={() => void removeBook()}>삭제</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </main>;

  return <main ref={viewerRef} className={`reader-shell ${isMobile ? mobilePortrait ? 'is-mobile is-mobile-portrait' : `is-mobile is-mobile-landscape${forcedLandscape ? ' is-forced-landscape' : ''}` : ''}`} onPointerDownCapture={primeAudio}>
    {!sharedToken && <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(event) => { void openFile(event.target.files?.[0]); event.target.value = ''; }} />}
    <header className="reader-header">
      <div className="title-block"><BookOpen size={19} /><div><h1 title={title}>{title}</h1>{sharedToken && sharedExpiry && <small>이 책은 {expiryDate(sharedExpiry)}까지 볼 수 있습니다.</small>}</div></div>
      <div className="toolbar">
        <Button className="desktop-home-button" variant="outline" size="sm" onClick={() => { window.location.href = '/'; }}><House /><span>홈</span></Button>
        <Button className="page-list-button" variant="outline" size="sm" aria-label="페이지 목록" onClick={() => setThumbsOpen(true)}><Grid2X2 /><span>페이지 목록</span></Button>
        <div className="button-cluster"><Button variant="ghost" size="icon-sm" aria-label="축소" onClick={() => setZoom((z) => Math.max(.7, +(z - .1).toFixed(1)))}><ZoomOut /></Button><span className="zoom-label">{Math.round(zoom * 100)}%</span><Button variant="ghost" size="icon-sm" aria-label="확대" onClick={() => setZoom((z) => Math.min(2, +(z + .1).toFixed(1)))}><ZoomIn /></Button></div>
        <Button className="fit-button" variant="outline" size="sm" aria-label="화면 맞춤" onClick={() => setZoom(1)}><Expand /><span>화면 맞춤</span></Button>
        <Button className="sound-button" variant="outline" size="sm" aria-label={sound ? '🔊 소리 켜짐' : '🔇 소리 꺼짐'} onClick={toggleSound}>{sound ? <Volume2 /> : <VolumeX />}<span>{sound ? '소리 켜짐' : '소리 꺼짐'}</span></Button>
        <Button className="mobile-landscape-button" variant="outline" size="sm" aria-label={forcedLandscape ? '세로 보기' : '가로 보기'} onClick={() => void requestLandscape()}><RotateCw /><span>{forcedLandscape ? '세로 보기' : '가로 보기'}</span></Button>
        <Button className="fullscreen-button" variant="outline" size="sm" onClick={() => document.fullscreenElement ? document.exitFullscreen() : viewerRef.current?.requestFullscreen()}><Maximize2 /><span>크게 보기</span></Button>
        {!sharedToken && <Button className="retention-button" variant="outline" size="sm" disabled={Boolean(activeBook) || saving} onClick={() => currentFileRef.current && void savePdf(currentFileRef.current)}><Clock3 /><span>{saving ? '보관 중…' : activeBook ? '7일 보관 중' : '7일 보관'}</span></Button>}
        {!sharedToken && <Button className="share-button" variant="outline" size="sm" disabled={saving} onClick={() => void shareCurrentPdf()}><Share2 /><span>{saving ? '공유 준비 중…' : '공유하기'}</span></Button>}
        {!sharedToken && <Button className="other-pdf-button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}><RotateCcw /><span>다른 PDF</span></Button>}
        <DropdownMenu>
          <DropdownMenuTrigger className="mobile-more-button" aria-label="더보기"><Ellipsis /></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="mobile-more-menu">
            <DropdownMenuItem onClick={() => { window.location.href = '/'; }}><House />홈</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setZoom((z) => Math.max(.7, +(z - .1).toFixed(1)))}><ZoomOut />축소</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setZoom((z) => Math.min(2, +(z + .1).toFixed(1)))}><ZoomIn />확대</DropdownMenuItem>
            <DropdownMenuItem onClick={() => document.fullscreenElement ? document.exitFullscreen() : viewerRef.current?.requestFullscreen()}><Maximize2 />크게 보기</DropdownMenuItem>
            {!sharedToken && <DropdownMenuSeparator />}
            {!sharedToken && <DropdownMenuItem disabled={Boolean(activeBook) || saving || !currentFileRef.current} onClick={() => currentFileRef.current && void savePdf(currentFileRef.current)}><Clock3 />{activeBook ? '7일 보관 중' : '7일 보관'}</DropdownMenuItem>}
            {!sharedToken && <DropdownMenuItem onClick={() => inputRef.current?.click()}><RotateCcw />다른 PDF</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
    <section className={`book-viewport ${zoom > 1 ? 'is-zoomed' : ''}`}><div className="ambient-shadow" /><div className="zoom-stage" style={{ width: viewport.width * (isSingle ? 1 : 2), height: viewport.height, transform: `scale(${zoom})` }}><div key={`${title}-${viewport.width}-${isSingle}`} ref={bookElementRef} className="flip-book">{Array.from({ length: pageCount }, (_, index) => <PaperPage key={index + 1} pdf={pdf} pageNumber={index + 1} width={viewport.width} height={viewport.height} active={Math.abs(index - pageIndex) <= 4 || index === 0} onReady={onReady} />)}</div>{!isSingle && <div className="book-spine" aria-hidden="true" />}</div></section>
    {(notice || error) && <div className={`reader-notice ${error ? 'is-error' : ''}`}>{error || notice}</div>}
    <footer className="reader-footer"><div className="nav-pair"><Button variant="outline" size="sm" onClick={() => flip('first')} disabled={pageIndex === 0}>처음</Button><Button variant="outline" size="sm" onClick={() => flip('prev')} disabled={pageIndex === 0}><ChevronLeft /> 이전</Button></div><div className="page-status"><span>{range}</span><span className="slash">/</span><span>{pageCount}</span></div><div className="nav-pair"><Button variant="outline" size="sm" onClick={() => flip('next')} disabled={pageIndex >= pageCount - 1}>다음 <ChevronRight /></Button><Button variant="outline" size="sm" onClick={() => flip('last')} disabled={pageIndex >= pageCount - 1}>마지막</Button></div></footer>
    {loading && <div className="loading-overlay"><div className="loading-card"><BookOpen className="loading-book" /><h2>책을 준비하고 있습니다...</h2><p>{Math.max(1, prepared)} / {pageCount || '—'} 페이지 준비 중</p><Progress value={pageCount ? prepared / pageCount * 100 : 8} /></div></div>}
    <Dialog open={storageChoiceOpen} onOpenChange={setStorageChoiceOpen}><DialogContent><DialogHeader><DialogTitle>PDF를 어떻게 열까요?</DialogTitle><DialogDescription>보관 방식을 선택해주세요. 나중에 변경할 수 없습니다.</DialogDescription></DialogHeader><div className="storage-options"><button onClick={() => void chooseStorage(false)}><BookOpen /><strong>이번만 보기</strong><span>현재 브라우저에서만 열고 서버에는 저장하지 않습니다.</span></button><button onClick={() => void chooseStorage(true)}><Clock3 /><strong>7일간 보관</strong><span>7일 동안 다시 첨부하지 않고 읽을 수 있습니다.</span></button></div></DialogContent></Dialog>
    <Dialog open={shareMenuOpen} onOpenChange={setShareMenuOpen}><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>공유 가능 기간: {sharedExpiry ? `${expiryDate(sharedExpiry)}까지` : '확인 중'}</DialogDescription></DialogHeader><label className="share-url-label" htmlFor="share-url">공유 링크</label><input id="share-url" className="share-url-input" value={shareUrl} readOnly onFocus={(event) => event.currentTarget.select()} /><div className="share-actions"><Button className="native-share-button" onClick={() => void shareNative()}><Share2 />다른 앱으로 공유</Button><Button variant="outline" onClick={() => void copyShareLink()}><Copy />링크 복사</Button><Button variant="outline" onClick={() => void stopSharing()}>공유 중지</Button><Button variant="ghost" onClick={() => setShareMenuOpen(false)}>닫기</Button></div></DialogContent></Dialog>
    <Sheet open={thumbsOpen} onOpenChange={setThumbsOpen}><SheetContent side="right" className="thumb-sheet"><SheetHeader><SheetTitle>페이지 목록</SheetTitle></SheetHeader><Button variant="ghost" size="icon" className="sheet-close" onClick={() => setThumbsOpen(false)} aria-label="페이지 목록 닫기"><X /></Button><div className="thumbnail-grid">{Array.from({ length: pageCount }, (_, index) => <Thumbnail key={index + 1} pdf={pdf} pageNumber={index + 1} selected={Math.abs(index - pageIndex) <= (isSingle ? 0 : 1)} onClick={() => { flipSoundModeRef.current = 'silent'; bookRef.current?.flip(index); setThumbsOpen(false); }} />)}</div></SheetContent></Sheet>
  </main>;
}
