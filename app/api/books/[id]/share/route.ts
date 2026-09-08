import { db, jsonError, type TemporaryBook } from '@/lib/supabase-server';

async function ownerBook(id: string, visitorId: string) {
  const response = await db(`temporary_books?id=eq.${encodeURIComponent(id)}&visitor_id=eq.${encodeURIComponent(visitorId)}&select=*&limit=1`);
  return (await response.json() as TemporaryBook[])[0];
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; const { visitorId } = await request.json(); const book = await ownerBook(id, visitorId);
    if (!book) return Response.json({ error: '책을 찾을 수 없습니다.' }, { status: 404 });
    if (new Date(book.expires_at) <= new Date()) return Response.json({ error: '이 책의 임시 보관 기간이 종료되었습니다.' }, { status: 410 });
    const token = book.share_token ?? `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`;
    await db(`temporary_books?id=eq.${encodeURIComponent(id)}&visitor_id=eq.${encodeURIComponent(visitorId)}`, { method: 'PATCH', body: JSON.stringify({ share_token: token, share_enabled: true }) });
    return Response.json({ shareToken: token, title: book.title, expiresAt: book.expires_at });
  } catch (error) { return jsonError(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; const { visitorId } = await request.json(); const book = await ownerBook(id, visitorId);
    if (!book) return Response.json({ error: '책을 찾을 수 없습니다.' }, { status: 404 });
    await db(`temporary_books?id=eq.${encodeURIComponent(id)}&visitor_id=eq.${encodeURIComponent(visitorId)}`, { method: 'PATCH', body: JSON.stringify({ share_enabled: false }) });
    return Response.json({ ok: true });
  } catch (error) { return jsonError(error); }
}
