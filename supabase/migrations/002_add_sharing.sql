alter table public.temporary_books
  add column if not exists share_token text unique,
  add column if not exists share_enabled boolean not null default false;

create unique index if not exists temporary_books_share_token_idx
  on public.temporary_books (share_token)
  where share_token is not null;
