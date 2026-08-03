-- 마이너스 포함(A) / 미포함(B) 카드 분리
-- Supabase 대시보드 > SQL Editor 에서 실행하세요.

alter table nest_egg_cards
  add column if not exists include_negatives boolean not null default true;
