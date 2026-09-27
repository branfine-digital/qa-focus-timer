(() => {
  "use strict";

  const cfg = window.TIMER_CONFIG;
  const { createClient } = window.supabase;
  const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  const EMOJIS = ["😀","😎","🦄","🐙","🐝","🦊","🐼","🐸","🚀","🔥","🌈","🍕","☕","🎧","🧠","🐢","🦖","🍩"];
  const IDENTITY_KEY = "qa_focus_identity";
  const CLIENT_ID_KEY = "qa_focus_client_id";

  // Rotating headers -- one is picked at random whenever a timer is started,
  // and stored on the shared row so the whole room sees the same line.
  const WORK_HEADERS = [
    "Time to lock in",
    "Deploying focus mode",
    "No bugs, just brains",
    "Heads down, tabs closed",
    "Sprint mode: engaged",
    "QA-ing your own productivity",
    "Zero known issues with this focus block",
    "Currently in a stable build of you",
    "Focus.exe is running",
    "Building, not browsing",
    "Executing tasks.exe. Please do not force quit.",
    "Currently allergic to Slack notifications",
    "In the zone. In the void. Same thing.",
    "This is not a drill. Okay it's kind of a drill.",
    "Currently unbotherable",
    "If you can read this, you're interrupting me",
    "Doing the thing. The thing is happening.",
  ];
  const BREAK_HEADERS = [
    "Now testing: your patience",
    "On break. Do not deploy to live page.",
    "Refilling coffee, not tasks",
    "Status: away, results pending",
    "Regression testing your relaxation skills",
    "Snack break: additional steps optional",
    "Stretch it like a Sprint MVP™",
    "Pending human, please wait",
    "Running a break on yourself",
    "Currently out of office (mentally)",
    "Gone to touch grass, back in a few",
    "Currently negotiating with my snack drawer",
    "On a break. My inbox is on a bigger one.",
    "Contractually obligated to sit down for a bit",
    "Off the clock, on the couch (mentally)",
    "Legally required to stare at a wall now",
  ];

  function pickRandom(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  // ---------- Break games ----------
  // This is Bran's real 100-word list. Real games draw their secret word
  // from the server-side "wordle_pool" table via the pick_wordle_word()
  // RPC (see supabase-schema.sql), which hands out all 100 in random
  // order with no repeats until the whole list has been used, shared
  // across the whole team. The copy here is only a fallback (if that RPC
  // isn't set up yet) and the word source for games against the
  // preview-only test bot, which deliberately doesn't touch the real
  // team-wide rotation.
  const WORDLE_WORDS = [
    "APPLE","BRAVE","CRANE","DREAM","ELBOW","FLAME","GRAPE","HOUSE","IVORY","JELLY",
    "KNEEL","LEMON","MAPLE","NIGHT","OCEAN","PEARL","QUEEN","RIVER","STONE","TIGER",
    "UNITY","VIVID","WHALE","YOUTH","ZEBRA","AMBER","BLOOM","CANDY","DANCE","EAGER",
    "FROST","GIANT","HONEY","INDEX","JUDGE","KARMA","LIGHT","MANGO","NOBLE","OLIVE",
    "PIANO","QUILT","ROBIN","SPICE","TABLE","URBAN","VAULT","WHEAT","YIELD","ADORN",
    "BERRY","CHARM","DIARY","EARTH","FANCY","GLAZE","HEART","INLET","JOKER","KOALA",
    "LUNAR","MEDAL","NERVE","OASIS","PEACH","QUIET","RADAR","SHEEP","TRAIL","UNCLE",
    "VERSE","WITCH","XENON","YOUNG","ZESTY","ARENA","BLADE","CORAL","DINER","EVERY",
    "FEVER","GLORY","HUMID","IDEAL","JOINT","KAYAK","LUCKY","MAGIC","NURSE","ORBIT",
    "PROUD","RELAY","SCARF","THORN","UPPER","VISIT","WOMAN","EXTRA","SALAD","BRUSH",
  ];
  const MEMORY_EMOJIS = ["🍕", "🐙", "🚀", "🌵", "🎧", "🍩", "🦖", "🐝"]; // 8 pairs = 16 cards

  // ---------- Pictionary ----------
  // Word -> accepted alternates, from pictionary-words.js (easy to edit).
  const PICT_WORDS = window.PICTIONARY_WORDS || { banana: [], monkey: ["ape"] };
  const PICT_WORD_KEYS = Object.keys(PICT_WORDS);
  const PICT_ROUND_SECONDS = 100;
  const PICT_ROUND_MS = PICT_ROUND_SECONDS * 1000;
  const PICT_GET_READY_MS = 3000; // "Get ready..." before each round's clock starts
  const PICT_REVEAL_MS = 4500; // how long "It was BANANA!" shows between rounds
  const PICT_1V1_ROUNDS = 6; // 3 draws each, so neither player gets an extra turn
  const SUPER_JOIN_WINDOW_MS = 30000;
  const PICT_COLORS = ["#2f2a26", "#e74c3c", "#f39c12", "#f1c40f", "#27ae60", "#3498db", "#8e44ad", "#8b5a2b", "#ff8fb1"];

  // Super Challenge is host-only. The host opens the site once with
  // ?host=<key> (Bran's private link); this browser then remembers it. Only
  // a SHA-256 hash of the key lives in this public file.
  const HOST_KEY_HASH = "c4a1d9ef039b642ea97d72073b6f90536bd20dc19796d42a44726bbd83f3d952";
  const HOST_KEY_STORAGE = "qa_focus_host_key";

  // Only ever true on a Netlify Deploy Preview (or localhost, for my own
  // testing) -- never on the real production domain. Lets a single person
  // try the whole challenge/play flow solo against a simulated opponent
  // before real teammates are around to test with.
  const IS_PREVIEW_BUILD = /deploy-preview/.test(location.hostname) || location.hostname === "localhost";
  const TEST_BOT_ID = "test-bot";
  const TEST_BOT_NAME = "Rally";
  const TEST_BOT_EMOJI = "🤖";
  // Super Challenge rows are tagged with where they were started, so testing
  // one on a Deploy Preview (same database as production) never pops an
  // invite up for teammates on the real site, and vice versa.
  const MY_ENV = IS_PREVIEW_BUILD ? "preview" : "prod";

  // .panel and .bubble carry a one-time "pop-in" arrival animation via the
  // .entrance class (see style.css). Toggling an element's `hidden`
  // attribute restarts any CSS animation on it, so if pop-in stayed on the
  // base class it would replay every time the picker panel/bubbles come
  // back after a timer ends -- a visible disappear-then-reappear flash.
  // Stripping .entrance after its first play makes it a true one-shot, while
  // bubble-idle (which never touches opacity) stays on the base class and
  // can safely restart forever.
  function stripEntranceOnce(el) {
    if (!el) return;
    el.addEventListener(
      "animationend",
      function onEntranceEnd(e) {
        if (e.animationName !== "pop-in") return;
        el.classList.remove("entrance");
        el.removeEventListener("animationend", onEntranceEnd);
      }
    );
  }

  // ---------- DOM ----------
  const entryScreen = document.getElementById("entry-screen");
  const roomScreen = document.getElementById("room-screen");
  const emojiGrid = document.getElementById("emoji-grid");
  const nameInput = document.getElementById("name-input");
  const joinBtn = document.getElementById("join-btn");
  const entryError = document.getElementById("entry-error");

  const presenceBar = document.getElementById("presence-bar");
  const modeTabs = document.querySelectorAll(".mode-tab");
  const workBubbles = document.getElementById("work-bubbles");
  const breakBubbles = document.getElementById("break-bubbles");
  const customMinutesInput = document.getElementById("custom-minutes");
  const customStartBtn = document.getElementById("custom-start-btn");

  const pickerPanel = document.getElementById("picker-panel");
  const countdownPanel = document.getElementById("countdown-panel");
  const countdownDisplay = document.getElementById("countdown-display");
  const countdownModeLabel = document.getElementById("countdown-mode-label");
  const countdownStartedBy = document.getElementById("countdown-started-by");
  const countdownRingWrap = document.getElementById("countdown-ring-wrap");
  const countdownRingProgress = document.getElementById("countdown-ring-progress");
  const endTimerBtn = document.getElementById("end-timer-btn");
  const doneOverlay = document.getElementById("done-overlay");

  const breakGamesPanel = document.getElementById("break-games-panel");
  const gameOpponentList = document.getElementById("game-opponent-list");
  const gameEmptyHint = document.getElementById("game-empty-hint");
  const challengeIncoming = document.getElementById("challenge-incoming");
  const challengeIncomingText = document.getElementById("challenge-incoming-text");
  const challengeAcceptBtn = document.getElementById("challenge-accept-btn");
  const challengeDeclineBtn = document.getElementById("challenge-decline-btn");
  const challengeOutgoing = document.getElementById("challenge-outgoing");
  const challengeOutgoingText = document.getElementById("challenge-outgoing-text");
  const challengeCancelBtn = document.getElementById("challenge-cancel-btn");
  const gameOverlay = document.getElementById("game-overlay");
  const gameTitle = document.getElementById("game-title");
  const gameTurnIndicator = document.getElementById("game-turn-indicator");
  const memoryBoard = document.getElementById("memory-board");
  const memoryScoreboard = document.getElementById("memory-scoreboard");
  const wordleBoard = document.getElementById("wordle-board");
  const wordleRows = document.getElementById("wordle-rows");
  const wordleKeyboard = document.getElementById("wordle-keyboard");
  const wordleGuessForm = document.getElementById("wordle-guess-form");
  const wordleGuessInput = document.getElementById("wordle-guess-input");
  const wordleError = document.getElementById("wordle-error");
  const gameResult = document.getElementById("game-result");
  const gameRematchHint = document.getElementById("game-rematch-hint");
  const gamePlayAgainBtn = document.getElementById("game-play-again-btn");
  const gameCloseBtn = document.getElementById("game-close-btn");
  const gameOverlayCard = gameOverlay.querySelector(".game-overlay-card");

  const superChallengeBtn = document.getElementById("super-challenge-btn");
  const superIncoming = document.getElementById("super-incoming");
  const superIncomingText = document.getElementById("super-incoming-text");
  const superJoinBtn = document.getElementById("super-join-btn");
  const superSkipBtn = document.getElementById("super-skip-btn");
  const pictLobby = document.getElementById("pict-lobby");
  const pictLobbyStatus = document.getElementById("pict-lobby-status");
  const pictLobbyPlayers = document.getElementById("pict-lobby-players");
  const pictLobbyExtra = document.getElementById("pict-lobby-extra");
  const pictLobbyStartBtn = document.getElementById("pict-lobby-start-btn");
  const pictBoard = document.getElementById("pict-board");
  const pictRound = document.getElementById("pict-round");
  const pictTimer = document.getElementById("pict-timer");
  const pictTimerFill = document.getElementById("pict-timer-fill");
  const pictPrompt = document.getElementById("pict-prompt");
  const pictCanvasWrap = document.getElementById("pict-canvas-wrap");
  const pictCanvas = document.getElementById("pict-canvas");
  const pictReveal = document.getElementById("pict-reveal");
  const pictTools = document.getElementById("pict-tools");
  const pictColors = document.getElementById("pict-colors");
  const pictEraserBtn = document.getElementById("pict-eraser-btn");
  const pictUndoBtn = document.getElementById("pict-undo-btn");
  const pictClearBtn = document.getElementById("pict-clear-btn");
  const pictSwapBtn = document.getElementById("pict-swap-btn");
  const pictGuessForm = document.getElementById("pict-guess-form");
  const pictGuessInput = document.getElementById("pict-guess-input");
  const pictScores = document.getElementById("pict-scores");
  const pictFeed = document.getElementById("pict-feed");

  stripEntranceOnce(pickerPanel);
  stripEntranceOnce(countdownPanel);
  stripEntranceOnce(breakGamesPanel);
  document.querySelectorAll(".bubble").forEach((btn) => stripEntranceOnce(btn));

  // ---------- Theme (day/night) ----------
  // The inline script at the top of index.html already applied the saved
  // theme (if any) to <html> before first paint, so there's no flash of the
  // wrong theme while this file loads. From here on we just keep the
  // toggle button's icon in sync and persist future choices.
  const THEME_KEY = "qa_focus_theme";
  const themeToggleBtn = document.getElementById("theme-toggle-btn");

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function syncThemeToggleIcon() {
    const isDark = currentTheme() === "dark";
    themeToggleBtn.textContent = isDark ? "☀️" : "🌙";
    const label = isDark ? "Switch to day mode" : "Switch to night mode";
    themeToggleBtn.setAttribute("aria-label", label);
    themeToggleBtn.title = label;
  }

  syncThemeToggleIcon();

  themeToggleBtn.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    syncThemeToggleIcon();
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {
      // Private browsing / storage disabled -- theme still applies for this
      // visit, it just won't be remembered next time.
    }
  });

  const RING_RADIUS = 90;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
  countdownRingProgress.style.strokeDasharray = String(RING_CIRCUMFERENCE);
  countdownRingProgress.style.strokeDashoffset = "0";
  let activeGhost = null;

  // ---------- State ----------
  let selectedEmoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
  let identity = null; // { name, emoji }
  let myClientId = null; // set once, in enterRoom, before anything touches games/presence
  let activeMode = "work";
  let currentRow = null; // last known timer_state row
  let tickTimer = null;
  let inDoneState = false;
  let chimeLoopTimer = null;
  let audioCtx = null;
  let hasReceivedInitialPresenceSync = false;

  // ---------- Break games state ----------
  let presentPeople = {}; // clientId -> { name, emoji }, from presence
  let outgoingChallenge = null; // a game row I created, still status "pending"
  let incomingChallenge = null; // a game row where I'm player2, still "pending"
  let activeGame = null; // the game row currently shown in the play overlay
  const rematchInFlight = new Set(); // game ids currently being re-created

  // ---------- Pictionary state ----------
  let roomChannel = null; // the realtime channel, also used for drawing/guess broadcasts
  let clockOffsetMs = 0; // database clock minus this computer's clock
  let isHost = false; // this browser opened the private host link
  let superInvite = null; // a pending Super Challenge row I've been invited to
  const superDismissed = new Set(); // Super Challenge ids I skipped or already saw end
  const leftGames = new Set(); // Super Challenge ids I left mid-game

  const REMATCH_WAITING_LINES = [
    "Waiting on {opp} to also want a rematch. No pressure.",
    "Rematch requested. {opp} is currently... thinking about it.",
    "Sent! {opp}'s move. Tapping foot intensifies.",
    "Awaiting {opp}'s courage.",
    "The ball is in {opp}'s court. This isn't tennis, but still.",
  ];

  // ---------- Audio (synthesized, no external files) ----------
  function ensureAudioContext() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function tone(ctx, freq, startTime, duration, peakGain) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  }

  function playChime() {
    const ctx = ensureAudioContext();
    const now = ctx.currentTime;
    tone(ctx, 880, now, 0.9, 0.22);
    tone(ctx, 659.25, now + 0.28, 1.1, 0.18);
  }

  function playJoinSound() {
    try {
      const ctx = ensureAudioContext();
      const now = ctx.currentTime;
      tone(ctx, 1046.5, now, 0.18, 0.07);
    } catch (e) { /* audio not available yet, ignore */ }
  }

  function startChimeLoop() {
    stopChimeLoop();
    playChime();
    chimeLoopTimer = setInterval(playChime, 2600);
  }

  function stopChimeLoop() {
    if (chimeLoopTimer) {
      clearInterval(chimeLoopTimer);
      chimeLoopTimer = null;
    }
  }

  // ---------- Entry screen ----------
  function renderEmojiGrid() {
    emojiGrid.innerHTML = "";
    EMOJIS.forEach((emoji) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "emoji-option" + (emoji === selectedEmoji ? " selected" : "");
      btn.textContent = emoji;
      btn.addEventListener("click", () => {
        selectedEmoji = emoji;
        renderEmojiGrid();
      });
      emojiGrid.appendChild(btn);
    });
  }

  function updateJoinButtonState() {
    joinBtn.disabled = nameInput.value.trim().length === 0;
  }

  nameInput.addEventListener("input", updateJoinButtonState);

  joinBtn.addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (!name) return;
    ensureAudioContext(); // unlock audio on this user gesture
    identity = { name, emoji: selectedEmoji };
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
    enterRoom();
  });

  function getOrCreateClientId() {
    let id = sessionStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
      sessionStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  }

  // ---------- Room screen ----------
  function renderPresence(state) {
    presenceBar.innerHTML = "";
    presentPeople = {};
    Object.entries(state).forEach(([key, entries]) => {
      const p = entries[0];
      if (!p) return;
      presentPeople[key] = { name: p.name, emoji: p.emoji };
      const chip = document.createElement("div");
      chip.className = "presence-chip";
      chip.innerHTML = '<span class="chip-emoji">' + p.emoji + "</span><span>" + p.name + "</span>";
      presenceBar.appendChild(chip);
    });
    renderGameOpponents();
  }

  function formatTime(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  // The picker/countdown swap itself is instant (no fade or hide delay --
  // that's what was causing the "empty box, then a pause" feeling). This
  // ghost is a purely decorative circle that visually grows from the
  // clicked bubble's spot into the countdown panel's spot and fades out,
  // papering over that instant swap so it *looks* like the bubble morphed
  // into the countdown rather than an abrupt cut.
  function morphBubbleIntoCountdown(startRect, background) {
    const endRect = countdownPanel.getBoundingClientRect();

    if (activeGhost) activeGhost.remove();

    const ghost = document.createElement("div");
    ghost.className = "morph-ghost";
    Object.assign(ghost.style, {
      left: startRect.left + "px",
      top: startRect.top + "px",
      width: startRect.width + "px",
      height: startRect.height + "px",
      borderRadius: "999px",
      background,
    });
    document.body.appendChild(ghost);
    activeGhost = ghost;

    const anim = ghost.animate(
      [
        { left: startRect.left + "px", top: startRect.top + "px", width: startRect.width + "px", height: startRect.height + "px", borderRadius: "999px", opacity: 1 },
        { left: endRect.left + "px", top: endRect.top + "px", width: endRect.width + "px", height: endRect.height + "px", borderRadius: "28px", opacity: 0 },
      ],
      { duration: 380, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" }
    );
    anim.onfinish = () => {
      ghost.remove();
      if (activeGhost === ghost) activeGhost = null;
    };
  }

  function showPicker() {
    doneOverlay.hidden = true;
    countdownPanel.hidden = true;
    pickerPanel.hidden = false;
  }

  function showCountdown(row) {
    pickerPanel.hidden = true;
    doneOverlay.hidden = true;
    countdownPanel.hidden = false;
    countdownPanel.classList.toggle("mode-break", row.mode === "break");
    countdownModeLabel.textContent = row.header_text || (row.mode === "work" ? "Work session" : "Break");
    countdownStartedBy.textContent = row.started_by ? "Started by " + row.started_by : "";
  }

  function showDone() {
    countdownPanel.hidden = true;
    pickerPanel.hidden = true;
    doneOverlay.hidden = false;
  }

  function stopTicking() {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  function applyTimerState(row) {
    currentRow = row;
    stopTicking();

    const isBreak = !!(row && row.mode === "break");
    breakGamesPanel.hidden = !isBreak;
    if (isBreak) renderGameOpponents();

    // Games only make sense during a shared break -- once the room leaves
    // break (a new work session starts, or someone resets to idle), any
    // game/challenge I'm part of no longer makes sense to leave dangling.
    if (!isBreak) {
      if (outgoingChallenge) cancelOutgoingChallenge();
      if (incomingChallenge) declineChallenge();
      // Pictionary is the exception: a full game can outlast a short
      // break, so it keeps going and players close it when they're done.
      if (activeGame && activeGame.status === "active" && !isPictType(activeGame.type)) {
        commitGameUpdate(activeGame, { status: "abandoned" });
        activeGame = null;
        hideGameOverlay();
      }
      if (superInvite) hideSuperInvite(true);
    }
    renderSuperButton();

    if (!row || row.mode === "idle" || !row.ends_at) {
      inDoneState = false;
      stopChimeLoop();
      countdownRingProgress.style.strokeDashoffset = "0";
      countdownRingWrap.classList.remove("final-stretch");
      showPicker();
      return;
    }

    const endsAtMs = new Date(row.ends_at).getTime();
    const totalMs = (row.duration_sec || 0) * 1000;

    const tick = () => {
      const remaining = endsAtMs - Date.now();
      if (remaining <= 0) {
        stopTicking();
        if (!inDoneState) {
          inDoneState = true;
          showDone();
          startChimeLoop();
        }
        return;
      }
      if (inDoneState) return; // already transitioned, wait for reset
      showCountdown(row);
      countdownDisplay.textContent = formatTime(remaining);
      if (totalMs > 0) {
        const elapsedFraction = Math.min(1, Math.max(0, (totalMs - remaining) / totalMs));
        countdownRingProgress.style.strokeDashoffset = String(RING_CIRCUMFERENCE * elapsedFraction);
        countdownRingWrap.classList.toggle("final-stretch", elapsedFraction >= 0.8);
      }
    };

    tick();
    tickTimer = setInterval(tick, 250);
  }

  // Building the payload once and reusing it for both the instant local
  // preview and the real database write guarantees they show the exact same
  // end time and header line -- no mismatch to reconcile when realtime
  // confirms it a moment later.
  function buildStartPayload(mode, minutes) {
    const now = new Date();
    const endsAt = new Date(now.getTime() + minutes * 60 * 1000);
    return {
      mode,
      duration_sec: minutes * 60,
      started_at: now.toISOString(),
      ends_at: endsAt.toISOString(),
      started_by: identity.emoji + " " + identity.name,
      header_text: pickRandom(mode === "work" ? WORK_HEADERS : BREAK_HEADERS),
    };
  }

  async function startTimer(payload) {
    const { error } = await sb.from("timer_state").update({
      ...payload,
      updated_at: new Date().toISOString(),
    }).eq("id", 1);
    if (error) {
      console.error("Failed to start timer:", error);
      // The countdown was already shown optimistically -- if the write
      // failed, nothing will ever arrive over realtime to correct it, so put
      // the picker back ourselves instead of leaving the room stuck.
      if (activeGhost) {
        activeGhost.remove();
        activeGhost = null;
      }
      showPicker();
    }
  }

  async function resetRoom() {
    const { error } = await sb.from("timer_state").update({
      mode: "idle",
      duration_sec: null,
      started_at: null,
      ends_at: null,
      started_by: null,
      header_text: null,
      updated_at: new Date().toISOString(),
    }).eq("id", 1);
    if (error) console.error("Failed to reset room:", error);
  }

  // Mode tab switching (idle picker UI only)
  modeTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activeMode = tab.dataset.mode;
      modeTabs.forEach((t) => t.classList.toggle("active", t === tab));
      workBubbles.hidden = activeMode !== "work";
      breakBubbles.hidden = activeMode !== "break";
    });
  });

  document.querySelectorAll(".bubble").forEach((btn) => {
    btn.addEventListener("click", () => {
      const minutes = parseInt(btn.dataset.minutes, 10);
      btn.classList.remove("squish");
      void btn.offsetWidth; // restart the squish animation if clicked again quickly
      btn.classList.add("squish");
      btn.addEventListener(
        "animationend",
        (e) => {
          // Only clear our own squish animation -- leave the idle-bob animation
          // (which fires its own animationend on every loop) alone, and make
          // sure the bubble goes right back to bobbing forever, clicked or not.
          if (e.animationName === "bubble-squish") btn.classList.remove("squish");
        }
      );

      // Capture the bubble's on-screen spot and look *before* anything else
      // changes, then show the countdown immediately using locally-known
      // values -- no waiting on the network round trip before the next
      // screen appears. The ghost animation papers over the instant swap.
      const startRect = btn.getBoundingClientRect();
      const computed = getComputedStyle(btn);
      const ghostBackground = computed.backgroundImage !== "none" ? computed.backgroundImage : computed.backgroundColor;

      const payload = buildStartPayload(activeMode, minutes);
      applyTimerState(payload);
      morphBubbleIntoCountdown(startRect, ghostBackground);
      startTimer(payload);
    });
  });

  customStartBtn.addEventListener("click", () => {
    const minutes = parseInt(customMinutesInput.value, 10);
    if (!minutes || minutes <= 0) {
      customMinutesInput.focus();
      return;
    }
    const payload = buildStartPayload(activeMode, minutes);
    applyTimerState(payload);
    startTimer(payload);
    customMinutesInput.value = "";
  });

  doneOverlay.addEventListener("click", () => {
    applyTimerState({ mode: "idle" });
    resetRoom();
  });

  // Anyone can end a running timer early (e.g. someone meant to start 45
  // minutes and hit 30 by mistake) -- this just cancels it for everyone and
  // returns to the picker, with no chime since it wasn't a natural finish.
  endTimerBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    applyTimerState({ mode: "idle" });
    resetRoom();
  });

  // ---------- Break games: shared helpers ----------

  function getPresentOpponents() {
    const list = Object.keys(presentPeople)
      .filter((id) => id !== myClientId)
      .map((id) => ({ id, name: presentPeople[id].name, emoji: presentPeople[id].emoji }));
    if (IS_PREVIEW_BUILD) {
      list.push({ id: TEST_BOT_ID, name: TEST_BOT_NAME + " (test bot)", emoji: TEST_BOT_EMOJI });
    }
    return list;
  }

  function renderGameOpponents() {
    const opponents = getPresentOpponents();
    gameOpponentList.innerHTML = "";
    gameEmptyHint.hidden = opponents.length > 0;
    const busy = !!(outgoingChallenge || incomingChallenge || activeGame);
    opponents.forEach((op) => {
      const row = document.createElement("div");
      row.className = "game-opponent-row";
      const nameSpan = document.createElement("span");
      nameSpan.className = "game-opponent-name";
      nameSpan.textContent = op.emoji + " " + op.name;
      row.appendChild(nameSpan);

      const btnWrap = document.createElement("span");
      [["memory", "🧠 Memory"], ["wordle", "🔤 Wordle"], ["pictionary", "✏️ Draw"]].forEach(([type, label]) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "game-challenge-btn";
        btn.textContent = label;
        btn.disabled = busy;
        btn.addEventListener("click", () => sendChallenge(op, type));
        btnWrap.appendChild(btn);
      });
      row.appendChild(btnWrap);
      gameOpponentList.appendChild(row);
    });
    renderSuperButton();
  }

  function playChallengeSound() {
    try {
      const ctx = ensureAudioContext();
      const now = ctx.currentTime;
      tone(ctx, 740, now, 0.14, 0.09);
      tone(ctx, 988, now + 0.12, 0.16, 0.09);
    } catch (e) { /* audio not unlocked yet, ignore */ }
  }

  function showIncomingChallenge(row) {
    challengeIncomingText.textContent =
      row.player1_name + " challenged you to " +
      (row.type === "memory" ? "Memory Match" : row.type === "pictionary" ? "Pictionary" : "a Wordle Duel") + "!";
    challengeIncoming.hidden = false;
    playChallengeSound();
  }
  function hideIncomingChallenge() { challengeIncoming.hidden = true; }

  function showOutgoingChallenge(row) {
    challengeOutgoingText.textContent = "Waiting for " + row.player2_name + " to accept...";
    challengeCancelBtn.hidden = false;
    challengeOutgoing.hidden = false;
  }
  function hideOutgoingChallenge() { challengeOutgoing.hidden = true; }

  // Reuses the outgoing-challenge toast slot for a brief, non-blocking
  // message (e.g. "Alex declined.") since it's not tied to a live challenge.
  function flashGameToast(message) {
    challengeOutgoingText.textContent = message;
    challengeCancelBtn.hidden = true;
    challengeOutgoing.hidden = false;
    setTimeout(() => {
      challengeOutgoing.hidden = true;
      challengeCancelBtn.hidden = false;
    }, 2600);
  }

  function hideGameOverlay() { gameOverlay.hidden = true; }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  // For Pictionary, presetSecret is the list of words for the game and
  // players is [{ id, name }] for both players, challenger first.
  function buildInitialGameState(gameType, presetSecret, players) {
    if (gameType === "pictionary") return buildPictState(players, presetSecret);
    if (gameType === "memory") {
      const deck = shuffle(MEMORY_EMOJIS.concat(MEMORY_EMOJIS));
      return {
        deck,
        matched: new Array(deck.length).fill(false),
        matchedBy: new Array(deck.length).fill(null),
        flipped: [],
      };
    }
    return {
      secret: presetSecret || pickRandom(WORDLE_WORDS).toUpperCase(),
      guesses: [],
      maxGuesses: 6,
    };
  }

  // Pulls the next word from the shared, no-repeat-until-exhausted pool
  // (see pick_wordle_word() in supabase-schema.sql). Falls back to the
  // local placeholder list if that RPC isn't set up yet, so a real 1v1
  // challenge still works (just without the no-repeat guarantee) rather
  // than silently failing to start.
  async function pickSharedWordleSecret() {
    try {
      const { data, error } = await sb.rpc("pick_wordle_word");
      if (error || !data) throw error || new Error("pick_wordle_word returned nothing");
      return String(data).toUpperCase();
    } catch (e) {
      console.error("wordle_pool RPC unavailable, falling back to the local word list:", e);
      return pickRandom(WORDLE_WORDS).toUpperCase();
    }
  }

  // ---------- Break games: challenge lifecycle ----------
  //
  // A single "games" table row (see supabase-schema.sql) is the source of
  // truth for one challenge/game, the same shared-row pattern the timer
  // itself uses. handleGameRow() is the one place that reacts to a row no
  // matter where it came from: a realtime postgres_changes event, the
  // on-load fetch of an in-progress game, my own optimistic move, or (in a
  // preview build only) a simulated move from the test bot.
  function handleGameRow(row) {
    if (!row) return;
    if (row.type === "pictionary_group") { handleGroupRow(row); return; }
    // Realtime can occasionally deliver an older copy of a Pictionary row
    // after a newer one (e.g. my own write's echo racing the other
    // player's); the state version number tells us which is newer.
    if (row.type === "pictionary" && isStalePictRow(row)) return;
    const prevPictRow = activeGame && activeGame.id === row.id ? activeGame : null;
    const iAmP1 = row.player1_id === myClientId;
    const iAmP2 = row.player2_id === myClientId;
    if (!iAmP1 && !iAmP2) return; // not a game I'm part of

    if (row.status === "pending") {
      if (iAmP2) { incomingChallenge = row; showIncomingChallenge(row); }
      else { outgoingChallenge = row; showOutgoingChallenge(row); }
      renderGameOpponents();
      return;
    }

    if (row.status === "declined") {
      if (outgoingChallenge && outgoingChallenge.id === row.id) {
        outgoingChallenge = null;
        hideOutgoingChallenge();
        flashGameToast((iAmP1 ? row.player2_name : row.player1_name) + " declined.");
      }
      if (incomingChallenge && incomingChallenge.id === row.id) {
        incomingChallenge = null;
        hideIncomingChallenge();
      }
      renderGameOpponents();
      return;
    }

    if (row.status === "active") {
      outgoingChallenge = null;
      incomingChallenge = null;
      hideOutgoingChallenge();
      hideIncomingChallenge();
      // Only fire turn-change side effects (the "your turn" ping, waking up
      // the test bot) the moment the turn actually changes -- not on every
      // re-render of an unchanged row, which would otherwise double them up
      // when the realtime echo of my own optimistic update arrives a beat
      // later.
      const wasKnownTurn = activeGame && activeGame.id === row.id ? activeGame.turn : undefined;
      activeGame = row;
      renderGameOpponents();
      renderActiveGame();
      if (row.type === "pictionary") onPictRowChanged(prevPictRow, row);
      else if (row.turn !== wasKnownTurn) onGameTurnChanged(row);
      return;
    }

    if (row.status === "finished" || row.status === "abandoned") {
      if (activeGame && activeGame.id === row.id) {
        activeGame = row;
        renderActiveGame();
        maybeStartRematch(row);
      }
      renderGameOpponents();
    }
  }

  // Both players have to hit "Play again" before a rematch actually
  // starts. Whichever side asks second triggers this on both ends (via
  // the row update each "Play again" click writes); only the original
  // challenger's own client ever creates the new game row, so two clients
  // agreeing at the same instant can't create two rematches. rematchInFlight
  // closes the (rare) window between deciding to start one and it actually
  // being written, and the persisted rematch_started flag protects against
  // the same thing across a page reload.
  function maybeStartRematch(row) {
    if (row.rematch_started || rematchInFlight.has(row.id)) return;
    const rematchBy = row.rematch_by || [];
    const bothWant = row.player2_id === TEST_BOT_ID
      ? rematchBy.indexOf(row.player1_id) !== -1 // the bot always says yes
      : rematchBy.indexOf(row.player1_id) !== -1 && rematchBy.indexOf(row.player2_id) !== -1;
    if (!bothWant) return;
    if (myClientId !== row.player1_id) return;
    rematchInFlight.add(row.id);
    startRematch(row);
  }

  async function startRematch(row) {
    const isBot = row.player2_id === TEST_BOT_ID;
    const presetSecret =
      row.type === "wordle" ? (isBot ? pickRandom(WORDLE_WORDS).toUpperCase() : await pickSharedWordleSecret()) :
      row.type === "pictionary" ? await pickPictWords(PICT_1V1_ROUNDS, isBot) :
      undefined;
    const players = [
      { id: row.player1_id, name: row.player1_name },
      { id: row.player2_id, name: row.player2_name },
    ];
    let initialState = buildInitialGameState(row.type, presetSecret, players);
    if (row.type === "pictionary") initialState = pictStartRound(initialState, 0);

    const newRow = {
      type: row.type,
      status: "active",
      player1_id: row.player1_id,
      player1_name: row.player1_name,
      player2_id: row.player2_id,
      player2_name: row.player2_name,
      turn: row.player1_id, // the original challenger goes first again
      winner: null,
      rematch_by: [],
      rematch_started: false,
      state: initialState,
    };

    if (isBot) {
      const fakeRow = Object.assign(
        { id: "preview-" + Date.now(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        newRow
      );
      handleGameRow(fakeRow);
      return;
    }

    const { data, error } = await sb.from("games").insert(newRow).select().single();
    if (error) {
      console.error("Failed to start rematch:", error);
      rematchInFlight.delete(row.id);
      return;
    }
    commitGameUpdate(row, { rematch_started: true });
    handleGameRow(data);
  }

  function onGameTurnChanged(row) {
    if (row.turn === myClientId) playChallengeSound();
    else if (row.turn === TEST_BOT_ID) scheduleBotMove(row);
  }

  function scheduleBotMove(row) {
    const gameId = row.id;
    setTimeout(() => {
      if (!activeGame || activeGame.id !== gameId) return;
      if (activeGame.status !== "active" || activeGame.turn !== TEST_BOT_ID) return;
      if (activeGame.type === "memory") makeBotMemoryMove(activeGame);
      else if (activeGame.type === "wordle") makeBotWordleGuess(activeGame);
      // (Pictionary's bot is driven from pictTick instead -- it has no turns.)
    }, 900 + Math.random() * 900);
  }

  // Every game move -- mine or the simulated bot's -- goes through here. It
  // applies optimistically right away (the same pattern used for starting
  // the timer) and, for a real two-person game, persists the change. A
  // preview-only game against the test bot has no database row at all
  // (its id is prefixed "preview-"), so there's nothing to persist.
  function commitGameUpdate(row, patch) {
    const merged = Object.assign({}, row, patch, { updated_at: new Date().toISOString() });
    handleGameRow(merged);
    if (String(row.id).indexOf("preview-") === 0) return;
    sb.from("games").update(patch).eq("id", row.id).then(({ error }) => {
      if (error) console.error("Failed to update game:", error);
    });
  }

  async function sendChallenge(opponent, gameType) {
    if (outgoingChallenge || incomingChallenge || activeGame) return;
    const isBot = opponent.id === TEST_BOT_ID;
    // Bot games are a solo sandbox for trying the UI -- draw from the local
    // list instead of spending a word out of the real team-wide rotation.
    const presetSecret =
      gameType === "wordle" ? (isBot ? pickRandom(WORDLE_WORDS).toUpperCase() : await pickSharedWordleSecret()) :
      gameType === "pictionary" ? await pickPictWords(PICT_1V1_ROUNDS, isBot) :
      undefined;

    const myName = identity.emoji + " " + identity.name;
    const oppName = opponent.emoji + " " + opponent.name;
    const baseRow = {
      type: gameType,
      status: "pending",
      player1_id: myClientId,
      player1_name: myName,
      player2_id: opponent.id,
      player2_name: oppName,
      // The challenger goes first. Pictionary has no turns (both players
      // act at once), so its turn stays empty.
      turn: gameType === "pictionary" ? null : myClientId,
      winner: null,
      state: buildInitialGameState(gameType, presetSecret, [
        { id: myClientId, name: myName },
        { id: opponent.id, name: oppName },
      ]),
    };

    if (isBot) {
      const fakeRow = Object.assign(
        { id: "preview-" + Date.now(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        baseRow
      );
      handleGameRow(fakeRow);
      setTimeout(() => {
        if (outgoingChallenge && outgoingChallenge.id === fakeRow.id) {
          commitGameUpdate(fakeRow, activationPatch(fakeRow));
        }
      }, 1000 + Math.random() * 700);
      return;
    }

    const { data, error } = await sb.from("games").insert(baseRow).select().single();
    if (error) {
      console.error("Failed to send challenge:", error);
      flashGameToast("Couldn't send that challenge -- try again.");
      return;
    }
    handleGameRow(data);
  }

  function acceptChallenge() {
    if (!incomingChallenge) return;
    commitGameUpdate(incomingChallenge, activationPatch(incomingChallenge));
  }

  // Accepting a challenge flips it to "active"; for Pictionary it also
  // starts round 1's clock (after a short "get ready").
  function activationPatch(row) {
    const patch = { status: "active" };
    if (row.type === "pictionary") patch.state = pictStartRound(row.state, 0);
    return patch;
  }

  function declineChallenge() {
    if (!incomingChallenge) return;
    const row = incomingChallenge;
    incomingChallenge = null;
    hideIncomingChallenge();
    renderGameOpponents();
    sb.from("games").update({ status: "declined", updated_at: new Date().toISOString() }).eq("id", row.id).then(({ error }) => {
      if (error) console.error("Failed to decline challenge:", error);
    });
  }

  function cancelOutgoingChallenge() {
    if (!outgoingChallenge) return;
    const row = outgoingChallenge;
    outgoingChallenge = null;
    hideOutgoingChallenge();
    renderGameOpponents();
    if (String(row.id).indexOf("preview-") === 0) return;
    sb.from("games").update({ status: "declined", updated_at: new Date().toISOString() }).eq("id", row.id).then(({ error }) => {
      if (error) console.error("Failed to cancel challenge:", error);
    });
  }

  challengeAcceptBtn.addEventListener("click", acceptChallenge);
  challengeDeclineBtn.addEventListener("click", declineChallenge);
  challengeCancelBtn.addEventListener("click", cancelOutgoingChallenge);

  gameCloseBtn.addEventListener("click", () => {
    if (activeGame && activeGame.type === "pictionary_group") {
      closeGroupGame();
    } else if (activeGame && activeGame.status === "active") {
      commitGameUpdate(activeGame, { status: "abandoned" });
    }
    activeGame = null;
    pictResetLocal();
    hideGameOverlay();
    renderGameOpponents();
  });

  gamePlayAgainBtn.addEventListener("click", () => {
    if (!activeGame) return;
    const rematchBy = activeGame.rematch_by || [];
    if (rematchBy.indexOf(myClientId) !== -1) return; // already asked
    commitGameUpdate(activeGame, { rematch_by: rematchBy.concat([myClientId]) });
  });

  // ---------- Break games: rendering ----------

  function renderActiveGame() {
    if (!activeGame) { hideGameOverlay(); return; }
    gameOverlay.hidden = false;
    const isPict = isPictType(activeGame.type);
    gameOverlayCard.classList.toggle("wide", isPict);
    memoryBoard.hidden = activeGame.type !== "memory";
    memoryScoreboard.hidden = activeGame.type !== "memory";
    wordleBoard.hidden = activeGame.type !== "wordle";
    if (activeGame.type !== "pictionary_group") pictLobby.hidden = true;
    pictBoard.hidden = !isPict;
    gameCloseBtn.textContent = "Close";

    if (activeGame.type === "pictionary_group") { renderGroupGame(); return; }

    const iAmP1 = activeGame.player1_id === myClientId;
    const myName = iAmP1 ? activeGame.player1_name : activeGame.player2_name;
    const oppName = iAmP1 ? activeGame.player2_name : activeGame.player1_name;
    gameTitle.textContent =
      (activeGame.type === "memory" ? "🧠 Memory Match" : activeGame.type === "pictionary" ? "✏️ Pictionary" : "🔤 Wordle Duel") +
      ": " + myName + " vs " + oppName;

    const isDone = activeGame.status === "finished" || activeGame.status === "abandoned";
    gameResult.hidden = !isDone;
    gameTurnIndicator.hidden = isDone;
    gamePlayAgainBtn.hidden = !isDone;
    gameRematchHint.hidden = true;

    if (isDone) {
      if (activeGame.status === "abandoned") {
        gameResult.textContent = "Game ended early.";
      } else if (activeGame.winner === "tie") {
        gameResult.textContent = "It's a tie!";
      } else if (activeGame.winner === myClientId) {
        gameResult.textContent = "🎉 You won!";
      } else {
        gameResult.textContent = (activeGame.winner === TEST_BOT_ID ? TEST_BOT_NAME : oppName) + " won!";
      }

      const rematchBy = activeGame.rematch_by || [];
      const oppId = iAmP1 ? activeGame.player2_id : activeGame.player1_id;
      const iWantRematch = rematchBy.indexOf(myClientId) !== -1;
      const oppWantsRematch = rematchBy.indexOf(oppId) !== -1;

      gamePlayAgainBtn.disabled = iWantRematch;
      gamePlayAgainBtn.textContent = iWantRematch ? "Waiting for " + oppName + "..." : "Play again";

      if (iWantRematch && !oppWantsRematch && oppId !== TEST_BOT_ID) {
        gameRematchHint.hidden = false;
        gameRematchHint.textContent = pickRandom(REMATCH_WAITING_LINES).replace("{opp}", oppName);
      } else if (!iWantRematch && oppWantsRematch) {
        gameRematchHint.hidden = false;
        gameRematchHint.textContent = oppName + " wants a rematch! 👀";
      }
    } else {
      gameTurnIndicator.textContent =
        activeGame.turn === myClientId ? "Your turn" :
        activeGame.turn === TEST_BOT_ID ? TEST_BOT_NAME + " is thinking..." :
        oppName + "'s turn";
    }

    if (activeGame.type === "memory") renderMemoryBoard();
    else if (activeGame.type === "wordle") renderWordleBoard();
    else renderPictBoard();
  }

  // ---------- Memory match ----------

  function renderMemoryBoard() {
    const state = activeGame.state;
    memoryBoard.innerHTML = "";
    const myTurn = activeGame.turn === myClientId && activeGame.status === "active";
    state.deck.forEach((emoji, i) => {
      const isFaceUp = state.matched[i] || state.flipped.indexOf(i) !== -1;
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "memory-card" + (state.matched[i] ? " matched" : "") + (state.flipped.indexOf(i) !== -1 ? " flipped" : "");
      cell.textContent = isFaceUp ? emoji : "❔";
      cell.disabled = !myTurn || state.matched[i] || state.flipped.indexOf(i) !== -1 || state.flipped.length >= 2;
      cell.addEventListener("click", () => playMemoryCard(i));
      memoryBoard.appendChild(cell);
    });
    const p1Pairs = state.matchedBy.filter((id) => id === activeGame.player1_id).length / 2;
    const p2Pairs = state.matchedBy.filter((id) => id === activeGame.player2_id).length / 2;
    memoryScoreboard.textContent = activeGame.player1_name + ": " + p1Pairs + "    " + activeGame.player2_name + ": " + p2Pairs;
  }

  function resolveMemoryPair(row, a, b, actorId) {
    const s = row.state;
    const isMatch = s.deck[a] === s.deck[b];
    const matched = s.matched.slice();
    const matchedBy = s.matchedBy.slice();
    if (isMatch) {
      matched[a] = true; matched[b] = true;
      matchedBy[a] = actorId; matchedBy[b] = actorId;
    }
    const allMatched = matched.every(Boolean);
    const otherId = row.player1_id === actorId ? row.player2_id : row.player1_id;
    const patch = { state: Object.assign({}, s, { flipped: [], matched, matchedBy }) };
    if (allMatched) {
      const p1Pairs = matchedBy.filter((id) => id === row.player1_id).length;
      const p2Pairs = matchedBy.filter((id) => id === row.player2_id).length;
      patch.status = "finished";
      patch.winner = p1Pairs === p2Pairs ? "tie" : (p1Pairs > p2Pairs ? row.player1_id : row.player2_id);
    } else {
      patch.turn = isMatch ? actorId : otherId;
    }
    commitGameUpdate(row, patch);
  }

  function playMemoryCard(i) {
    if (!activeGame || activeGame.type !== "memory" || activeGame.status !== "active" || activeGame.turn !== myClientId) return;
    const state = activeGame.state;
    if (state.matched[i] || state.flipped.indexOf(i) !== -1 || state.flipped.length >= 2) return;

    const flipped = state.flipped.concat([i]);
    commitGameUpdate(activeGame, { state: Object.assign({}, state, { flipped }) });

    if (flipped.length === 2) {
      const a = flipped[0];
      const b = flipped[1];
      const gameId = activeGame.id;
      setTimeout(() => {
        if (!activeGame || activeGame.id !== gameId) return;
        if (activeGame.state.flipped.length === 2) resolveMemoryPair(activeGame, a, b, myClientId);
      }, 900);
    }
  }

  function makeBotMemoryMove(row) {
    const state = row.state;
    const available = state.deck.map((_, i) => i).filter((i) => !state.matched[i]);
    if (available.length < 2) return;
    const a = available[Math.floor(Math.random() * available.length)];
    const rest = available.filter((x) => x !== a);
    const b = rest[Math.floor(Math.random() * rest.length)];
    commitGameUpdate(row, { state: Object.assign({}, state, { flipped: [a, b] }) });
    const gameId = row.id;
    setTimeout(() => {
      if (!activeGame || activeGame.id !== gameId) return;
      if (activeGame.turn === TEST_BOT_ID) resolveMemoryPair(activeGame, a, b, TEST_BOT_ID);
    }, 900);
  }

  // ---------- Wordle duel ----------

  const WORDLE_KEYBOARD_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
  const WORDLE_LETTER_RANK = { absent: 0, present: 1, correct: 2 };

  // A letter's keyboard color reflects the *best* status seen for it across
  // every guess so far (from either player, since it's one shared board) --
  // e.g. if "E" was marked absent in one guess but correct in another, it
  // shows green, never downgraded back to gray. Same rule the real Wordle
  // keyboard uses.
  function computeLetterStatuses(guesses) {
    const statuses = {};
    guesses.forEach((g) => {
      g.word.split("").forEach((letter, i) => {
        const result = g.result[i];
        if (!statuses[letter] || WORDLE_LETTER_RANK[result] > WORDLE_LETTER_RANK[statuses[letter]]) {
          statuses[letter] = result;
        }
      });
    });
    return statuses;
  }

  function renderWordleKeyboard(guesses) {
    const statuses = computeLetterStatuses(guesses);
    wordleKeyboard.innerHTML = "";
    WORDLE_KEYBOARD_ROWS.forEach((rowLetters) => {
      const rowEl = document.createElement("div");
      rowEl.className = "wordle-keyboard-row";
      rowLetters.split("").forEach((letter) => {
        const status = statuses[letter];
        const key = document.createElement("span");
        key.className = "wordle-key" + (status ? " " + status : "");
        key.textContent = letter;
        rowEl.appendChild(key);
      });
      wordleKeyboard.appendChild(rowEl);
    });
  }

  function evaluateGuess(guess, secret) {
    const result = new Array(5).fill("absent");
    const secretLetters = secret.split("");
    const guessLetters = guess.split("");
    const used = new Array(5).fill(false);

    guessLetters.forEach((ch, i) => {
      if (ch === secretLetters[i]) { result[i] = "correct"; used[i] = true; }
    });
    guessLetters.forEach((ch, i) => {
      if (result[i] === "correct") return;
      const idx = secretLetters.findIndex((s, j) => s === ch && !used[j]);
      if (idx !== -1) { result[i] = "present"; used[idx] = true; }
    });
    return result;
  }

  function renderWordleBoard() {
    const state = activeGame.state;
    wordleRows.innerHTML = "";
    for (let r = 0; r < state.maxGuesses; r++) {
      const guess = state.guesses[r];
      const rowEl = document.createElement("div");
      rowEl.className = "wordle-row";
      for (let c = 0; c < 5; c++) {
        const cell = document.createElement("span");
        cell.className = "wordle-cell" + (guess ? " " + guess.result[c] : "");
        cell.textContent = guess ? guess.word[c] : "";
        rowEl.appendChild(cell);
      }
      const who = document.createElement("span");
      who.className = "wordle-row-by";
      who.textContent = guess
        ? (guess.by === activeGame.player1_id ? activeGame.player1_name : guess.by === TEST_BOT_ID ? TEST_BOT_NAME : activeGame.player2_name)
        : "";
      rowEl.appendChild(who);
      wordleRows.appendChild(rowEl);
    }
    renderWordleKeyboard(state.guesses);

    const myTurn = activeGame.turn === myClientId && activeGame.status === "active";
    wordleGuessForm.hidden = !myTurn;
    wordleError.hidden = true;
    wordleGuessInput.value = "";
    if (myTurn) wordleGuessInput.focus();
  }

  function submitWordleGuess(row, word, actorId) {
    const state = row.state;
    const result = evaluateGuess(word, state.secret);
    const guesses = state.guesses.concat([{ by: actorId, word, result }]);
    const won = result.every((r) => r === "correct");
    const outOfGuesses = guesses.length >= state.maxGuesses;
    const otherId = row.player1_id === actorId ? row.player2_id : row.player1_id;

    const patch = { state: Object.assign({}, state, { guesses }) };
    if (won) { patch.status = "finished"; patch.winner = actorId; }
    else if (outOfGuesses) { patch.status = "finished"; patch.winner = "tie"; }
    else { patch.turn = otherId; }
    commitGameUpdate(row, patch);
  }

  function makeBotWordleGuess(row) {
    const state = row.state;
    const used = new Set(state.guesses.map((g) => g.word));
    let pool = WORDLE_WORDS.filter((w) => !used.has(w.toUpperCase()));
    if (pool.length === 0) pool = WORDLE_WORDS;
    submitWordleGuess(row, pickRandom(pool).toUpperCase(), TEST_BOT_ID);
  }

  wordleGuessForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!activeGame || activeGame.type !== "wordle" || activeGame.status !== "active" || activeGame.turn !== myClientId) return;
    const word = wordleGuessInput.value.trim().toUpperCase();
    if (!/^[A-Z]{5}$/.test(word)) {
      wordleError.textContent = "Enter a 5-letter word.";
      wordleError.hidden = false;
      return;
    }
    submitWordleGuess(activeGame, word, myClientId);
  });

  // ======================================================================
  // ---------- Pictionary (1v1 + Super Challenge) ----------
  // ======================================================================
  //
  // Both modes live in the games table as one row per game ("pictionary"
  // for 1v1, "pictionary_group" for a Super Challenge). The row's state
  // holds the players, the drawer and word for every round, the current
  // round and phase ("drawing" or "reveal"), when the round's clock
  // started, the scores, and a history of finished rounds.
  //
  // Anyone in the game can move it forward (end a round on a correct
  // guess, time a round out, start the next one). Every one of those
  // writes is a compare-and-swap on state.v (see pictCommit), so if two
  // people trigger the same thing at the same moment -- say, two correct
  // guesses a few milliseconds apart -- exactly one write wins and the
  // other browser just picks up the result.
  //
  // The drawing itself never touches the database: strokes and wrong
  // guesses go out as realtime broadcast messages (see onPictMessage).

  function isPictType(type) { return type === "pictionary" || type === "pictionary_group"; }
  function serverNow() { return Date.now() + clockOffsetMs; }
  function isPreviewRow(row) { return String(row.id).indexOf("preview-") === 0; }
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
  function gameIsOver(row) { return !row || ["finished", "abandoned", "declined"].indexOf(row.status) !== -1; }

  function isStalePictRow(row) {
    if (!activeGame || activeGame.id !== row.id || !activeGame.state || !row.state) return false;
    return (row.state.v || 0) < (activeGame.state.v || 0);
  }

  function pictName(row, id) {
    const p = ((row.state && row.state.players) || []).find((x) => x.id === id);
    if (p) return p.name;
    if (id === TEST_BOT_ID) return TEST_BOT_EMOJI + " " + TEST_BOT_NAME;
    return "Someone";
  }

  function buildPictState(players, words) {
    const drawers = [];
    for (let i = 0; i < PICT_1V1_ROUNDS; i++) drawers.push(players[i % 2].id); // alternate, challenger first
    const scores = {};
    players.forEach((p) => { scores[p.id] = 0; });
    return {
      v: 0,
      env: MY_ENV,
      players,
      drawers,
      words: (words || []).slice(0, PICT_1V1_ROUNDS),
      round: 0,
      phase: "waiting",
      roundStart: null,
      revealAt: null,
      roundWinner: null,
      scores,
      history: [],
      left: [],
    };
  }

  function pictStartRound(state, round) {
    const s = clone(state);
    s.round = round;
    s.phase = "drawing";
    s.roundStart = serverNow() + PICT_GET_READY_MS;
    s.revealAt = null;
    s.roundWinner = null;
    s.v = (state.v || 0) + 1;
    return s;
  }

  // Pulls words from the shared no-repeat rotation (pick_pictionary_words
  // in supabase-schema.sql). Falls back to a local shuffle if that isn't
  // set up yet, and always uses the local shuffle for preview/bot games so
  // testing doesn't burn through the real team rotation.
  async function pickPictWords(n, localOnly) {
    const local = () => shuffle(PICT_WORD_KEYS).slice(0, n);
    if (localOnly) return local();
    try {
      const { data, error } = await sb.rpc("pick_pictionary_words", { candidates: PICT_WORD_KEYS, how_many: n });
      if (error || !Array.isArray(data) || data.length < n) throw error || new Error("not enough words returned");
      return data;
    } catch (e) {
      console.error("pick_pictionary_words RPC unavailable, falling back to a local shuffle:", e);
      return local();
    }
  }

  // Compare-and-swap write. mutate(stateCopy, row) returns the patch to
  // apply ({ state, status?, winner? }) or null to do nothing. If someone
  // else changed the row first, reload it and ask mutate again, so the
  // decision is always made against the latest state.
  async function pictCommit(row, mutate) {
    let current = row;
    for (let attempt = 0; attempt < 5; attempt++) {
      const s = clone(current.state);
      const patch = mutate(s, current);
      if (!patch) return false;
      const baseV = current.state.v || 0;
      patch.state = patch.state || s;
      patch.state.v = baseV + 1;
      patch.updated_at = new Date().toISOString();

      if (isPreviewRow(current)) { // solo game vs the test bot: no database row
        handleGameRow(Object.assign({}, current, patch));
        return true;
      }

      const res = await sb.from("games").update(patch).eq("id", current.id).eq("state->>v", String(baseV)).select();
      if (res.error) {
        console.error("Pictionary update failed:", res.error);
        return false;
      }
      if (res.data && res.data.length) {
        handleGameRow(res.data[0]);
        return true;
      }
      const fresh = await sb.from("games").select("*").eq("id", current.id).single();
      if (fresh.error || !fresh.data) return false;
      current = fresh.data;
      handleGameRow(current);
    }
    return false;
  }

  // ---------- Pictionary: answer checking ----------
  //
  // A guess counts if, ignoring case/punctuation/"a"/"the"/spaces, it
  // matches the word or one of its alternates (pictionary-words.js), in
  // singular or plural, or is one typo away from one on words 5+ letters
  // long. A typo only counts if the guess isn't itself a different word in
  // the list, so "house" never counts for "horse".

  function normalizeGuess(text) {
    return String(text || "")
      .toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^(a|an|the|some|my) /, "");
  }

  function pluralForms(w) {
    const forms = new Set([w, w + "s", w + "es"]);
    if (/[^aeiou]y$/.test(w)) forms.add(w.slice(0, -1) + "ies");
    if (/fe$/.test(w)) forms.add(w.slice(0, -2) + "ves");
    else if (/f$/.test(w)) forms.add(w.slice(0, -1) + "ves");
    if (w.length > 3) {
      if (/ies$/.test(w)) forms.add(w.slice(0, -3) + "y");
      if (/es$/.test(w)) forms.add(w.slice(0, -2));
      if (/s$/.test(w)) forms.add(w.slice(0, -1));
    }
    return forms;
  }

  function pictAnswerForms(word) {
    const forms = new Set();
    [word].concat(PICT_WORDS[word] || []).forEach((a) => {
      const n = normalizeGuess(a).replace(/ /g, "");
      if (n) pluralForms(n).forEach((f) => forms.add(f));
    });
    return forms;
  }

  // Every answer form of every word, so a typo match can be ruled out when
  // the guess is really a different word from the list.
  const PICT_ALL_FORMS = new Set();
  PICT_WORD_KEYS.forEach((w) => pictAnswerForms(w).forEach((f) => PICT_ALL_FORMS.add(f)));

  // Edit distance where swapping two neighboring letters counts as one typo.
  function editDistance(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
    const d = [];
    for (let i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (let j = 0; j <= b.length; j++) { d[0][j] = j; }
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
      }
    }
    return d[a.length][b.length];
  }

  // Returns "correct", "close", or "wrong".
  function checkPictGuess(text, word) {
    const g = normalizeGuess(text);
    if (!g) return "wrong";
    const forms = pictAnswerForms(word);
    const whole = g.replace(/ /g, "");
    if (forms.has(whole)) return "correct";

    // "a big banana", "yellow bananas": the answer appears as its own
    // word(s) inside a short guess -- unless the whole guess is a different
    // word from the list ("hot dog" never counts for "dog").
    const isOtherListWord = PICT_ALL_FORMS.has(whole);
    const tokens = g.split(" ");
    if (tokens.length <= 4 && !isOtherListWord) {
      for (let i = 0; i < tokens.length; i++) {
        if (forms.has(tokens[i])) return "correct";
        if (i + 1 < tokens.length && forms.has(tokens[i] + tokens[i + 1])) return "correct";
      }
    }

    // One typo on a 5+ letter word counts. Otherwise, being within a
    // letter or two of a longer word earns a private "close!" hint.
    let result = "wrong";
    if (isOtherListWord) return result;
    forms.forEach((f) => {
      const dist = editDistance(whole, f);
      if (dist <= 1 && f.length >= 5) result = "correct";
      else if (result !== "correct" && ((dist <= 1 && f.length >= 4) || (dist <= 2 && f.length >= 6))) result = "close";
    });
    return result;
  }

  // ---------- Pictionary: canvas ----------

  const pictCtx = pictCanvas.getContext("2d");
  const pictDraw = {
    key: null, // "gameId:round" the strokes below belong to
    strokes: [], // [{ id, c: color, w: width (fraction of canvas width), p: [[x, y], ...] (0-1) }]
    active: null, // the stroke I'm drawing right now
    pending: [], // points of the active stroke not broadcast yet
    flushTimer: null,
    color: PICT_COLORS[0],
    size: 7,
    eraser: false,
  };
  let pictFeedItems = [];
  let pictBotPlan = null;
  let drawerMissingSince = null;
  let pictGuessWasHidden = true;

  function resizePictCanvas() {
    const rect = pictCanvasWrap.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (pictCanvas.width !== w || pictCanvas.height !== h) {
      pictCanvas.width = w;
      pictCanvas.height = h;
      redrawPict();
    }
  }
  if (window.ResizeObserver) new ResizeObserver(resizePictCanvas).observe(pictCanvasWrap);
  window.addEventListener("resize", resizePictCanvas);

  function drawStroke(st, fromIdx) {
    const W = pictCanvas.width;
    const H = pictCanvas.height;
    const pts = st.p;
    if (!pts || !pts.length) return;
    const lw = Math.max(1, st.w * W);
    pictCtx.strokeStyle = st.c;
    pictCtx.fillStyle = st.c;
    pictCtx.lineWidth = lw;
    pictCtx.lineCap = "round";
    pictCtx.lineJoin = "round";
    if (pts.length === 1) {
      pictCtx.beginPath();
      pictCtx.arc(pts[0][0] * W, pts[0][1] * H, lw / 2, 0, Math.PI * 2);
      pictCtx.fill();
      return;
    }
    const start = Math.max(0, (fromIdx || 0) - 1);
    pictCtx.beginPath();
    pictCtx.moveTo(pts[start][0] * W, pts[start][1] * H);
    for (let i = start + 1; i < pts.length; i++) pictCtx.lineTo(pts[i][0] * W, pts[i][1] * H);
    pictCtx.stroke();
  }

  function redrawPict() {
    pictCtx.fillStyle = "#ffffff";
    pictCtx.fillRect(0, 0, pictCanvas.width, pictCanvas.height);
    pictDraw.strokes.forEach((st) => drawStroke(st, 0));
  }

  // Resets strokes and the guess feed whenever the round (or game) changes,
  // and asks the room for the current drawing in case I just reloaded
  // mid-round.
  function ensurePictKey(g) {
    const key = g.id + ":" + g.state.round;
    if (pictDraw.key === key) return;
    pictDraw.key = key;
    pictDraw.strokes = [];
    pictDraw.active = null;
    pictDraw.pending = [];
    drawerMissingSince = null;
    redrawPict();
    pictFeedItems = [];
    if (g.status === "active" && g.state.drawers && g.state.drawers.length) {
      const drawer = g.state.drawers[g.state.round];
      pictFeedItems.push({
        text: "Round " + (g.state.round + 1) + ": " + (drawer === myClientId ? "you're" : pictName(g, drawer) + " is") + " drawing",
        cls: "system",
      });
    }
    if (g.status === "active" && !isPreviewRow(g)) {
      setTimeout(() => {
        if (pictDraw.key === key) sendPict({ kind: "sync-req" });
      }, 400);
    }
  }

  function pictCanDraw() {
    const g = activeGame;
    if (!g || !isPictType(g.type) || g.status !== "active") return false;
    const s = g.state;
    const now = serverNow();
    return s.phase === "drawing" && s.drawers[s.round] === myClientId &&
      now >= s.roundStart && now < s.roundStart + PICT_ROUND_MS;
  }

  function pictPoint(e) {
    const r = pictCanvas.getBoundingClientRect();
    const clamp = (v) => Math.min(1, Math.max(0, v));
    return [
      Math.round(clamp((e.clientX - r.left) / r.width) * 1000) / 1000,
      Math.round(clamp((e.clientY - r.top) / r.height) * 1000) / 1000,
    ];
  }

  function flushPict() {
    if (pictDraw.flushTimer) { clearTimeout(pictDraw.flushTimer); pictDraw.flushTimer = null; }
    const st = pictDraw.active;
    if (!st || !pictDraw.pending.length) return;
    sendPict({ kind: "seg", id: st.id, c: st.c, w: st.w, p: pictDraw.pending });
    pictDraw.pending = [];
  }

  // Batched to ~10 messages a second while drawing: smooth enough to
  // watch, and well inside Supabase's free-tier realtime message limits
  // even with the whole team watching a Super Challenge.
  function schedulePictFlush() {
    if (!pictDraw.flushTimer) pictDraw.flushTimer = setTimeout(flushPict, 100);
  }

  function endMyStroke() {
    if (!pictDraw.active) return;
    flushPict();
    pictDraw.active = null;
  }

  pictCanvas.addEventListener("pointerdown", (e) => {
    if (!pictCanDraw()) return;
    e.preventDefault();
    endMyStroke();
    try { pictCanvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const st = {
      id: String(myClientId).slice(0, 4) + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      c: pictDraw.eraser ? "#ffffff" : pictDraw.color,
      w: pictDraw.size / 600,
      p: [pictPoint(e)],
    };
    pictDraw.active = st;
    pictDraw.strokes.push(st);
    pictDraw.pending = st.p.slice();
    drawStroke(st, 0);
    schedulePictFlush();
  });

  pictCanvas.addEventListener("pointermove", (e) => {
    const st = pictDraw.active;
    if (!st) return;
    if (!pictCanDraw()) { endMyStroke(); return; }
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const before = st.p.length;
    (events.length ? events : [e]).forEach((ev) => {
      const pt = pictPoint(ev);
      const last = st.p[st.p.length - 1];
      if (Math.abs(pt[0] - last[0]) + Math.abs(pt[1] - last[1]) < 0.003) return;
      st.p.push(pt);
      pictDraw.pending.push(pt);
    });
    if (st.p.length > before) {
      drawStroke(st, before);
      schedulePictFlush();
    }
  });

  ["pointerup", "pointercancel"].forEach((evt) => pictCanvas.addEventListener(evt, endMyStroke));

  function buildPictTools() {
    PICT_COLORS.forEach((c, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pict-color-btn" + (i === 0 ? " active" : "");
      btn.style.background = c;
      btn.title = "Color";
      btn.addEventListener("click", () => {
        pictDraw.color = c;
        pictDraw.eraser = false;
        pictEraserBtn.classList.remove("active");
        pictColors.querySelectorAll(".pict-color-btn").forEach((b) => b.classList.toggle("active", b === btn));
      });
      pictColors.appendChild(btn);
    });
    document.querySelectorAll(".pict-size-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        pictDraw.size = parseInt(btn.dataset.size, 10);
        document.querySelectorAll(".pict-size-btn").forEach((b) => b.classList.toggle("active", b === btn));
      });
    });
    pictEraserBtn.addEventListener("click", () => {
      pictDraw.eraser = !pictDraw.eraser;
      pictEraserBtn.classList.toggle("active", pictDraw.eraser);
    });
    pictUndoBtn.addEventListener("click", () => {
      if (!pictCanDraw() || !pictDraw.strokes.length) return;
      endMyStroke();
      const st = pictDraw.strokes.pop();
      redrawPict();
      sendPict({ kind: "undo", id: st.id });
    });
    pictClearBtn.addEventListener("click", () => {
      if (!pictCanDraw()) return;
      endMyStroke();
      pictDraw.strokes = [];
      redrawPict();
      sendPict({ kind: "clear" });
    });
  }
  buildPictTools();

  // ---------- Pictionary: realtime messages (strokes, guesses) ----------

  function sendPict(msg) {
    const g = activeGame;
    if (!g || !roomChannel || isPreviewRow(g)) return;
    const payload = Object.assign({ g: g.id, r: g.state.round, from: myClientId }, msg);
    roomChannel.send({ type: "broadcast", event: "pict", payload }).catch((e) => console.error("Broadcast failed:", e));
  }

  function onPictMessage(m) {
    const g = activeGame;
    if (!m || !g || m.g !== g.id || !isPictType(g.type) || m.from === myClientId) return;
    const s = g.state;
    if (m.r !== s.round) return;
    ensurePictKey(g);

    if (m.kind === "guess") { addPictFeed(m.name + ": " + m.text, "guess"); return; }
    if (m.kind === "close") { addPictFeed("🔥 " + m.name + " is close!", "close"); return; }

    if (m.kind === "seg") {
      let st = pictDraw.strokes.find((x) => x.id === m.id);
      if (!st) { st = { id: m.id, c: m.c, w: m.w, p: [] }; pictDraw.strokes.push(st); }
      const before = st.p.length;
      st.p = st.p.concat(m.p || []);
      drawStroke(st, before);
    } else if (m.kind === "undo") {
      pictDraw.strokes = pictDraw.strokes.filter((x) => x.id !== m.id);
      redrawPict();
    } else if (m.kind === "clear") {
      pictDraw.strokes = [];
      redrawPict();
    } else if (m.kind === "sync-req") {
      sendPictSync(m.from);
    } else if (m.kind === "sync") {
      receivePictSync(m);
    }
  }

  // Someone (re)loaded mid-round and asked for the drawing so far. Sent in
  // chunks so one big drawing never exceeds a realtime message size limit.
  function sendPictSync(to) {
    const strokes = pictDraw.strokes.filter((st) => st !== pictDraw.active);
    if (!strokes.length) return;
    const chunks = [];
    let current = [];
    let size = 0;
    strokes.forEach((st) => {
      const n = JSON.stringify(st).length;
      if (current.length && size + n > 60000) { chunks.push(current); current = []; size = 0; }
      current.push(st);
      size += n;
    });
    if (current.length) chunks.push(current);
    const syncId = myClientId + Date.now();
    chunks.forEach((chunk, i) => sendPict({ kind: "sync", to, syncId, part: i, parts: chunks.length, total: strokes.length, strokes: chunk }));
  }

  const pictSyncParts = {};
  function receivePictSync(m) {
    if (m.to !== myClientId || !Array.isArray(m.strokes)) return;
    const entry = pictSyncParts[m.syncId] || (pictSyncParts[m.syncId] = { got: {}, count: 0 });
    if (!entry.got[m.part]) { entry.got[m.part] = m.strokes; entry.count++; }
    if (entry.count < m.parts) return;
    delete pictSyncParts[m.syncId];
    if (m.total <= pictDraw.strokes.length) return; // I already have as much (e.g. another reply arrived first)
    let all = [];
    for (let i = 0; i < m.parts; i++) all = all.concat(entry.got[i]);
    pictDraw.strokes = all;
    redrawPict();
  }

  function addPictFeed(text, cls) {
    pictFeedItems.push({ text, cls });
    if (pictFeedItems.length > 60) pictFeedItems.shift();
    renderPictFeed();
  }

  function renderPictFeed() {
    pictFeed.innerHTML = "";
    pictFeedItems.forEach((item) => {
      const li = document.createElement("li");
      li.className = "pict-feed-item " + (item.cls || "");
      li.textContent = item.text;
      pictFeed.appendChild(li);
    });
    pictFeed.scrollTop = pictFeed.scrollHeight;
  }

  // ---------- Pictionary: guessing and round flow ----------

  pictGuessForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const g = activeGame;
    if (!g || !isPictType(g.type) || g.status !== "active") return;
    const s = g.state;
    const drawer = s.drawers[s.round];
    if (s.phase !== "drawing" || drawer === myClientId || serverNow() < s.roundStart) return;
    const text = pictGuessInput.value.trim().slice(0, 40);
    if (!text) return;
    pictGuessInput.value = "";
    const myName = pictName(g, myClientId);
    const result = checkPictGuess(text, s.words[s.round]);
    if (result === "correct") {
      addPictFeed("✅ " + text + " is right!", "correct mine");
      claimPictRound(g, myClientId, s.round);
    } else if (result === "close") {
      addPictFeed("🔥 \"" + text + "\" is close!", "close mine");
      sendPict({ kind: "close", name: myName });
    } else {
      addPictFeed(myName + ": " + text, "guess mine");
      sendPict({ kind: "guess", name: myName, text });
    }
  });

  // ---------- Pictionary: swap word ----------
  //
  // The drawer can trade their word for a different one once per turn.
  // The clock keeps running and there's no point penalty. The skipped word
  // goes back into the team-wide rotation (swap_pictionary_word in
  // supabase-schema.sql); everyone's canvas clears (see onPictRowChanged).
  let pictSwapInFlight = false;

  async function pickSwapWord(g, skipped) {
    const exclude = g.state.words.slice();
    const local = () => {
      const pool = PICT_WORD_KEYS.filter((k) => exclude.indexOf(k) === -1);
      return pool.length ? pickRandom(pool) : null;
    };
    if (isPreviewRow(g) || IS_PREVIEW_BUILD) return local(); // don't touch the real rotation while testing
    try {
      const { data, error } = await sb.rpc("swap_pictionary_word", { candidates: PICT_WORD_KEYS, skipped, exclude });
      if (error || !data) throw error || new Error("swap_pictionary_word returned nothing");
      return String(data);
    } catch (e) {
      console.error("swap_pictionary_word RPC unavailable, picking locally:", e);
      return local();
    }
  }

  async function swapPictWord() {
    const g = activeGame;
    if (!g || !isPictType(g.type) || g.status !== "active" || pictSwapInFlight) return;
    const s = g.state;
    const round = s.round;
    const old = s.words[round];
    if (s.phase !== "drawing" || s.drawers[round] !== myClientId || (s.swaps || []).indexOf(round) !== -1) return;
    if (serverNow() >= s.roundStart + PICT_ROUND_MS) return;
    pictSwapInFlight = true;
    pictSwapBtn.disabled = true;
    const next = await pickSwapWord(g, old);
    if (next) {
      await pictCommit(activeGame && activeGame.id === g.id ? activeGame : g, (st, r) => {
        if (r.status !== "active" || st.phase !== "drawing" || st.round !== round || st.words[round] !== old) return null;
        if ((st.swaps || []).indexOf(round) !== -1 || serverNow() >= st.roundStart + PICT_ROUND_MS) return null;
        st.words[round] = next;
        st.swaps = (st.swaps || []).concat([round]);
        return { state: st };
      });
    }
    pictSwapInFlight = false;
    if (activeGame && isPictType(activeGame.type) && activeGame.status === "active") renderActiveGame();
  }

  pictSwapBtn.addEventListener("click", swapPictWord);

  // Points = seconds left on the clock for the guesser, half that for the
  // drawer. First correct guess ends the round.
  function claimPictRound(row, playerId, round) {
    return pictCommit(row, (s, r) => {
      if (r.status !== "active" || s.phase !== "drawing" || s.round !== round) return null;
      const now = serverNow();
      if (now < s.roundStart) return null;
      const elapsed = now - s.roundStart;
      if (elapsed > PICT_ROUND_MS + 1500) return null; // a little grace for network lag
      const secsLeft = Math.min(PICT_ROUND_SECONDS, Math.max(1, Math.ceil((PICT_ROUND_MS - elapsed) / 1000)));
      const drawer = s.drawers[round];
      const drawerPts = Math.floor(secsLeft / 2);
      s.scores[playerId] = (s.scores[playerId] || 0) + secsLeft;
      s.scores[drawer] = (s.scores[drawer] || 0) + drawerPts;
      s.phase = "reveal";
      s.revealAt = now;
      s.roundWinner = playerId;
      s.history.push({ round, word: s.words[round], drawer, winner: playerId, gp: secsLeft, dp: drawerPts, secs: Math.round(elapsed / 1000) });
      return { state: s };
    });
  }

  function endPictRoundNoWinner(row, round, reason) {
    return pictCommit(row, (s, r) => {
      if (r.status !== "active" || s.phase !== "drawing" || s.round !== round) return null;
      const now = serverNow();
      if (reason === "timeout" && now < s.roundStart + PICT_ROUND_MS) return null;
      s.phase = "reveal";
      s.revealAt = now;
      s.roundWinner = null;
      s.history.push({ round, word: s.words[round], drawer: s.drawers[round], winner: null, gp: 0, dp: 0, reason });
      return { state: s };
    });
  }

  function pictWinner(s) {
    let best = -1;
    let ids = [];
    Object.keys(s.scores).forEach((id) => {
      const v = s.scores[id];
      if (v > best) { best = v; ids = [id]; } else if (v === best) ids.push(id);
    });
    return ids.length === 1 ? ids[0] : "tie";
  }

  function advancePict(row, round) {
    return pictCommit(row, (s, r) => {
      if (r.status !== "active" || s.phase !== "reveal" || s.round !== round) return null;
      if (serverNow() < s.revealAt + PICT_REVEAL_MS - 300) return null;
      let next = round + 1;
      // Skip anyone who has left a Super Challenge when it's their turn.
      while (next < s.drawers.length && (s.left || []).indexOf(s.drawers[next]) !== -1) next++;
      if (next < s.drawers.length) return { state: pictStartRound(s, next) };
      return { status: "finished", winner: pictWinner(s), state: s };
    });
  }

  function drawerGone(g, drawer) {
    if (drawer === myClientId || isBotId(drawer)) return false;
    if ((g.state.left || []).indexOf(drawer) !== -1) return true;
    if (!hasReceivedInitialPresenceSync) return false;
    if (presentPeople[drawer]) { drawerMissingSince = null; return false; }
    if (!drawerMissingSince) drawerMissingSince = Date.now();
    return Date.now() - drawerMissingSince > 8000;
  }

  // Tries a transition at most once every couple of seconds per key, so
  // the 250ms tick doesn't fire off a write every tick while one is in
  // flight.
  const pictAttempts = {};
  function pictTry(key, fn) {
    const t = Date.now();
    if (pictAttempts[key] && t - pictAttempts[key] < 2500) return;
    pictAttempts[key] = t;
    fn();
  }

  function pictTick() {
    tickSuperInvite();
    const g = activeGame;
    if (!g || !isPictType(g.type)) return;
    if (g.type === "pictionary_group" && g.status === "pending") { tickGroupLobby(g); return; }
    if (g.status !== "active") return;

    const s = g.state;
    const now = serverNow();
    updatePictClock(g);
    const drawer = s.drawers[s.round];
    // The drawer and the challenger/host move the game along right away;
    // everyone else waits a few seconds and only steps in if they didn't.
    const isDriver = drawer === myClientId || g.player1_id === myClientId || isPreviewRow(g);
    const grace = isDriver ? 0 : 3000;
    const tag = g.id + ":" + s.round;

    if (s.phase === "drawing") {
      if (now >= s.roundStart + PICT_ROUND_MS + grace) {
        pictTry("timeout:" + tag, () => endPictRoundNoWinner(g, s.round, "timeout"));
      } else if (now >= s.roundStart && drawerGone(g, drawer)) {
        pictTry("left:" + tag, () => endPictRoundNoWinner(g, s.round, "left"));
      } else {
        runPictBot(g);
      }
    } else if (s.phase === "reveal") {
      if (now >= s.revealAt + PICT_REVEAL_MS + grace) {
        pictTry("advance:" + tag, () => advancePict(g, s.round));
      }
    }
  }

  // Row changed: play the right sound and note correct guesses in the feed.
  function onPictRowChanged(prev, row) {
    const s = row.state;
    const p = prev && prev.state;
    if (row.status !== "active" || !s || !s.drawers) return;
    const newRound = !p || p.round !== s.round || (p.phase !== "drawing" && s.phase === "drawing");
    if (newRound && s.phase === "drawing" && s.drawers[s.round] === myClientId) playChallengeSound();
    const swapped = p && p.round === s.round && s.phase === "drawing" && p.words && p.words[s.round] !== s.words[s.round];
    if (swapped) {
      // New word, fresh canvas for everyone.
      endMyStroke();
      pictDraw.strokes = [];
      redrawPict();
      const drawer = s.drawers[s.round];
      addPictFeed(drawer === myClientId ? "🔄 You swapped to a new word" : "🔄 " + pictName(row, drawer) + " swapped their word", "system");
    }
    if (p && p.round === s.round && p.phase === "drawing" && s.phase === "reveal") {
      const h = s.history[s.history.length - 1];
      if (h && h.winner) {
        if (h.winner !== myClientId) addPictFeed("✅ " + pictName(row, h.winner) + " got it!", "correct");
        playPictCorrect();
      } else {
        playPictTimeout();
      }
    }
  }

  function playPictCorrect() {
    try {
      const ctx = ensureAudioContext();
      const now = ctx.currentTime;
      tone(ctx, 784, now, 0.16, 0.09);
      tone(ctx, 988, now + 0.1, 0.16, 0.09);
      tone(ctx, 1319, now + 0.2, 0.35, 0.09);
    } catch (e) { /* audio not unlocked yet, ignore */ }
  }

  function playPictTimeout() {
    try {
      const ctx = ensureAudioContext();
      const now = ctx.currentTime;
      tone(ctx, 392, now, 0.35, 0.09);
      tone(ctx, 311, now + 0.25, 0.5, 0.08);
    } catch (e) { /* audio not unlocked yet, ignore */ }
  }

  // ---------- Pictionary: test bots (Deploy Preview / localhost only) ----------
  //
  // The challenger's (or host's) own browser plays for the bots: Rally in
  // a 1v1, and a whole crew of bots in a Super Challenge so a full group
  // game can be simulated solo. A drawing bot scribbles random shapes (and
  // its word is shown to you, preview only, so you can test guessing it);
  // guessing bots throw out wrong guesses, sometimes get "close", and some
  // of them eventually get it right, at different speeds.

  const SUPER_TEST_BOTS = [
    { id: TEST_BOT_ID, name: TEST_BOT_EMOJI + " " + TEST_BOT_NAME },
    { id: "test-bot-2", name: "🦉 Pixel" },
    { id: "test-bot-3", name: "🐢 Doodle" },
    { id: "test-bot-4", name: "🦝 Scribbles" },
  ];

  function isBotId(id) { return typeof id === "string" && (id === TEST_BOT_ID || id.indexOf("test-bot-") === 0); }

  function runPictBot(g) {
    const s = g.state;
    const bots = s.players.filter((p) => isBotId(p.id));
    if (!bots.length || g.player1_id !== myClientId) return;
    const now = serverNow();
    if (now < s.roundStart) return;
    const key = g.id + ":" + s.round;
    if (!pictBotPlan || pictBotPlan.key !== key) {
      // More bots guessing = each one a bit less likely to get it, so a
      // human guesser still has a real shot in a Super Challenge.
      const correctChance = bots.length > 1 ? 0.45 : 0.75;
      pictBotPlan = { key, shapes: 0, nextShapeAt: now + 1200, bots: {} };
      bots.forEach((b) => {
        pictBotPlan.bots[b.id] = {
          nextAt: now + 2500 + Math.random() * 6000,
          correctAt: Math.random() < correctChance ? now + 15000 + Math.random() * 60000 : null,
        };
      });
    }
    const plan = pictBotPlan;
    const drawer = s.drawers[s.round];

    if (isBotId(drawer) && plan.shapes < 9 && now >= plan.nextShapeAt) {
      plan.shapes++;
      plan.nextShapeAt = now + 1500 + Math.random() * 1500;
      botDrawShape();
    }

    const word = s.words[s.round];
    bots.forEach((b) => {
      if (b.id === drawer) return;
      const bp = plan.bots[b.id];
      if (!bp) return;
      if (bp.correctAt && now >= bp.correctAt) {
        bp.correctAt = null;
        claimPictRound(g, b.id, s.round);
      } else if (now >= bp.nextAt) {
        bp.nextAt = now + 7000 + Math.random() * 8000;
        if (Math.random() < 0.15) {
          addPictFeed("🔥 " + b.name + " is close!", "close");
          sendPict({ kind: "close", name: b.name });
        } else {
          const wrong = pickRandom(PICT_WORD_KEYS.filter((w) => w !== word));
          addPictFeed(b.name + ": " + wrong, "guess");
          sendPict({ kind: "guess", name: b.name, text: wrong });
        }
      }
    });
  }

  // Preview-only: bots trickle into a Super Challenge lobby over the first
  // few seconds, like teammates hitting Join.
  function runLobbyBots(g) {
    if (!IS_PREVIEW_BUILD || g.player1_id !== myClientId) return;
    const s = g.state;
    const elapsed = serverNow() - (s.joinDeadline - SUPER_JOIN_WINDOW_MS);
    const inIds = new Set(s.players.map((p) => p.id));
    SUPER_TEST_BOTS.forEach((b, i) => {
      if (inIds.has(b.id) || elapsed < 1500 + i * 1800) return;
      pictTry("botjoin:" + g.id + ":" + b.id, () => pictCommit(g, (st, r) => {
        if (r.status !== "pending" || st.players.some((p) => p.id === b.id)) return null;
        st.players.push({ id: b.id, name: b.name });
        return { state: st };
      }));
    });
  }

  function botDrawShape() {
    const cx = 0.2 + Math.random() * 0.6;
    const cy = 0.2 + Math.random() * 0.6;
    const r = 0.05 + Math.random() * 0.12;
    const pts = [];
    const kind = Math.floor(Math.random() * 3);
    if (kind === 0) { // circle
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 16) pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 1.33]);
    } else if (kind === 1) { // zigzag
      for (let i = 0; i <= 8; i++) pts.push([cx - r + (i / 8) * r * 2, cy + (i % 2 ? r : -r) * 0.5]);
    } else { // spiral
      for (let a = 0; a < Math.PI * 6; a += Math.PI / 12) pts.push([cx + Math.cos(a) * r * a / 19, cy + Math.sin(a) * r * 1.33 * a / 19]);
    }
    const st = {
      id: "bot" + Date.now().toString(36),
      c: pickRandom(PICT_COLORS),
      w: 6 / 600,
      p: pts.map((pt) => [Math.round(pt[0] * 1000) / 1000, Math.round(pt[1] * 1000) / 1000]),
    };
    pictDraw.strokes.push(st);
    drawStroke(st, 0);
    sendPict({ kind: "seg", id: st.id, c: st.c, w: st.w, p: st.p });
  }

  // ---------- Pictionary: rendering ----------

  function wordBlanks(word) {
    return word.split("").map((ch) => (ch === " " ? "  " : "_")).join(" ");
  }

  function updatePictClock(g) {
    const s = g.state;
    if (!s || !s.drawers || !s.drawers.length) return;
    const now = serverNow();
    const drawer = s.drawers[s.round];
    const amDrawer = drawer === myClientId;
    const word = s.words[s.round] || "";
    let secsText = String(PICT_ROUND_SECONDS);
    let frac = 1;
    let urgent = false;
    let prompt = "";

    if (g.status !== "active") {
      secsText = "🏁";
      frac = 0;
      prompt = "Game over. Last word: " + word.toUpperCase();
    } else if (s.phase === "reveal") {
      const h = s.history[s.history.length - 1];
      secsText = String(h && h.round === s.round ? h.gp : 0);
      frac = 0;
      prompt = "It was: " + word.toUpperCase();
    } else if (now < s.roundStart) {
      const n = Math.ceil((s.roundStart - now) / 1000);
      prompt = amDrawer ? "Get ready to draw: " + word.toUpperCase() + " (" + n + ")" : "Get ready... " + n;
    } else {
      const msLeft = s.roundStart + PICT_ROUND_MS - now;
      const secs = Math.max(0, Math.ceil(msLeft / 1000));
      secsText = String(secs);
      frac = Math.max(0, msLeft / PICT_ROUND_MS);
      urgent = secs <= 15;
      if (amDrawer) prompt = "Draw: " + word.toUpperCase();
      else {
        prompt = wordBlanks(word) + "   (" + word.replace(/ /g, "").length + " letters)";
        if (isBotId(drawer)) prompt += "   [preview only, bot's word: " + word + "]";
      }
    }
    pictTimer.textContent = secsText;
    pictTimer.classList.toggle("urgent", urgent);
    pictTimerFill.style.transform = "scaleX(" + frac + ")";
    pictTimerFill.classList.toggle("urgent", urgent);
    if (pictPrompt.textContent !== prompt) pictPrompt.textContent = prompt;
    pictPrompt.classList.toggle("drawer", amDrawer && g.status === "active" && s.phase === "drawing");
  }

  function renderPictScores(g) {
    const s = g.state;
    const drawer = s.drawers[s.round];
    const left = s.left || [];
    const list = s.players.slice().sort((a, b) => (s.scores[b.id] || 0) - (s.scores[a.id] || 0));
    pictScores.innerHTML = "";
    list.forEach((p) => {
      const li = document.createElement("li");
      li.className = "pict-score" + (p.id === myClientId ? " me" : "") + (left.indexOf(p.id) !== -1 ? " left" : "");
      const name = document.createElement("span");
      name.className = "pict-score-name";
      name.textContent = p.name + (g.status === "active" && p.id === drawer ? " ✏️" : "");
      const pts = document.createElement("span");
      pts.className = "pict-score-pts";
      pts.textContent = String(s.scores[p.id] || 0);
      li.appendChild(name);
      li.appendChild(pts);
      pictScores.appendChild(li);
    });
  }

  function renderPictReveal(g) {
    const s = g.state;
    const h = s.history[s.history.length - 1];
    const show = g.status === "active" && s.phase === "reveal" && h && h.round === s.round;
    pictReveal.hidden = !show;
    if (!show) return;
    pictReveal.innerHTML = "";
    const lines = [];
    if (h.winner) {
      const who = h.winner === myClientId ? "You" : pictName(g, h.winner);
      lines.push(["pict-reveal-big", "🎉 " + who + " got it in " + h.secs + "s!"]);
      lines.push(["", (h.winner === myClientId ? "You" : pictName(g, h.winner)) + " +" + h.gp + "   ·   " +
        (h.drawer === myClientId ? "You" : pictName(g, h.drawer)) + " (drawer) +" + h.dp]);
    } else if (h.reason === "left") {
      lines.push(["pict-reveal-big", "🚪 " + pictName(g, h.drawer) + " left, skipping"]);
    } else {
      lines.push(["pict-reveal-big", "⏰ Time's up!"]);
    }
    lines.push(["pict-reveal-word", "The word was " + String(h.word).toUpperCase()]);
    lines.forEach(([cls, text]) => {
      const p = document.createElement("p");
      if (cls) p.className = cls;
      p.textContent = text;
      pictReveal.appendChild(p);
    });
  }

  function renderPictBoard() {
    const g = activeGame;
    const s = g.state;
    if (!s || !s.drawers || !s.drawers.length) return;
    ensurePictKey(g);
    const drawer = s.drawers[s.round];
    const amDrawer = drawer === myClientId;
    const amPlayer = s.players.some((p) => p.id === myClientId);
    const inPlay = g.status === "active";

    pictRound.textContent = "Round " + (s.round + 1) + " of " + s.drawers.length;
    if (inPlay) {
      gameTurnIndicator.hidden = false;
      gameTurnIndicator.textContent = amDrawer ? "✏️ You're drawing" : "✏️ " + pictName(g, drawer) + " is drawing";
    }

    pictTools.hidden = !(inPlay && amDrawer && s.phase === "drawing");
    const swappedThisRound = (s.swaps || []).indexOf(s.round) !== -1;
    pictSwapBtn.disabled = swappedThisRound || pictSwapInFlight;
    pictSwapBtn.textContent = swappedThisRound ? "🔄 Word swapped" : "🔄 New word";
    const showGuess = inPlay && amPlayer && !amDrawer && s.phase === "drawing";
    pictGuessForm.hidden = !showGuess;
    if (showGuess && pictGuessWasHidden) setTimeout(() => pictGuessInput.focus(), 0);
    pictGuessWasHidden = !showGuess;

    renderPictReveal(g);
    renderPictScores(g);
    updatePictClock(g);
    renderPictFeed();
    requestAnimationFrame(resizePictCanvas);
  }

  function pictResetLocal() {
    pictDraw.key = null;
    pictDraw.strokes = [];
    pictDraw.active = null;
    pictDraw.pending = [];
    pictFeedItems = [];
    pictBotPlan = null;
    pictGuessWasHidden = true;
    pictReveal.hidden = true;
    gameOverlayCard.classList.remove("wide");
  }

  // ---------- Super Challenge (host-only group Pictionary) ----------

  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function initHost() {
    let key = null;
    let fromUrl = false;
    try {
      const params = new URLSearchParams(location.search);
      if (params.has("host")) {
        key = params.get("host");
        fromUrl = true;
        // Strip the key from the address bar so it doesn't end up in a
        // screenshot or a link someone copies.
        params.delete("host");
        const qs = params.toString();
        history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
      }
      if (!key) key = localStorage.getItem(HOST_KEY_STORAGE);
    } catch (e) { /* storage unavailable */ }
    if (!key || !(window.crypto && crypto.subtle)) return;
    try {
      const hash = await sha256Hex(key);
      if (hash === HOST_KEY_HASH) {
        isHost = true;
        try { localStorage.setItem(HOST_KEY_STORAGE, key); } catch (e) { /* not remembered, still works this visit */ }
        if (fromUrl) flashGameToast("⚡ Host mode on: you can start Super Challenges.");
      } else if (!fromUrl) {
        try { localStorage.removeItem(HOST_KEY_STORAGE); } catch (e) { /* ignore */ }
      }
    } catch (e) {
      console.error("Couldn't check host key:", e);
    }
    renderSuperButton();
  }

  function renderSuperButton() {
    const onBreak = !!(currentRow && currentRow.mode === "break");
    superChallengeBtn.hidden = !(isHost && onBreak);
    if (superChallengeBtn.hidden) return;
    const busy = !!(outgoingChallenge || incomingChallenge || (activeGame && !gameIsOver(activeGame)));
    superChallengeBtn.disabled = busy || getPresentOpponents().length === 0;
  }

  async function startSuperChallenge() {
    if (!isHost || outgoingChallenge || incomingChallenge || (activeGame && !gameIsOver(activeGame))) return;
    superChallengeBtn.disabled = true;
    const myName = identity.emoji + " " + identity.name;
    const players = [{ id: myClientId, name: myName }];
    const row = {
      type: "pictionary_group",
      status: "pending",
      player1_id: myClientId,
      player1_name: myName,
      player2_id: "group",
      player2_name: "Everyone",
      turn: null,
      winner: null,
      state: {
        v: 0,
        env: MY_ENV,
        players,
        skipped: [],
        left: [],
        joinDeadline: serverNow() + SUPER_JOIN_WINDOW_MS,
        drawers: [],
        words: [],
        round: 0,
        phase: "lobby",
        scores: {},
        history: [],
      },
    };
    const { data, error } = await sb.from("games").insert(row).select().single();
    if (error) {
      console.error("Failed to start Super Challenge:", error);
      flashGameToast("Couldn't start the Super Challenge. Try again.");
      renderSuperButton();
      return;
    }
    if (activeGame && gameIsOver(activeGame)) { activeGame = null; pictResetLocal(); }
    handleGameRow(data);
  }

  superChallengeBtn.addEventListener("click", startSuperChallenge);

  function handleGroupRow(row) {
    const s = row.state || {};
    if ((s.env || "prod") !== MY_ENV) return;
    if (activeGame && activeGame.id === row.id && (s.v || 0) < ((activeGame.state && activeGame.state.v) || 0)) return;
    const amHost = row.player1_id === myClientId;
    const amIn = (s.players || []).some((p) => p.id === myClientId);
    const prev = activeGame && activeGame.id === row.id ? activeGame : null;

    if (row.status === "pending" || row.status === "active") {
      if ((amHost || amIn) && !leftGames.has(row.id)) {
        if (superInvite && superInvite.id === row.id) hideSuperInvite(false);
        if (activeGame && activeGame.id !== row.id) {
          if (!gameIsOver(activeGame)) return; // busy in another game
          pictResetLocal();
        }
        activeGame = row;
        renderGameOpponents();
        renderActiveGame();
        if (row.status === "active") onPictRowChanged(prev, row);
        return;
      }
      const canInvite = row.status === "pending" && !amHost && !superDismissed.has(row.id) &&
        (!activeGame || gameIsOver(activeGame)) && serverNow() < s.joinDeadline;
      if (canInvite) {
        superInvite = row;
        showSuperInvite();
      } else if (superInvite && superInvite.id === row.id) {
        hideSuperInvite(true);
      }
      return;
    }

    // Cancelled ("declined"), finished, or ended early.
    if (superInvite && superInvite.id === row.id) hideSuperInvite(true);
    if (activeGame && activeGame.id === row.id) {
      activeGame = row;
      renderActiveGame();
      renderGameOpponents();
    }
  }

  const superSounded = new Set();
  function showSuperInvite() {
    superIncoming.hidden = false;
    tickSuperInvite();
    if (!superSounded.has(superInvite.id)) {
      superSounded.add(superInvite.id);
      playChallengeSound();
    }
  }

  function hideSuperInvite(dismiss) {
    superIncoming.hidden = true;
    if (dismiss && superInvite) superDismissed.add(superInvite.id);
    superInvite = null;
  }

  function tickSuperInvite() {
    if (!superInvite) return;
    const s = superInvite.state;
    const left = Math.ceil((s.joinDeadline - serverNow()) / 1000);
    if (left <= 0) { hideSuperInvite(true); return; }
    const count = (s.players || []).length;
    const text = "⚡ " + superInvite.player1_name + " started a Super Challenge: Pictionary! " +
      count + " in so far. Join in " + left + "s";
    if (superIncomingText.textContent !== text) superIncomingText.textContent = text;
  }

  superJoinBtn.addEventListener("click", async () => {
    if (!superInvite) return;
    const row = superInvite;
    const myName = identity.emoji + " " + identity.name;
    superJoinBtn.disabled = true;
    // If I'm looking at a finished 1v1 result, joining replaces it.
    if (activeGame && gameIsOver(activeGame)) { activeGame = null; hideGameOverlay(); pictResetLocal(); }
    const ok = await pictCommit(row, (s, r) => {
      if (r.status !== "pending" || serverNow() > s.joinDeadline + 2000) return null;
      if (s.players.some((p) => p.id === myClientId)) return null;
      s.players.push({ id: myClientId, name: myName });
      s.skipped = (s.skipped || []).filter((x) => x !== myClientId);
      return { state: s };
    });
    superJoinBtn.disabled = false;
    if (!ok && !(activeGame && activeGame.id === row.id)) {
      hideSuperInvite(true);
      flashGameToast("Too late, that Super Challenge already started.");
    }
  });

  superSkipBtn.addEventListener("click", () => {
    if (!superInvite) return;
    const row = superInvite;
    hideSuperInvite(true);
    pictCommit(row, (s, r) => {
      if (r.status !== "pending" || (s.skipped || []).indexOf(myClientId) !== -1) return null;
      s.skipped = (s.skipped || []).concat([myClientId]);
      return { state: s };
    });
  });

  function tickGroupLobby(g) {
    runLobbyBots(g);
    const s = g.state;
    const left = Math.ceil((s.joinDeadline - serverNow()) / 1000);
    const amHost = g.player1_id === myClientId;
    const text = left > 0
      ? "Starting in " + left + "s" + (amHost ? " (or hit Start now)" : "")
      : "Starting...";
    if (pictLobbyStatus.textContent !== text) pictLobbyStatus.textContent = text;
    if (left <= 0) {
      // The host's browser starts it; if the host has vanished, any player
      // does after a few seconds.
      const overdueMs = serverNow() - s.joinDeadline;
      if (amHost || overdueMs > 8000) pictTry("start:" + g.id, () => startGroupGame(g));
    }
  }

  async function startGroupGame(row) {
    const count = (row.state.players || []).length;
    const words = count >= 2 ? await pickPictWords(count, IS_PREVIEW_BUILD) : [];
    return pictCommit(row, (s, r) => {
      if (r.status !== "pending") return null;
      const players = s.players.filter((p) => (s.left || []).indexOf(p.id) === -1);
      if (players.length < 2) return { status: "declined", state: s }; // nobody joined
      const order = shuffle(players.map((p) => p.id)); // everyone draws once, random order
      const w = words.slice();
      while (w.length < order.length) { // someone joined after the words were picked
        w.push(pickRandom(PICT_WORD_KEYS.filter((k) => w.indexOf(k) === -1)));
      }
      s.players = players;
      s.drawers = order;
      s.words = w.slice(0, order.length);
      s.scores = {};
      players.forEach((p) => { s.scores[p.id] = 0; });
      s.history = [];
      return { status: "active", state: pictStartRound(s, 0) };
    });
  }

  pictLobbyStartBtn.addEventListener("click", () => {
    if (!activeGame || activeGame.type !== "pictionary_group" || activeGame.status !== "pending") return;
    pictLobbyStartBtn.disabled = true;
    const g = activeGame;
    pictTry("start:" + g.id, () => startGroupGame(g));
  });

  function closeGroupGame() {
    const g = activeGame;
    const amHost = g.player1_id === myClientId;
    if (g.status === "pending") {
      if (amHost) {
        commitGameUpdate(g, { status: "declined" }); // cancel for everyone
      } else {
        leftGames.add(g.id);
        superDismissed.add(g.id);
        pictCommit(g, (s, r) => {
          if (r.status !== "pending") return null;
          s.players = s.players.filter((p) => p.id !== myClientId);
          return { state: s };
        });
      }
    } else if (g.status === "active") {
      if (amHost) {
        commitGameUpdate(g, { status: "abandoned" }); // end for everyone
      } else {
        leftGames.add(g.id);
        pictCommit(g, (s, r) => {
          if (r.status !== "active" || (s.left || []).indexOf(myClientId) !== -1) return null;
          s.left = (s.left || []).concat([myClientId]);
          return { state: s };
        });
      }
    }
  }

  function renderGroupGame() {
    const g = activeGame;
    const s = g.state;
    const amHost = g.player1_id === myClientId;
    gameTitle.textContent = "⚡ Super Challenge: Pictionary";
    gamePlayAgainBtn.hidden = true;
    gameRematchHint.hidden = true;

    if (g.status === "pending" || g.status === "declined") {
      gameOverlayCard.classList.remove("wide"); // the lobby is just a short list
      pictLobby.hidden = false;
      pictBoard.hidden = true;
      gameTurnIndicator.hidden = false;
      gameTurnIndicator.textContent = "Hosted by " + g.player1_name;
      gameResult.hidden = g.status !== "declined";
      gameResult.textContent = "Super Challenge cancelled" + ((s.players || []).length < 2 ? " (nobody joined)." : ".");

      pictLobbyPlayers.innerHTML = "";
      (s.players || []).forEach((p) => {
        const li = document.createElement("li");
        li.textContent = p.name + (p.id === g.player1_id ? " (host)" : "");
        pictLobbyPlayers.appendChild(li);
      });

      const joined = new Set((s.players || []).map((p) => p.id));
      const skipped = new Set(s.skipped || []);
      const skippedNames = (s.skipped || []).map((id) => (presentPeople[id] ? presentPeople[id].emoji + " " + presentPeople[id].name : null)).filter(Boolean);
      const waitingNames = Object.keys(presentPeople)
        .filter((id) => !joined.has(id) && !skipped.has(id))
        .map((id) => presentPeople[id].emoji + " " + presentPeople[id].name);
      const extra = [];
      if (amHost && waitingNames.length) extra.push("Waiting on: " + waitingNames.join(", "));
      if (skippedNames.length) extra.push("Skipped: " + skippedNames.join(", "));
      pictLobbyExtra.textContent = extra.join("   ·   ");

      const pending = g.status === "pending";
      pictLobbyStartBtn.hidden = !(amHost && pending);
      pictLobbyStartBtn.disabled = (s.players || []).length < 2;
      if (!pending) pictLobbyStatus.textContent = "";
      else tickGroupLobby(g);
      gameCloseBtn.textContent = pending ? (amHost ? "Cancel" : "Leave") : "Close";
      return;
    }

    pictLobby.hidden = true;
    pictBoard.hidden = false;
    const done = g.status === "finished" || g.status === "abandoned";
    gameResult.hidden = !done;
    gameTurnIndicator.hidden = done;
    if (done) {
      if (g.status === "abandoned") {
        gameResult.textContent = "The host ended the game early.";
      } else if (g.winner === "tie") {
        const top = Math.max.apply(null, Object.values(s.scores));
        const names = s.players.filter((p) => s.scores[p.id] === top).map((p) => (p.id === myClientId ? "you" : p.name));
        gameResult.textContent = "🤝 It's a tie between " + names.join(" and ") + "!";
      } else if (g.winner === myClientId) {
        gameResult.textContent = "🎉 You won the Super Challenge!";
      } else {
        gameResult.textContent = "🏆 " + pictName(g, g.winner) + " wins!";
      }
    }
    gameCloseBtn.textContent = done ? "Close" : (amHost ? "End game" : "Leave game");
    renderPictBoard();
  }

  // ---------- Networking / realtime ----------
  async function fetchInitialState() {
    const { data, error } = await sb.from("timer_state").select("*").eq("id", 1).single();
    if (error || !data) {
      console.error("Could not load timer state, seeding idle row:", error);
      await sb.from("timer_state").upsert({ id: 1, mode: "idle" });
      applyTimerState({ mode: "idle" });
      return;
    }
    applyTimerState(data);
  }

  function subscribeToRoom() {
    const channel = sb.channel(cfg.ROOM_NAME, {
      config: { presence: { key: myClientId } },
    });
    roomChannel = channel;

    // Pictionary strokes and guesses are sent as lightweight broadcast
    // messages rather than database writes (dozens per second while
    // someone draws). Only round results go through the games table.
    channel.on("broadcast", { event: "pict" }, ({ payload }) => onPictMessage(payload));

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      renderPresence(state);
      hasReceivedInitialPresenceSync = true;
    });

    // (Fixed alongside Pictionary: this used to reference an undefined
    // `clientId`, which threw and silently stopped the join sound.)
    channel.on("presence", { event: "join" }, ({ key }) => {
      const state = channel.presenceState();
      renderPresence(state);
      if (hasReceivedInitialPresenceSync && key && key !== myClientId) playJoinSound();
    });

    channel.on("presence", { event: "leave" }, () => {
      renderPresence(channel.presenceState());
    });

    channel.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "timer_state", filter: "id=eq.1" },
      (payload) => applyTimerState(payload.new)
    );

    // No per-row filter here (Realtime's filter syntax can't express "either
    // column matches my id" in one clause) -- with just six people and the
    // occasional break-time game, it's cheap enough to receive every games
    // row change and let handleGameRow() ignore the ones that aren't mine.
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "games" },
      (payload) => handleGameRow(payload.new)
    );

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ name: identity.name, emoji: identity.emoji });
      }
    });
  }

  async function fetchMyActiveGame() {
    const { data, error } = await sb
      .from("games")
      .select("*")
      .or("player1_id.eq." + myClientId + ",player2_id.eq." + myClientId)
      .in("status", ["pending", "active"])
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) {
      console.error("Could not load in-progress game:", error);
      return;
    }
    if (data && data[0]) handleGameRow(data[0]);

    // Super Challenges aren't tied to player1/player2, so look for any
    // recent open one (handleGroupRow decides whether I'm in it or invited).
    const group = await sb
      .from("games")
      .select("*")
      .eq("type", "pictionary_group")
      .in("status", ["pending", "active"])
      .order("created_at", { ascending: false })
      .limit(3);
    if (group.error) {
      console.error("Could not load Super Challenges:", group.error);
      return;
    }
    (group.data || []).forEach((row) => handleGameRow(row));
  }

  // Asks the database for its clock once, so every browser agrees on round
  // timers and "points = seconds left" even if a computer's clock is off.
  // Falls back to this computer's clock if server_now() isn't set up yet.
  async function syncServerClock() {
    try {
      const t0 = Date.now();
      const { data, error } = await sb.rpc("server_now");
      const t1 = Date.now();
      if (error || !data) throw error || new Error("server_now returned nothing");
      clockOffsetMs = new Date(data).getTime() - (t0 + t1) / 2;
    } catch (e) {
      console.error("server_now RPC unavailable, using this computer's clock:", e);
      clockOffsetMs = 0;
    }
  }

  function enterRoom() {
    myClientId = getOrCreateClientId();
    entryScreen.hidden = true;
    roomScreen.hidden = false;
    subscribeToRoom();
    fetchInitialState();
    syncServerClock().then(fetchMyActiveGame);
    initHost();
    setInterval(pictTick, 250);
  }

  // ---------- Boot ----------
  function boot() {
    renderEmojiGrid();
    updateJoinButtonState();

    // Returning visitor: pre-fill their saved name/emoji, but still require
    // one click on "Continue" (rather than auto-joining) so the browser has a
    // user gesture to unlock audio playback for the chime/join sounds.
    const saved = localStorage.getItem(IDENTITY_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.name && parsed.emoji) {
          selectedEmoji = parsed.emoji;
          nameInput.value = parsed.name;
          joinBtn.textContent = "Continue";
          renderEmojiGrid();
          updateJoinButtonState();
        }
      } catch (e) { /* fall through to entry screen */ }
    }
  }

  boot();
})();
