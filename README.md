# Focus Sprint Timer

A shared, real-time focus/break timer for the QA team, built to replace Cuckoo
(a defunct tool the team used to use). One permanent URL, everyone joins with
a name and emoji, sees who else is in the room, and shares one countdown
timer that anyone can start or end early.

Plain HTML/CSS/JS, no build step, no npm install needed. The backend is
Supabase (project `qa-focus-timer`), and hosting is Netlify.

## Repo, hosting, and database (for reference)

- GitHub: `branfine-digital/qa-focus-timer`
- Production URL: `https://qasprinttimer.netlify.app`
- Netlify site: connected to the GitHub repo above, auto-deploys `main`
- Supabase project: `qa-focus-timer` (URL and anon key are in `config.js`)

## 1. Database setup (Supabase)

One-time setup, and also what to run again any time `supabase-schema.sql`
gets new statements appended to it (each addition is written to be safe to
re-run: `create table if not exists`, `create or replace function`, etc.).

1. Supabase project → **SQL Editor** → **New query**.
2. Paste the entire contents of `supabase-schema.sql` and click **Run**.
3. Confirm in **Table Editor**: `timer_state` (one row, id = 1), `games`,
   `wordle_pool` (one row, id = 1, with a 100-word `all_words` array), and
   `pictionary_pool` (one row, id = 1) all exist.

   Tip: the very first statements in the file (the original
   `alter publication ... add table timer_state`) error if run a second
   time. When only a new section has been appended, it's simplest to paste
   and run just that section (each one is marked "Added later: ...").
4. Confirm in **Database → Replication**: `timer_state` and `games` are
   both listed under the `supabase_realtime` publication. The SQL does
   this automatically, but it's worth a glance, since without it, changes
   won't reach other browsers in real time.

`config.js` already has the project URL and anon public key wired in. The
anon key is meant to be public, embedded client-side code. Access control
is entirely via the Row Level Security policies in `supabase-schema.sql`,
not by hiding this key.

## 2. Push to GitHub

Already set up for this repo. For a brand new clone of this project:

1. `git remote add origin https://github.com/branfine-digital/qa-focus-timer.git`
2. `git push -u origin main`

Pushing (from any branch) needs a GitHub personal access token (classic,
`repo` scope) used inline in the push URL, e.g.:

```
git push https://<token>@github.com/branfine-digital/qa-focus-timer.git main
```

Never commit a token or save it into `git config`. Generate one at
GitHub → Settings → Developer settings → Personal access tokens, use it
for the push, and it can be revoked/regenerated any time.

## 3. Netlify

Already deployed and connected to this repo's `main` branch (auto-deploys
on every push to `main`). Build command is blank, publish directory is
`.` (see `netlify.toml`), since this is a static site with no build step.

## Making changes (development workflow)

Every change so far has followed this pattern, and new sessions should
keep doing the same:

1. Branch off `main`: `git checkout -b feature/<short-name>`
2. Make the change, commit, push the branch to GitHub.
3. Open a pull request from that branch into `main` (GitHub UI or API).
   This triggers a Netlify **Deploy Preview** at
   `https://deploy-preview-<PR#>--qasprinttimer.netlify.app`, a fully
   working copy of the site on its own URL, pointed at the *same*
   Supabase project as production.
4. Share the preview URL and get it approved before merging. Since the
   preview shares production's database, a schema change (new table,
   new column) needs its SQL run in Supabase before the preview can use
   it, same as production would.
5. Once approved, merge the PR into `main`. Netlify auto-deploys
   production within a minute or two of the merge. If it doesn't, an
   empty commit pushed to `main` (`git commit --allow-empty -m "..."`)
   will nudge Netlify to retry.
6. Never push a change directly to `main` without a preview step first,
   except trivial copy/doc changes (like this README) that carry no risk
   to the running app.

## Features

