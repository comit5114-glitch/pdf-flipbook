import 'server-only';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'temporary-pdfs';

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

export async function signedPdfUploadUrl(path: string) {
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

export async function deletePdf(path: string) {
  const { url } = settings();
  await checked(await fetch(`${url}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: [path] }),
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

export function jsonError(error: unknown) {
  console.error(error);
  const message = error instanceof Error && error.message.includes('환경변수') ? error.message : '요청을 처리하지 못했습니다.';
  return Response.json({ error: message }, { status: 500 });
}
