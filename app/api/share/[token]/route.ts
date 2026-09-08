import { db, jsonError, signedPdfUrl, type TemporaryBook } from '@/lib/supabase-server';

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const response = await db(`temporary_books?share_token=eq.${encodeURIComponent(token)}&share_enabled=eq.true&select=id,title,storage_path,expires_at&limit=1`);
    const book = (await response.json() as TemporaryBook[])[0];
    if (!book) return Response.json({ error: '유효하지 않은 공유 링크입니다.' }, { status: 404 });
    if (new Date(book.expires_at) <= new Date()) return Response.json({ error: '이 책의 공유 기간이 종료되었습니다.' }, { status: 410 });
    return Response.json({ book: { title: book.title, expiresAt: book.expires_at }, pdfUrl: await signedPdfUrl(book.storage_path) });
  } catch (error) { return jsonError(error); }
}