- **Shared timer**: work (25/45/30/10 min) and break (10/15/5 min) presets
  plus a custom duration, open to anyone in the room to start or end early.
- **Rotating headers**: a random fun one-liner ("Time to lock in", "Now
  testing: your patience", etc.) replaces the plain "Work session"/"Break"
  label each time a timer starts, same line shown to everyone.
- **Night mode**: toggle button (top right), remembered per browser via
  localStorage, applied before first paint so there's no flash of the
  wrong theme on reload.
- **Break room games**: while the room is on break, present teammates can
  challenge each other to Memory Match or a turn-based Wordle Duel (one
  shared word, challenger guesses first, turns alternate). Both players
  can request a rematch after a game ends. See "Known limitations" below
  for the trust assumptions these make.
- **Pictionary (1v1)**: challenge a teammate with "✏️ Draw". 6 rounds,
  drawer alternates (3 each), 100 seconds per round. The guesser earns the
  seconds left on the clock when they guess right, the drawer earns half
  that. Drawing syncs live; guesses show in a feed; near misses get a
  private "close!" hint. Unlike Memory/Wordle, a Pictionary game keeps
  going when the break ends (players close it when done).
- **Super Challenge (host only)**: group Pictionary for everyone on break.
  Only a browser that has opened the private host link sees the button
  (the key is not in this repo; only its SHA-256 hash is, in `app.js`).
  Everyone else gets a 30 second invite to Join or Skip; the host can hit
  Start early. Everyone who joined draws once, in random order. First
  correct guess wins the round (seconds left for the guesser, half for the
  drawer), most points at the end wins. If someone leaves, their drawing
  turn is skipped. The host's Close button ends it for everyone.
- **Pictionary words**: `pictionary-words.js`, one line per word with its
  accepted alternates (monkey: ape, orangutan...). Plurals, capitalization,
  "a/the", spaces, and a single typo on 5+ letter words are handled
  automatically. Words rotate team-wide with no repeats until all are used.
- **Presence**: anyone with the tab open shows up as a bubble, for as
  long as the tab stays open, regardless of activity.
- **Sounds**: synthesized in-browser with the Web Audio API, no audio
  files to host. Distinct tones for timer-done, someone joining, and an
  incoming game challenge.

## Known limitations

Deliberate trade-offs, reasonable for a trusted ~6-person internal tool,
worth knowing about before extending this further:

- A Wordle Duel's secret word lives in the same client-visible database
  row as everything else in the game. A determined teammate could find
  it early via browser devtools.
- Nothing server-side stops a client from making a move out of turn; the
  UI just disables the controls when it isn't your turn.
- Wordle guesses are only checked for being 5 letters, not against a
  dictionary.
- Same for Pictionary: the current word is in the game row, so it's
  visible in devtools, and correct answers are checked in the guesser's
  browser.
- Pictionary drawings are sent as realtime broadcast messages, not stored.
  Someone who reloads mid-round gets the drawing re-sent by the others in
  the game; if nobody else is left, it's gone for that round.
- The Pictionary host key lives in the host's browser (localStorage). A
  new browser or cleared site data needs the host link opened once again.
- The "test bot" opponent (Rally) only ever appears on a Netlify Deploy
  Preview or `localhost`, never on the production domain, so it can't be
  challenged by real teammates by mistake. In Pictionary, Rally scribbles
  random shapes when it's drawing and the word is shown on screen
  (preview only) so the guessing flow can be tested solo. A Super
  Challenge started on a preview automatically includes Rally and never
  invites anyone on the production site.

## Files

- `index.html`, `style.css`, `app.js`: the app.
- `config.js`: Supabase project URL + anon key.
- `pictionary-words.js`: the Pictionary word list and accepted alternates.
- `supabase-schema.sql`: full database setup, run top to bottom (see
  "Database setup" above). Each addition is commented with when/why it
  was added.
- `netlify.toml`: tells Netlify this is a static site with no build step.
