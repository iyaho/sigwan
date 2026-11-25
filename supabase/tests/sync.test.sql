-- M2 서버 스키마 시험 — RLS(부록 A.10 1~3번), 동기화 push/pull, 7장 충돌 규칙.
-- 로컬: local-stub.sql → migrations/*.sql → 이 파일 (supabase/tests/run-local.sh)
-- 실패하면 ASSERT가 멈춘다. 끝까지 가면 마지막 줄에 'ALL PASSED'.
\set ON_ERROR_STOP 1
\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B '''bbbbbbbb-0000-0000-0000-000000000002'''
insert into auth.users values (:A), (:B);

create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
$$;
create function pg_temp.task(id text, upd text, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', id, 'user_id', 'local-user', 'title', id, 'kind', 'deadline', 'status', 'todo',
    'estimate_min', 60, 'spent_min', 0, 'importance', 3, 'progress', 0, 'pinned', false, 'sort_order', 1,
    'source', 'manual', 'estimate_is_ai', false, 'is_locked', false,
    'created_at', '2026-11-01T00:00:00Z', 'updated_at', upd, 'rev', 7) || extra;
$$;

-- 1. A가 올린다 — user_id는 서버가 A로 덮는다 ─────────────────────────────
begin;
select pg_temp.as_user(:A);
do $$ declare r jsonb; begin
  r := public.sync_push(jsonb_build_array(
    jsonb_build_object('seq', 1, 'table', 'tasks', 'row', pg_temp.task('t1', '2026-11-25T01:00:00Z')),
    jsonb_build_object('seq', 2, 'table', 'routines', 'row', jsonb_build_object('id', 'r1', 'timetable_id', 'tt-legacy',
      'name', '자료구조', 'weekdays', jsonb_build_array(0, 2), 'start_min', 630, 'end_min', 720, 'color', '#3e63dd',
      'deleted_at', null, 'updated_at', '2026-11-25T01:00:00Z')),
    jsonb_build_object('seq', 3, 'table', 'task_tags', 'row', jsonb_build_object('task_id', 't1', 'tag_ids', jsonb_build_array('g1', 'g2'), 'updated_at', '2026-11-25T01:00:00Z')),
    jsonb_build_object('seq', 4, 'table', 'settings', 'row', jsonb_build_object('user_id', 'local-user',
      'sleep', jsonb_build_object('weekdayStart', 60, 'weekdayEnd', 480, 'weekendStart', 120, 'weekendEnd', 600),
      'weight_urgent', 0.6, 'half_life_hours', 48, 'gap_min', 10, 'updated_at', '2026-11-25T01:00:00Z')),
    jsonb_build_object('seq', 5, 'table', 'timetables', 'row', jsonb_build_object('id', 'tt-legacy', 'name', '기본',
      'active_from', null, 'active_to', null, 'deleted_at', null, 'updated_at', '2026-11-25T01:00:00Z'))
  ));
  assert r->'applied' = '[1,2,3,4,5]', format('push 1: %s', r);
  assert jsonb_array_length(r->'rejected') = 0, format('push 1 rejected: %s', r);
  assert (select user_id::text from public.tasks where id = 't1') = 'aaaaaaaa-0000-0000-0000-000000000001', 'user_id 덮어쓰기';
  assert (select weekdays from public.routines where id = 'r1') = '{0,2}', '배열 왕복';
  assert (select tag_ids from public.task_tags where task_id = 't1') = '{g1,g2}', 'task_tags 배열';
end $$;
commit;

-- 2. pull — A는 다섯 줄을 받고, 커서가 맞다 ──────────────────────────────
begin;
select pg_temp.as_user(:A);
do $$ declare r jsonb; begin
  r := public.sync_pull(0);
  assert jsonb_array_length(r->'changes') = 5, format('pull: %s', r);
  assert (r->>'rev')::int = 5, format('rev: %s', r->>'rev');
  assert (r->>'more')::boolean = false, 'more';
  assert not (r->'changes'->0->'row' ? 'server_rev'), 'server_rev는 내려보내지 않는다';
  r := public.sync_pull(5);
  assert jsonb_array_length(r->'changes') = 0, '커서 이후엔 없다';
  r := public.sync_pull(0, 2);
  assert jsonb_array_length(r->'changes') = 2 and (r->>'more')::boolean and (r->>'rev')::int = 2, format('페이지: %s', r);
end $$;
commit;

-- 3. A.10-1 — B는 A의 행을 못 본다 ─────────────────────────────────────
begin;
select pg_temp.as_user(:B);
do $$ begin
  assert (select count(*) from public.tasks) = 0, 'B가 A의 tasks를 본다 (IDOR)';
  assert (select count(*) from public.tasks where id = 't1') = 0, 'B가 id로 A의 행을 찾는다';
  assert jsonb_array_length(public.sync_pull(0)->'changes') = 0, 'B의 pull에 A의 행이 섞인다';
  assert (select count(*) from public.sync_state) = 0, 'B가 A의 rev 카운터를 본다';
end $$;
commit;

-- 4. 같은 id라도 사용자가 다르면 다른 행이다 (tt-legacy) ──────────────────
begin;
select pg_temp.as_user(:B);
do $$ declare r jsonb; begin
  r := public.sync_push(jsonb_build_array(
    jsonb_build_object('seq', 1, 'table', 'timetables', 'row', jsonb_build_object('id', 'tt-legacy', 'name', 'B의 기본',
      'updated_at', '2026-11-25T09:00:00Z')),
    jsonb_build_object('seq', 2, 'table', 'tasks', 'row', pg_temp.task('t1', '2026-11-25T09:00:00Z', '{"title":"B의 것"}'))));
  assert r->'applied' = '[1,2]', format('B push: %s', r);
  assert (r->>'rev')::int = 2, 'B의 rev는 A와 따로 센다';
end $$;
commit;
begin;
select pg_temp.as_user(:A);
do $$ begin
  assert (select name from public.timetables where id = 'tt-legacy') = '기본', 'B가 A의 시간표를 덮었다';
  assert (select title from public.tasks where id = 't1') = 't1', 'B가 A의 할 일을 덮었다';
end $$;
commit;

-- 5. A.10-2 — 내 행의 user_id를 남의 것으로 못 바꾼다 ───────────────────
begin;
select pg_temp.as_user(:A);
do $$ begin
  begin
    update public.tasks set user_id = 'bbbbbbbb-0000-0000-0000-000000000002' where id = 't1';
    raise exception 'user_id를 바꿀 수 있었다';
  exception when insufficient_privilege then null;  -- WITH CHECK 위반
  end;
end $$;
commit;

-- 6. A.10-3 — 부속 테이블에 B 이름으로 직접 넣지 못한다 ──────────────────
begin;
select pg_temp.as_user(:A);
do $$ begin
  begin
    insert into public.task_tags (user_id, task_id, tag_ids, updated_at, server_rev)
    values ('bbbbbbbb-0000-0000-0000-000000000002', 'x', '{}', now(), 0);
    raise exception 'B 이름으로 task_tags를 넣었다';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.routine_checks (user_id, id, routine_id, day, checked_at, updated_at, server_rev)
    values ('bbbbbbbb-0000-0000-0000-000000000002', 'r1:2026-11-25', 'r1', '2026-11-25', now(), now(), 0);
    raise exception 'B 이름으로 routine_checks를 넣었다';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.tasks where id = 't1';
    assert (select count(*) from public.tasks where id = 't1') = 1, '클라이언트가 물리 삭제했다 (DELETE 정책 없어야)';
  end;
end $$;
commit;

-- 7. 충돌 규칙 ───────────────────────────────────────────────────────
begin;
select pg_temp.as_user(:A);
do $$ declare r jsonb; base bigint; begin
  base := (select server_rev from public.tasks where id = 't1');

  -- 7-1 옛 행(updated_at이 더 이르고 base도 옛것) → 무시
  r := public.sync_push(jsonb_build_array(jsonb_build_object('seq', 1, 'table', 'tasks', 'base_rev', 0,
    'row', pg_temp.task('t1', '2026-11-24T00:00:00Z', '{"title":"옛 제목"}'))));
  assert (select title from public.tasks where id = 't1') = 't1', format('옛 행이 이겼다 %s', r);

  -- 7-2 기기 X가 완료(최신을 보고) → done
  r := public.sync_push(jsonb_build_array(jsonb_build_object('seq', 1, 'table', 'tasks', 'base_rev', base,
    'row', pg_temp.task('t1', '2026-11-25T02:00:00Z', '{"status":"done","completed_at":"2026-11-25T02:00:00Z","spent_min":30}'))));
  assert (select status from public.tasks where id = 't1') = 'done', 'done 반영';

  -- 7-3 기기 Y가 완료를 모른 채 제목만 고침(더 나중, base 옛것) → 제목은 Y, status는 done 유지, spent는 큰 값
  r := public.sync_push(jsonb_build_array(jsonb_build_object('seq', 1, 'table', 'tasks', 'base_rev', base,
    'row', pg_temp.task('t1', '2026-11-25T03:00:00Z', '{"title":"Y가 고친 제목","spent_min":10}'))));
  assert (select title from public.tasks where id = 't1') = 'Y가 고친 제목', 'LWW: 나중 것이 이긴다';
  assert (select status from public.tasks where id = 't1') = 'done', '충돌에서는 done이 이긴다';
  assert (select spent_min from public.tasks where id = 't1') = 30, 'spent_min은 큰 값';
  assert (select completed_at from public.tasks where id = 't1') = '2026-11-25T02:00:00Z', 'completed_at 유지';

  -- 7-4 Y가 pull해서 done을 본 뒤 일부러 체크 해제 → 그대로 todo
  base := (select server_rev from public.tasks where id = 't1');
  r := public.sync_push(jsonb_build_array(jsonb_build_object('seq', 1, 'table', 'tasks', 'base_rev', base,
    'row', pg_temp.task('t1', '2026-11-25T04:00:00Z', '{"title":"Y가 고친 제목","status":"todo","completed_at":null,"spent_min":30}'))));
  assert (select status from public.tasks where id = 't1') = 'todo', '최신을 보고 푼 체크는 풀린다';

  -- 7-5 같은 행을 그대로 다시 올려도(재시도) 번호가 오르지 않는다
  base := (select server_rev from public.tasks where id = 't1');
  r := public.sync_push(jsonb_build_array(jsonb_build_object('seq', 1, 'table', 'tasks', 'base_rev', base,
    'row', pg_temp.task('t1', '2026-11-25T04:00:00Z', '{"title":"Y가 고친 제목","status":"todo","completed_at":null,"spent_min":30}'))));
  assert (select server_rev from public.tasks where id = 't1') = base, format('멱등이 아니다 %s', r);
end $$;
commit;

-- 8. 한 줄이 틀려도 나머지는 들어간다 ────────────────────────────────────
begin;
select pg_temp.as_user(:A);
do $$ declare r jsonb; begin
  r := public.sync_push(jsonb_build_array(
    jsonb_build_object('seq', 10, 'table', 'tasks', 'row', pg_temp.task('bad', '2026-11-25T05:00:00Z', '{"importance":9}')),
    jsonb_build_object('seq', 11, 'table', 'nope', 'row', '{}'::jsonb),
    jsonb_build_object('seq', 12, 'table', 'blocks', 'row', jsonb_build_object('id', 'b1', 'task_id', 't1',
      'start_at', '2026-11-25T05:00:00Z', 'end_at', '2026-11-25T06:00:00Z', 'is_all_day', false, 'source', 'drag',
      'updated_at', '2026-11-25T05:00:00Z'))));
  assert r->'applied' = '[12]', format('applied: %s', r);
  assert jsonb_array_length(r->'rejected') = 2, format('rejected: %s', r);
  assert (select count(*) from public.tasks where id = 'bad') = 0, '틀린 줄이 들어갔다';
end $$;
commit;

-- 9. 로그인 안 한 요청 ─────────────────────────────────────────────────
begin;
select set_config('role', 'anon', true);
do $$ begin
  begin
    perform public.sync_push('[]');
    raise exception 'anon이 sync_push를 불렀다';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.tasks) = 0, 'anon이 tasks를 본다';
end $$;
commit;

select 'ALL PASSED';
