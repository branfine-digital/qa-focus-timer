# QA Focus Timer

A shared, real-time focus/break timer for the team — a replacement for Cuckoo.
One URL, everyone joins with a name + emoji, sees who else is in the room, and
shares one countdown timer that anyone can start.

Plain HTML/CSS/JS — no build step, no npm install needed. The only backend is
Supabase (already created: project `qa-focus-timer`).

## 1. Run the database setup (one time)

1. Go to your Supabase project → **SQL Editor** → **New query**.
2. Paste the entire contents of `supabase-schema.sql` and click **Run**.
3. Go to **Table Editor** and confirm you see a `timer_state` table with one row (id = 1, mode = idle).
4. Go to **Database → Replication** (or **Database → Publications**) and confirm `timer_state` is listed under the `supabase_realtime` publication. The SQL script does this automatically, but it's worth a quick look — if it's missing, live updates won't reach other browsers.

`config.js` already has your project's URL and anon public key wired in, so no other Supabase setup is needed. (The anon key is meant to be public/embedded in client code — access is controlled by the Row Level Security policies in `supabase-schema.sql`, not by hiding this key.)

## 2. Push to GitHub

From this folder:

```
git add -A
git commit -m "Initial version of the shared focus timer"
```

Then create a new **empty** repository on GitHub (no README/license — this folder already has one), and run the two commands GitHub shows you, e.g.:

```
git remote add origin https://github.com/<your-username>/<repo-name>.git
git branch -M main
git push -u origin main
```

## 3. Deploy on Netlify

1. In Netlify: **Add new site → Import an existing project → Deploy with GitHub**, and pick this repo.
2. Build settings: leave the build command **blank** and set the publish directory to `.` (this repo has no build step — `netlify.toml` already sets this for you, so Netlify should pick it up automatically).
3. Deploy. Netlify will give you a URL like `random-words-123abc.netlify.app`.
4. In **Site settings → Domain management → Options → Edit site name**, change it to something short but *not* obviously guessable (e.g. `qa-focus-8x2k` rather than `qa-team-timer`) — this is the "unguessable slug" approach we talked about instead of a login system. Your team's permanent URL becomes `https://qa-focus-8x2k.netlify.app` (or whatever you pick).

That URL never changes going forward — bookmark it and share it with the team.

## How it works

- **Presence** (who's in the room) uses Supabase Realtime's presence feature — no database table, it just tracks who currently has a connection open.
- **The timer** lives in one row of the `timer_state` table. Starting a timer writes the end time to that row; Supabase Realtime pushes the change to every connected browser instantly, and each browser counts down to that same timestamp so everyone stays in sync (not just independently counting down, which would drift).
- **Sounds** are synthesized in the browser with the Web Audio API — no sound files to host. A soft two-note chime plays (and repeats) when a timer ends, and a quieter blip plays when someone else joins the room.
- **When a timer ends**, every browser shows a full-screen "Time's up!" state and plays the chime on a loop. Anyone clicking anywhere resets the shared room state, which every browser picks up — the whole room drops back to the picker at the same time, with the duration bubbles animating back in.
- **Your name/emoji** are remembered in your browser (localStorage), so you won't be asked again on future visits from the same browser. To switch identity, clear your browser's site data for this URL, or ask and I can add a "change identity" button.

## Files

- `index.html`, `style.css`, `app.js` — the app
- `config.js` — your Supabase project URL + anon key
- `supabase-schema.sql` — one-time database setup (see step 1)
- `netlify.toml` — tells Netlify this is a static site with no build step
