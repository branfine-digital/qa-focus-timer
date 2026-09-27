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

-- Added later: a shared, no-repeat-until-exhausted word bank for Wordle
-- Duel. This lives server-side (not just picked client-side) so "don't
-- repeat a word until every other word has been used" holds true across
-- the whole team's games, not just one browser tab.
--
-- Seeded here with a placeholder 65-word list -- once Bran's real 100-word
-- list is ready, swap it in with:
--
--   update wordle_pool
--   set all_words = ARRAY['WORD1','WORD2', ... all 100 ...],
--       remaining = ARRAY['WORD1','WORD2', ... all 100 ...]
--   where id = 1;
create table if not exists wordle_pool (
  id integer primary key default 1 check (id = 1),
  all_words text[] not null,
  remaining text[] not null,
  updated_at timestamptz not null default now()
);

insert into wordle_pool (id, all_words, remaining)
values (
  1,
  ARRAY['APPLE','BEACH','BRAVE','BREAD','BRICK','CHESS','CHILL','CLOUD','CRISP','DAISY',
        'DELTA','DOUGH','DRIFT','EAGLE','EARTH','FANCY','FIELD','FLAME','FLASH','FRESH',
        'GHOST','GRAPE','GRASS','GREEN','HAPPY','HEART','HONEY','HOUSE','IVORY','JOLLY',
        'LEMON','LIGHT','MANGO','MAPLE','MUSIC','NOBLE','NORTH','OCEAN','PAPER','PEACH',
        'PIXEL','PLANT','QUIET','RIVER','ROBOT','SMILE','SNACK','SNOWY','SOLAR','SPARK',
        'STONE','STORM','SUGAR','SUNNY','SWIFT','TIGER','TOAST','TRAIN','TULIP','UNITY',
        'VIVID','WATER','WHEAT','WITTY','ZEBRA'],
  ARRAY['APPLE','BEACH','BRAVE','BREAD','BRICK','CHESS','CHILL','CLOUD','CRISP','DAISY',
        'DELTA','DOUGH','DRIFT','EAGLE','EARTH','FANCY','FIELD','FLAME','FLASH','FRESH',
        'GHOST','GRAPE','GRASS','GREEN','HAPPY','HEART','HONEY','HOUSE','IVORY','JOLLY',
        'LEMON','LIGHT','MANGO','MAPLE','MUSIC','NOBLE','NORTH','OCEAN','PAPER','PEACH',
        'PIXEL','PLANT','QUIET','RIVER','ROBOT','SMILE','SNACK','SNOWY','SOLAR','SPARK',
        'STONE','STORM','SUGAR','SUNNY','SWIFT','TIGER','TOAST','TRAIN','TULIP','UNITY',
        'VIVID','WATER','WHEAT','WITTY','ZEBRA']
)
on conflict (id) do nothing;

alter table wordle_pool enable row level security;

drop policy if exists "Allow anonymous read" on wordle_pool;
create policy "Allow anonymous read"
  on wordle_pool for select
  using (true);

-- No anonymous UPDATE policy on purpose -- the pool is only ever mutated
-- through pick_wordle_word() below (a security definer function), so a
-- client can read the pool but can't otherwise rewrite it directly.

-- Atomically pops one word off the remaining pool (locking the row so two
-- challenges started at the same moment can't both grab the same word),
-- refilling from the full 100-word list once the pool runs out.
create or replace function pick_wordle_word()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  chosen text;
  pool text[];
  full_list text[];
begin
  select remaining, all_words into pool, full_list from wordle_pool where id = 1 for update;

  if pool is null or array_length(pool, 1) is null or array_length(pool, 1) = 0 then
    pool := full_list;
  end if;

  chosen := pool[1 + floor(random() * array_length(pool, 1))::int];
  pool := array_remove(pool, chosen);

  update wordle_pool set remaining = pool, updated_at = now() where id = 1;

  return chosen;
end;
$$;

grant execute on function pick_wordle_word() to anon;

-- Added later: swap the placeholder word bank for Bran's real 100-word
-- list (no proper nouns, no onomatopoeia).
update wordle_pool
set all_words = ARRAY['APPLE','BRAVE','CRANE','DREAM','ELBOW','FLAME','GRAPE','HOUSE','IVORY','JELLY',
                       'KNEEL','LEMON','MAPLE','NIGHT','OCEAN','PEARL','QUEEN','RIVER','STONE','TIGER',
                       'UNITY','VIVID','WHALE','YOUTH','ZEBRA','AMBER','BLOOM','CANDY','DANCE','EAGER',
                       'FROST','GIANT','HONEY','INDEX','JUDGE','KARMA','LIGHT','MANGO','NOBLE','OLIVE',
                       'PIANO','QUILT','ROBIN','SPICE','TABLE','URBAN','VAULT','WHEAT','YIELD','ADORN',
                       'BERRY','CHARM','DIARY','EARTH','FANCY','GLAZE','HEART','INLET','JOKER','KOALA',
                       'LUNAR','MEDAL','NERVE','OASIS','PEACH','QUIET','RADAR','SHEEP','TRAIL','UNCLE',
                       'VERSE','WITCH','XENON','YOUNG','ZESTY','ARENA','BLADE','CORAL','DINER','EVERY',
                       'FEVER','GLORY','HUMID','IDEAL','JOINT','KAYAK','LUCKY','MAGIC','NURSE','ORBIT',
                       'PROUD','RELAY','SCARF','THORN','UPPER','VISIT','WOMAN','EXTRA','SALAD','BRUSH'],
    remaining = ARRAY['APPLE','BRAVE','CRANE','DREAM','ELBOW','FLAME','GRAPE','HOUSE','IVORY','JELLY',
                       'KNEEL','LEMON','MAPLE','NIGHT','OCEAN','PEARL','QUEEN','RIVER','STONE','TIGER',
                       'UNITY','VIVID','WHALE','YOUTH','ZEBRA','AMBER','BLOOM','CANDY','DANCE','EAGER',
                       'FROST','GIANT','HONEY','INDEX','JUDGE','KARMA','LIGHT','MANGO','NOBLE','OLIVE',
                       'PIANO','QUILT','ROBIN','SPICE','TABLE','URBAN','VAULT','WHEAT','YIELD','ADORN',
                       'BERRY','CHARM','DIARY','EARTH','FANCY','GLAZE','HEART','INLET','JOKER','KOALA',
                       'LUNAR','MEDAL','NERVE','OASIS','PEACH','QUIET','RADAR','SHEEP','TRAIL','UNCLE',
                       'VERSE','WITCH','XENON','YOUNG','ZESTY','ARENA','BLADE','CORAL','DINER','EVERY',
                       'FEVER','GLORY','HUMID','IDEAL','JOINT','KAYAK','LUCKY','MAGIC','NURSE','ORBIT',
                       'PROUD','RELAY','SCARF','THORN','UPPER','VISIT','WOMAN','EXTRA','SALAD','BRUSH'],
    updated_at = now()
where id = 1;

-- Added later: rematches. Both players have to opt in (rematch_by) before
-- a fresh game starts; rematch_started guards against creating it twice.
alter table games add column if not exists rematch_by text[] not null default '{}';
alter table games add column if not exists rematch_started boolean not null default false;

-- Added later: Pictionary (1v1 challenges and host-only "Super Challenge"
-- group games). Game rows reuse the existing `games` table (type
-- 'pictionary' or 'pictionary_group'), so no new columns are needed. Two
-- small helpers make it fair:
--
-- 1) server_now(): every browser asks the database for the time once when
--    it joins, so round timers and "points = seconds left" line up for
--    everyone even if someone's computer clock is off.
create or replace function server_now()
returns timestamptz
language sql
stable
as $$ select now() $$;

