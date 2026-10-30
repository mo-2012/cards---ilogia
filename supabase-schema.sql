-- ============================================================
-- iLogia Cards — مخطط قاعدة البيانات المقترح (Supabase / Postgres)
-- للمراجعة فقط — لا يُطبَّق على Production دون موافقة مسؤول المنظومة.
-- يفترض وجود جدول مستخدمين مرتبط بـ auth.users كما في بقية تطبيقات iLogia.
-- ============================================================

-- 1) مجموعات الكروت
create table if not exists public.flashcard_decks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  subject     text not null default '',
  grade       text not null default '',
  description text not null default '',
  color       text not null default '#136F58',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists flashcard_decks_user_idx on public.flashcard_decks (user_id, updated_at desc);

-- 2) الكروت (تشمل حقول خوارزمية SM-2)
create table if not exists public.flashcards (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  deck_id     uuid not null references public.flashcard_decks (id) on delete cascade,
  front       text not null check (char_length(front) between 1 and 2000),
  back        text not null check (char_length(back) between 1 and 4000),
  favorite    boolean not null default false,
  -- حقول التكرار المتباعد (SM-2)
  ease        real   not null default 2.5 check (ease >= 1.3),
  interval    int    not null default 0 check (interval >= 0),   -- بالأيام
  reps        int    not null default 0,
  lapses      int    not null default 0,
  state       text   not null default 'new' check (state in ('new','learning','review','relearning')),
  difficulty  real   not null default 0,
  next_review timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists flashcards_deck_idx on public.flashcards (deck_id);
create index if not exists flashcards_due_idx  on public.flashcards (user_id, next_review);

-- 3) سجل المراجعات
create table if not exists public.flashcard_reviews (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  card_id     uuid not null references public.flashcards (id) on delete cascade,
  rating      text not null check (rating in ('again','hard','good','easy')),
  next_due    timestamptz not null,
  reviewed_at timestamptz not null default now()
);
create index if not exists flashcard_reviews_user_idx on public.flashcard_reviews (user_id, reviewed_at desc);
create index if not exists flashcard_reviews_card_idx on public.flashcard_reviews (card_id);

-- 4) جلسات المراجعة
create table if not exists public.flashcard_study_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  deck_id     uuid references public.flashcard_decks (id) on delete set null,
  manual      boolean not null default false,
  reviewed    int not null default 0,
  again       int not null default 0,
  hard        int not null default 0,
  good        int not null default 0,
  easy        int not null default 0,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz
);
create index if not exists flashcard_sessions_user_idx on public.flashcard_study_sessions (user_id, started_at desc);

-- 5) إعدادات المستخدم
create table if not exists public.flashcard_user_settings (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  daily_new      int  not null default 20  check (daily_new between 1 and 200),
  daily_review   int  not null default 100 check (daily_review between 10 and 500),
  theme          text not null default 'auto' check (theme in ('auto','light','dark')),
  notif_enabled  boolean not null default false,
  notif_time     time  not null default '18:00',
  updated_at     timestamptz not null default now()
);

-- ============================================================
-- Row Level Security — كل مستخدم يرى ويعدّل بياناته فقط
-- ============================================================
alter table public.flashcard_decks           enable row level security;
alter table public.flashcards                enable row level security;
alter table public.flashcard_reviews         enable row level security;
alter table public.flashcard_study_sessions  enable row level security;
alter table public.flashcard_user_settings   enable row level security;

create policy "decks_owner"    on public.flashcard_decks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "cards_owner"    on public.flashcards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "reviews_owner"  on public.flashcard_reviews
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "sessions_owner" on public.flashcard_study_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "settings_owner" on public.flashcard_user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- تحديث updated_at تلقائيًا
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger decks_touch  before update on public.flashcard_decks
  for each row execute function public.touch_updated_at();
create trigger cards_touch  before update on public.flashcards
  for each row execute function public.touch_updated_at();
