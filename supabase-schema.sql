-- Run this once in Supabase: Project -> SQL Editor -> New query -> paste all -> Run

create table if not exists timer_state (
  id integer primary key default 1 check (id = 1),
  mode text not null default 'idle',              -- 'idle' | 'work' | 'break'
  duration_sec integer,
  started_at timestamptz,
  ends_at timestamptz,
  started_by text,
  updated_at timestamptz not null default now()
);

insert into timer_state (id, mode)
values (1, 'idle')
on conflict (id) do nothing;

-- Row Level Security: this is an internal tool with no login, so we allow
-- anyone with the anon key (i.e. anyone with the site URL) to read and
-- update the single shared timer row. That matches the "anyone can start
-- the timer" behavior you asked for.
alter table timer_state enable row level security;

drop policy if exists "Allow anonymous read" on timer_state;
create policy "Allow anonymous read"
  on timer_state for select
  using (true);

drop policy if exists "Allow anonymous update" on timer_state;
create policy "Allow anonymous update"
  on timer_state for update
  using (true)
  with check (true);

-- Make sure changes to this table are pushed out over Realtime.
alter publication supabase_realtime add table timer_state;
