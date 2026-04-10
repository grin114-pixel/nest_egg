/**
 * Nest Egg DB 초기화 스크립트
 * 
 * 사용법:
 *   1. Supabase 대시보드 > Project Settings > API > service_role key 복사
 *   2. 아래 SERVICE_ROLE_KEY 값에 붙여넣기
 *   3. 터미널에서: node setup-db.mjs
 */

const SUPABASE_URL = 'https://ygcltfujdnqiewkvgpze.supabase.co'
const SERVICE_ROLE_KEY = 'YOUR_SERVICE_ROLE_KEY_HERE'  // ← 여기에 서비스 롤 키 붙여넣기

const SQL = `
create table if not exists nest_egg_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  rows jsonb not null default '[]'::jsonb,
  manual_total numeric,
  created_at timestamptz not null default now()
);

alter table nest_egg_cards enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'nest_egg_cards'
    and policyname = 'Users can manage their own cards'
  ) then
    execute $policy$
      create policy "Users can manage their own cards"
        on nest_egg_cards for all
        using (auth.uid() = user_id)
        with check (auth.uid() = user_id)
    $policy$;
  end if;
end $$;
`

if (SERVICE_ROLE_KEY === 'YOUR_SERVICE_ROLE_KEY_HERE') {
  console.error('❌ SERVICE_ROLE_KEY를 입력해 주세요.')
  console.error('   Supabase 대시보드 > Project Settings > API > service_role (secret)')
  process.exit(1)
}

const res = await fetch(`https://api.supabase.com/v1/projects/ygcltfujdnqiewkvgpze/database/query`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: SQL }),
})

if (res.ok) {
  console.log('✅ 테이블이 성공적으로 생성됐어요!')
  console.log('   이제 npm run dev 로 앱을 시작하세요.')
} else {
  const err = await res.text()
  console.error('❌ 오류 발생:', res.status, err)
}
