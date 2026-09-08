import { db, jsonError, pdfStoragePlan, PDF_PART_SIZE, signedPdfUploadUrls, type TemporaryBook } from '@/lib/supabase-server';

function toClient(book: TemporaryBook) {
  return { id: book.id, title: book.title, createdAt: book.created_at, expiresAt: book.expires_at, lastViewedAt: book.last_viewed_at, lastPage: book.last_page || 1 };
}

export async function GET(request: Request) {
  try {
    const visitorId = new URL(request.url).searchParams.get('visitorId');
    if (!visitorId) return Response.json({ error: 'visitorId가 필요합니다.' }, { status: 400 });
    const response = await db(`temporary_books?visitor_id=eq.${encodeURIComponent(visitorId)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id,title,created_at,expires_at,last_viewed_at,last_page&order=last_viewed_at.desc`);
    const books = await response.json() as TemporaryBook[];
    return Response.json({ books: books.map(toClient) });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { visitorId?: string; title?: string; contentType?: string; fileSize?: number };
    const visitorId = String(body.visitorId ?? ''); const title = String(body.title ?? '').trim();
    if (!visitorId || !title) return Response.json({ error: '업로드 정보가 올바르지 않습니다.' }, { status: 400 });
    if (body.contentType && body.contentType !== 'application/pdf') return Response.json({ error: 'PDF 파일만 보관할 수 있습니다.' }, { status: 400 });
    const fileSize = Number(body.fileSize); if (!Number.isFinite(fileSize) || fileSize <= 0) return Response.json({ error: 'PDF 파일 크기를 확인할 수 없습니다.' }, { status: 400 });
    const id = crypto.randomUUID(); const { storagePath, objectPaths } = pdfStoragePlan(id, fileSize);
    const createdAt = new Date(); const expiresAt = new Date(createdAt.getTime() + 7 * 86400000);
    const uploadUrls = await signedPdfUploadUrls(objectPaths);
    const payload = { id, visitor_id: visitorId, title, storage_path: storagePath, created_at: createdAt.toISOString(), expires_at: expiresAt.toISOString(), last_viewed_at: createdAt.toISOString() };
    const response = await db('temporary_books', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload) });
    const [book] = await response.json() as TemporaryBook[];
    return Response.json({ book: toClient(book), uploadUrls, partSize: PDF_PART_SIZE }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
