-- ===================================================================
--  益田市イベントカレンダー — Supabase セットアップ SQL（決定版）
--  Supabase ダッシュボード > SQL Editor で実行してください
-- ===================================================================

-- ===== 1. events テーブル作成 =====
create table if not exists public.events (
  id         uuid        primary key default gen_random_uuid(),
  title      text        not null,
  date       date        not null,
  place      text,
  area       text        check (area is null or area in ('市街地','美都','匹見','浜田市','津和野','その他')),
  comment    text,
  link       text,
  images     text[]      not null default '{}',
  image_url  text,                              -- 旧形式との後方互換（読み取り専用）
  is_news    boolean     not null default false,
  posted     boolean     not null default false,
  created_at timestamptz not null default now(),

  -- 同じ日付＋同じタイトルは二重登録しない
  constraint events_date_title_key unique (date, title)
);

-- 検索用インデックス
create index if not exists events_date_idx   on public.events (date);
create index if not exists events_is_news_idx on public.events (is_news);

-- ===== 2. Row Level Security（RLS）有効化 =====
alter table public.events enable row level security;

-- 全員が読み取り可能
create policy "Public read events"
  on public.events for select
  using (true);

-- ログイン中のユーザーだけが書き込み可能
create policy "Auth insert events"
  on public.events for insert
  with check (auth.role() = 'authenticated');

create policy "Auth update events"
  on public.events for update
  using (auth.role() = 'authenticated');

create policy "Auth delete events"
  on public.events for delete
  using (auth.role() = 'authenticated');


-- ===================================================================
--  3. Storage バケット設定
--  ※ バケット自体は Dashboard > Storage > New bucket から作成してください
--     Bucket name : event-images
--     Public       : ON（チェックを入れる）
--
--  バケット作成後、以下を SQL Editor で実行してください
-- ===================================================================

create policy "Public read event images"
  on storage.objects for select
  using (bucket_id = 'event-images');

create policy "Auth upload event images"
  on storage.objects for insert
  with check (
    bucket_id = 'event-images'
    and auth.role() = 'authenticated'
  );

create policy "Auth delete event images"
  on storage.objects for delete
  using (
    bucket_id = 'event-images'
    and auth.role() = 'authenticated'
  );
