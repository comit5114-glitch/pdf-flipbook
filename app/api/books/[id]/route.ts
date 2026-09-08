import { db, deletePdf, jsonError, signedPdfUrl, type TemporaryBook } from '@/lib/supabase-server';

async function findBook(id: string, visitorId: string) {
  const response = await db(`temporary_books?id=eq.${encodeURIComponent(id)}&visitor_id=eq.${encodeURIComponent(visitorId)}&select=*&limit=1`);
  return (await response.json() as TemporaryBook[])[0];
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; const visitorId = new URL(request.url).searchParams.get('visitorId') ?? '';
    const book = await findBook(id, visitorId);
    if (!book) return Response.json({ error: '책을 찾을 수 없습니다.' }, { status: 404 });
    if (new Date(book.expires_at) <= new Date()) return Response.json({ error: '이 책의 임시 보관 기간이 종료되었습니다.' }, { status: 410 });
    await db(`temporary_books?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ last_viewed_at: new Date().toISOString() }) });
    return Response.json({ book: { id: book.id, title: book.title, expiresAt: book.expires_at, lastPage: book.last_page || 1 }, pdfUrl: await signedPdfUrl(book.storage_path) });
  } catch (error) { return jsonError(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; const { visitorId, lastPage } = await request.json(); const book = await findBook(id, visitorId);
    if (!book) return Response.json({ error: '책을 찾을 수 없습니다.' }, { status: 404 });
    if (new Date(book.expires_at) <= new Date()) return Response.json({ error: '이 책의 임시 보관 기간이 종료되었습니다.' }, { status: 410 });
    const page = Number.isFinite(Number(lastPage)) ? Math.max(1, Math.floor(Number(lastPage))) : 1;
    await db(`temporary_books?id=eq.${encodeURIComponent(id)}&visitor_id=eq.${encodeURIComponent(visitorId)}`, { method: 'PATCH', body: JSON.stringify({ last_page: page, last_viewed_at: new Date().toISOString() }) });
    return Response.json({ ok: true });
  } catch (error) { return jsonError(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; const { visitorId } = await request.json(); const book = await findBook(id, visitorId);
    if (!book) return Response.json({ error: '책을 찾을 수 없습니다.' }, { status: 404 });
    await deletePdf(book.storage_path); await db(`temporary_books?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    return Response.json({ ok: true });
  } catch (error) { return jsonError(error); }
}
