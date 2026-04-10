-- 저장(RLS) 막힘 해결 — Supabase 대시보드 → SQL Editor → New query → 전체 붙여넣기 → Run
-- (migration.sql 을 이미 돌렸다면 이 파일과 중복되는 부분은 무시됩니다)

-- 1) PIN 해시 테이블
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

-- 2) 카드: user_id 제거 + 누구나 읽기/쓰기 (앱 PIN으로 보호)
drop policy if exists "Users can manage their own cards" on nest_egg_cards;

alter table nest_egg_cards drop column if exists user_id;

drop policy if exists "nest_egg_cards_all" on nest_egg_cards;
create policy "nest_egg_cards_all"
  on nest_egg_cards for all
  using (true)
  with check (true);

-- 3) API(anon 키)가 테이블에 접근할 수 있게 권한 (RLS와 함께 필요한 경우가 많음)
grant usage on schema public to anon, authenticated;
grant all on table public.nest_egg_cards to anon, authenticated;
grant all on table public.nest_egg_app_settings to anon, authenticated;
