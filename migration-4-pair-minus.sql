-- 신규 카드 A/B 페어 동기화 + B 마이너스 내역
-- Supabase 대시보드 > SQL Editor 에서 실행하세요.
-- 기존 카드는 pair_id가 null 이라 이전과 동일하게 동작합니다.

alter table nest_egg_cards
  add column if not exists pair_id uuid;

alter table nest_egg_cards
  add column if not exists minus_rows jsonb not null default '[]'::jsonb;

create index if not exists nest_egg_cards_pair_id_idx
  on nest_egg_cards (pair_id);
