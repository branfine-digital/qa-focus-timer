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

-- Added later: rotating fun headers ("Time to lock in", "Now testing: your
-- patience", etc.) shown instead of the plain "Work session" / "Break"
-- label. One is picked at random when a timer starts and stored here so
-- everyone in the room sees the same line for that session.
alter table timer_state add column if not exists header_text text;

-- Added later: break-room games (Memory Match / Wordle Duel). One row per
-- challenge/game -- same "single shared row that everyone reads via
-- Realtime" pattern as timer_state above, just one row per game instead of
-- a single fixed row.
create extension if not exists pgcrypto;

create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  type text not null,                    -- 'memory' | 'wordle'
  status text not null default 'pending', -- 'pending' | 'active' | 'declined' | 'finished' | 'abandoned'
  player1_id text not null,              -- the challenger (goes first)
  player1_name text not null,
  player2_id text not null,
  player2_name text not null,
  turn text,                             -- client id of whoever's turn it is
  winner text,                           -- client id of the winner, 'tie', or null
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table games enable row level security;

drop policy if exists "Allow anonymous read" on games;
create policy "Allow anonymous read"
  on games for select
  using (true);

drop policy if exists "Allow anonymous insert" on games;
create policy "Allow anonymous insert"
  on games for insert
  with check (true);

drop policy if exists "Allow anonymous update" on games;
create policy "Allow anonymous update"
  on games for update
  using (true)
  with check (true);

alter publication supabase_realtime add table games;