grant execute on function server_now() to anon;

-- 2) A shared, no-repeat-until-exhausted Pictionary word rotation. The
--    word list itself (and each word's accepted alternates) lives in
--    pictionary-words.js so it's easy to edit. This table only remembers
--    which words have already been used, team-wide. The browser passes in
--    the full current list; the function picks `how_many` words that
--    haven't been used yet, and starts over once everything has been used.
create table if not exists pictionary_pool (
  id integer primary key default 1 check (id = 1),
  used text[] not null default '{}',
  updated_at timestamptz not null default now()
);

insert into pictionary_pool (id) values (1) on conflict (id) do nothing;

alter table pictionary_pool enable row level security;

drop policy if exists "Allow anonymous read" on pictionary_pool;
create policy "Allow anonymous read"
  on pictionary_pool for select
  using (true);

create or replace function pick_pictionary_words(candidates text[], how_many integer)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  used_now text[];
  fresh text[];
  picked text[] := '{}';
  w text;
begin
  if candidates is null or array_length(candidates, 1) is null or how_many < 1 then
    return picked;
  end if;

  select used into used_now from pictionary_pool where id = 1 for update;
  if used_now is null then used_now := '{}'; end if;

  for i in 1..how_many loop
    select array_agg(c) into fresh
    from unnest(candidates) as c
    where not (c = any(used_now)) and not (c = any(picked));

    if fresh is null then
      -- Everything in the current list has been used: start a new cycle
      -- (still avoiding repeats inside this one game).
      used_now := '{}';
      select array_agg(c) into fresh
      from unnest(candidates) as c
      where not (c = any(picked));
    end if;

    exit when fresh is null;
    w := fresh[1 + floor(random() * array_length(fresh, 1))::int];
    picked := array_append(picked, w);
    used_now := array_append(used_now, w);
  end loop;

  update pictionary_pool set used = used_now, updated_at = now() where id = 1;
  return picked;
end;
$$;

grant execute on function pick_pictionary_words(text[], integer) to anon;

-- Added later: Pictionary "New word" button. The drawer can swap their
-- word once per turn; the skipped word goes back into the rotation (it's
-- removed from `used`) and a fresh one is picked, avoiding every word
-- already in this game (`exclude`). Safe to re-run.
create or replace function swap_pictionary_word(candidates text[], skipped text, exclude text[])
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  used_now text[];
  fresh text[];
  w text;
begin
  select used into used_now from pictionary_pool where id = 1 for update;
  if used_now is null then used_now := '{}'; end if;
  used_now := array_remove(used_now, skipped);

  select array_agg(c) into fresh
  from unnest(candidates) as c
  where not (c = any(used_now)) and not (c = any(coalesce(exclude, '{}'))) and c is distinct from skipped;

  if fresh is null then
    used_now := '{}';
    select array_agg(c) into fresh
    from unnest(candidates) as c
    where not (c = any(coalesce(exclude, '{}'))) and c is distinct from skipped;
  end if;

  if fresh is null then return null; end if;
  w := fresh[1 + floor(random() * array_length(fresh, 1))::int];
  used_now := array_append(used_now, w);
  update pictionary_pool set used = used_now, updated_at = now() where id = 1;
  return w;
end;
$$;

grant execute on function swap_pictionary_word(text[], text, text[]) to anon;
