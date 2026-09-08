// @ts-nocheck
const corsHeaders = { 'Content-Type': 'application/json' };

Deno.serve(async (request: Request) => {
  const expectedSecret = Deno.env.get('CLEANUP_CRON_SECRET');
  if (!expectedSecret || request.headers.get('x-cron-secret') !== expectedSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return new Response(JSON.stringify({ error: 'Missing Supabase settings' }), { status: 500, headers: corsHeaders });
  const auth = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
  const expiredResponse = await fetch(`${supabaseUrl}/rest/v1/temporary_books?expires_at=lt.${encodeURIComponent(new Date().toISOString())}&select=id,storage_path`, { headers: auth });
  if (!expiredResponse.ok) return new Response(JSON.stringify({ error: 'Could not load expired books' }), { status: 500, headers: corsHeaders });

  const expired = await expiredResponse.json(); const deleted: string[] = []; const failed: Array<{ id: string; reason: string }> = [];
  for (const book of expired) {
    try {
      const multipart = String(book.storage_path).match(/^multipart:(\d+):(.+)$/);
      const prefixes = multipart
        ? Array.from({ length: Number(multipart[1]) }, (_, index) => `${multipart[2]}/${String(index).padStart(4, '0')}.pdf`)
        : [book.storage_path];
      const storageResponse = await fetch(`${supabaseUrl}/storage/v1/object/temporary-pdfs`, { method: 'DELETE', headers: auth, body: JSON.stringify({ prefixes }) });
      if (!storageResponse.ok && storageResponse.status !== 404) throw new Error(`Storage ${storageResponse.status}`);
      const dbResponse = await fetch(`${supabaseUrl}/rest/v1/temporary_books?id=eq.${encodeURIComponent(book.id)}`, { method: 'DELETE', headers: auth });
      if (!dbResponse.ok) throw new Error(`Database ${dbResponse.status}`);
      deleted.push(book.id);
    } catch (error) {
      failed.push({ id: book.id, reason: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  return new Response(JSON.stringify({ scanned: expired.length, deleted: deleted.length, failed }), { status: failed.length ? 207 : 200, headers: corsHeaders });
});
