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

  // Only ever true on a Netlify Deploy Preview (or localhost, for my own
  // testing) -- never on the real production domain. Lets a single person
  // try the whole challenge/play flow solo against a simulated opponent
  // before real teammates are around to test with.
  const IS_PREVIEW_BUILD = /deploy-preview/.test(location.hostname) || location.hostname === "localhost";
  const TEST_BOT_ID = "test-bot";
  const TEST_BOT_NAME = "Rally";
  const TEST_BOT_EMOJI = "🤖";

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
  const wordleGuessForm = document.getElementById("wordle-guess-form");
  const wordleGuessInput = document.getElementById("wordle-guess-input");
  const wordleError = document.getElementById("wordle-error");
  const gameResult = document.getElementById("game-result");
  const gameRematchHint = document.getElementById("game-rematch-hint");
  const gamePlayAgainBtn = document.getElementById("game-play-again-btn");
  const gameCloseBtn = document.getElementById("game-close-btn");

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
      if (activeGame && activeGame.status === "active") {
        commitGameUpdate(activeGame, { status: "abandoned" });
        activeGame = null;
        hideGameOverlay();
      }
    }

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
      [["memory", "🧠 Memory"], ["wordle", "🔤 Wordle"]].forEach(([type, label]) => {
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
      row.player1_name + " challenged you to " + (row.type === "memory" ? "Memory Match" : "a Wordle Duel") + "!";
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

  function buildInitialGameState(gameType, presetSecret) {
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
      if (row.turn !== wasKnownTurn) onGameTurnChanged(row);
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
    const presetSecret = row.type !== "wordle" ? undefined :
      (isBot ? pickRandom(WORDLE_WORDS).toUpperCase() : await pickSharedWordleSecret());

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
      state: buildInitialGameState(row.type, presetSecret),
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
      else makeBotWordleGuess(activeGame);
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
    const presetSecret = gameType !== "wordle" ? undefined :
      isBot ? pickRandom(WORDLE_WORDS).toUpperCase() : await pickSharedWordleSecret();

    const baseRow = {
      type: gameType,
      status: "pending",
      player1_id: myClientId,
      player1_name: identity.emoji + " " + identity.name,
      player2_id: opponent.id,
      player2_name: opponent.emoji + " " + opponent.name,
      turn: myClientId, // the challenger goes first
      winner: null,
      state: buildInitialGameState(gameType, presetSecret),
    };

    if (isBot) {
      const fakeRow = Object.assign(
        { id: "preview-" + Date.now(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        baseRow
      );
      handleGameRow(fakeRow);
      setTimeout(() => {
        if (outgoingChallenge && outgoingChallenge.id === fakeRow.id) {
          commitGameUpdate(fakeRow, { status: "active" });
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
    commitGameUpdate(incomingChallenge, { status: "active" });
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
    if (activeGame && activeGame.status === "active") {
      commitGameUpdate(activeGame, { status: "abandoned" });
    }
    activeGame = null;
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
    const iAmP1 = activeGame.player1_id === myClientId;
    const myName = iAmP1 ? activeGame.player1_name : activeGame.player2_name;
    const oppName = iAmP1 ? activeGame.player2_name : activeGame.player1_name;
    gameTitle.textContent =
      (activeGame.type === "memory" ? "🧠 Memory Match" : "🔤 Wordle Duel") + ": " + myName + " vs " + oppName;

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

    memoryBoard.hidden = activeGame.type !== "memory";
    memoryScoreboard.hidden = activeGame.type !== "memory";
    wordleBoard.hidden = activeGame.type !== "wordle";

    if (activeGame.type === "memory") renderMemoryBoard();
    else renderWordleBoard();
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

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      renderPresence(state);
      hasReceivedInitialPresenceSync = true;
    });

    channel.on("presence", { event: "join" }, ({ newPresences }) => {
      const state = channel.presenceState();
      renderPresence(state);
      if (hasReceivedInitialPresenceSync) {
        const someoneElseJoined = newPresences.some((p) => p.key !== clientId);
        if (someoneElseJoined) playJoinSound();
      }
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
  }

  function enterRoom() {
    myClientId = getOrCreateClientId();
    entryScreen.hidden = true;
    roomScreen.hidden = false;
    subscribeToRoom();
    fetchInitialState();
    fetchMyActiveGame();
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
