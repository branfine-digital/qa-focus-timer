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
