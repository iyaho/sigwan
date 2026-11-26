-- 로컬 Postgres에서 마이그레이션을 시험할 때만 쓴다. **Supabase에는 돌리지 말 것** — 거기엔 이미 있다.
-- Supabase가 원래 갖고 있는 것(역할 둘, auth.users, auth.uid())만 흉내 낸다.
-- 역할은 클러스터 전체에 남으므로 두 번째 실행부터는 이미 있다
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
-- 새 테이블에 자동 권한을 주지 않는다 — 지금 Supabase 프로젝트가 그렇다(2026-11 실서버 확인).
-- 예전 프로젝트처럼 자동으로 열어 두면 마이그레이션에서 GRANT를 빠뜨려도 이 시험이 통과해 버린다
