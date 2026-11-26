-- 시관 M2 — 테이블 권한을 명시한다.
--
-- 처음 마이그레이션은 Supabase가 public의 새 테이블을 anon·authenticated에 자동으로 열어 준다고 가정했다.
-- 지금 프로젝트는 그렇지 않다 — 로그인한 사용자도 "permission denied"를 받았다 (2026-11-25 실서버 확인).
-- 권한(GRANT)은 "이 테이블에 손댈 수 있나", RLS는 "그중 어느 행인가"다. 둘 다 있어야 동작한다.
--
--  * authenticated: SELECT · INSERT · UPDATE만. DELETE는 주지 않는다 — 클라이언트는 툼스톤만 쓴다
--  * anon: 아무것도 없다. 로그인 전에는 서버 데이터에 접근하지 않는다
--  * sync_state: SELECT만 (sync_push가 마지막에 rev를 읽는다). 쓰기는 트리거(security definer)만

do $$
declare t text;
begin
  foreach t in array array['tasks','blocks','tags','task_tags','timetables','routines','routine_checks','settings'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;

revoke all on public.sync_state from anon, authenticated;
grant select on public.sync_state to authenticated;
