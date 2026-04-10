-- Nest Egg 최초 설정 (한 번에 실행)
-- Supabase 대시보드 > SQL Editor 에서 실행하세요.

-- PIN 설정 테이블
create table if not exists nest_egg_app_settings (
  id text primary key,
  pin_hash text not null,
  updated_at timestamptz default now()
);

alter table nest_egg_app_settings enable row level security;

drop policy if exists "nest_egg_settings_all" on nest_egg_app_settings;
create policy "nest_egg_settings_all"
  on nest_egg_app_settings for all
  using (true)
  with check (true);

-- 카드 테이블 (user_id 없음 — 앱에서 PIN으로 보호)
create table if not exists nest_egg_cards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rows jsonb not null default '[]'::jsonb,
  manual_total numeric,
  created_at timestamptz not null default now()
);

-- 이전 버전(user_id 열)에서 업그레이드한 경우
alter table nest_egg_cards drop column if exists user_id;

alter table nest_egg_cards enable row level security;

drop policy if exists "Users can manage their own cards" on nest_egg_cards;
drop policy if exists "nest_egg_cards_all" on nest_egg_cards;
create policy "nest_egg_cards_all"
  on nest_egg_cards for all
  using (true)
  with check (true);

grant usage on schema public to anon, authenticated;
grant all on table public.nest_egg_cards to anon, authenticated;
grant all on table public.nest_egg_app_settings to anon, authenticated;
