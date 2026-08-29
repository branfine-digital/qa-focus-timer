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

  stripEntranceOnce(pickerPanel);
  stripEntranceOnce(countdownPanel);
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
  let activeMode = "work";
  let currentRow = null; // last known timer_state row
  let tickTimer = null;
  let inDoneState = false;
  let chimeLoopTimer = null;
  let audioCtx = null;
  let hasReceivedInitialPresenceSync = false;

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
    Object.values(state).forEach((entries) => {
      const p = entries[0];
      if (!p) return;
      const chip = document.createElement("div");
      chip.className = "presence-chip";
      chip.innerHTML = '<span class="chip-emoji">' + p.emoji + "</span><span>" + p.name + "</span>";
      presenceBar.appendChild(chip);
    });
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
    const clientId = getOrCreateClientId();
    const channel = sb.channel(cfg.ROOM_NAME, {
      config: { presence: { key: clientId } },
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

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ name: identity.name, emoji: identity.emoji });
      }
    });
  }

  function enterRoom() {
    entryScreen.hidden = true;
    roomScreen.hidden = false;
    subscribeToRoom();
    fetchInitialState();
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
