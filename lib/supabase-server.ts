import 'server-only';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'temporary-pdfs';
export const PDF_PART_SIZE = 45 * 1024 * 1024;
const MAX_PDF_PARTS = 20;

export type TemporaryBook = {
  id: string;
  visitor_id: string;
  title: string;
  storage_path: string;
  created_at: string;
  expires_at: string;
  last_viewed_at: string;
  last_page: number;
  share_token: string | null;
  share_enabled: boolean;
};

function settings() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Supabase 서버 Secret Key가 설정되지 않았습니다.');
  return { url: SUPABASE_URL.replace(/\/$/, ''), key: SERVICE_KEY };
}

function headers(extra?: HeadersInit) {
  const { key } = settings();
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

async function checked(response: Response) {
  if (response.ok) return response;
  throw new Error(`Supabase 요청 실패 (${response.status}): ${await response.text()}`);
}

export async function db(path: string, init?: RequestInit) {
  const { url } = settings();
  return checked(await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: headers({ 'Content-Type': 'application/json', ...init?.headers }),
  }));
}

export function pdfStoragePlan(id: string, fileSize: number) {
  const partCount = Math.max(1, Math.ceil(fileSize / PDF_PART_SIZE));
  if (partCount > MAX_PDF_PARTS) throw new Error('PDF 파일이 너무 큽니다. 900MB 이하의 파일을 사용해주세요.');
  if (partCount === 1) {
    const path = `temporary/${id}/book.pdf`;
    return { storagePath: path, objectPaths: [path] };
  }
  const basePath = `temporary/${id}/parts`;
  return {
    storagePath: `multipart:${partCount}:${basePath}`,
    objectPaths: Array.from({ length: partCount }, (_, index) => `${basePath}/${String(index).padStart(4, '0')}.pdf`),
  };
}

function pdfObjectPaths(storagePath: string) {
  const match = storagePath.match(/^multipart:(\d+):(.+)$/);
  if (!match) return [storagePath];
  const count = Number(match[1]); const basePath = match[2];
  if (!Number.isInteger(count) || count < 1 || count > MAX_PDF_PARTS) throw new Error('저장된 PDF 정보가 올바르지 않습니다.');
  return Array.from({ length: count }, (_, index) => `${basePath}/${String(index).padStart(4, '0')}.pdf`);
}

async function signedPdfUploadUrl(path: string) {
  const { url } = settings();
  const response = await checked(await fetch(`${url}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
    method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: '{}',
  }));
  const data = await response.json() as { url?: string; signedURL?: string; signedUrl?: string };
  const signed = data.url ?? data.signedURL ?? data.signedUrl;
  if (!signed) throw new Error('PDF 업로드 주소를 만들지 못했습니다.');
  if (signed.startsWith('http')) return signed;
  return signed.startsWith('/storage/v1/') ? `${url}${signed}` : `${url}/storage/v1${signed.startsWith('/') ? signed : `/${signed}`}`;
}

export async function signedPdfUploadUrls(paths: string[]) {
  return Promise.all(paths.map(signedPdfUploadUrl));
}

export async function deletePdf(path: string) {
  const { url } = settings();
  await checked(await fetch(`${url}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: pdfObjectPaths(path) }),
  }));
}

export async function signedPdfUrl(path: string) {
  const { url } = settings();
  const response = await checked(await fetch(`${url}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ expiresIn: 600 }),
  }));
  const data = await response.json() as { signedURL?: string; signedUrl?: string };
  const signed = data.signedURL ?? data.signedUrl;
  if (!signed) throw new Error('PDF 주소를 만들지 못했습니다.');
  if (signed.startsWith('http')) return signed;
  return signed.startsWith('/storage/v1/') ? `${url}${signed}` : `${url}/storage/v1${signed.startsWith('/') ? signed : `/${signed}`}`;
}

export async function signedPdfUrls(storagePath: string) {
  return Promise.all(pdfObjectPaths(storagePath).map(signedPdfUrl));
}

export function jsonError(error: unknown) {
  console.error(error);
  const message = error instanceof Error && error.message.includes('환경변수') ? error.message : '요청을 처리하지 못했습니다.';
  return Response.json({ error: message }, { status: 500 });
}
