import { db, jsonError, uploadPdf, type TemporaryBook } from '@/lib/supabase-server';

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
    const form = await request.formData(); const file = form.get('file');
    const visitorId = String(form.get('visitorId') ?? ''); const title = String(form.get('title') ?? '');
    if (!(file instanceof File) || !visitorId || !title) return Response.json({ error: '업로드 정보가 올바르지 않습니다.' }, { status: 400 });
    if (file.type !== 'application/pdf') return Response.json({ error: 'PDF 파일만 보관할 수 있습니다.' }, { status: 400 });
    const id = crypto.randomUUID(); const storagePath = `temporary/${id}/book.pdf`;
    const createdAt = new Date(); const expiresAt = new Date(createdAt.getTime() + 7 * 86400000);
    await uploadPdf(storagePath, file);
    const payload = { id, visitor_id: visitorId, title, storage_path: storagePath, created_at: createdAt.toISOString(), expires_at: expiresAt.toISOString(), last_viewed_at: createdAt.toISOString() };
    const response = await db('temporary_books', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload) });
    const [book] = await response.json() as TemporaryBook[];
    return Response.json({ book: toClient(book) }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
