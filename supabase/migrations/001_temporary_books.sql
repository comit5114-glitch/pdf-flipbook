create table if not exists public.temporary_books (
  id uuid primary key,
  visitor_id text not null,
  title text not null,
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_viewed_at timestamptz not null default now(),
  last_page integer not null default 1 check (last_page >= 1)
);

create index if not exists temporary_books_visitor_idx on public.temporary_books (visitor_id, last_viewed_at desc);
create index if not exists temporary_books_expiry_idx on public.temporary_books (expires_at);
alter table public.temporary_books enable row level security;

insert into storage.buckets (id, name, public, allowed_mime_types)
values ('temporary-pdfs', 'temporary-pdfs', false, array['application/pdf'])
on conflict (id) do update set public = false, allowed_mime_types = excluded.allowed_mime_types;

alter table public.temporary_books
  add column if not exists last_page integer not null default 1 check (last_page >= 1);
