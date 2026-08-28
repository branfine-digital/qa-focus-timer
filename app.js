(() => {
  "use strict";

  const cfg = window.TIMER_CONFIG;
  const { createClient } = window.supabase;
  const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  const EMOJIS = ["😀","😎","🦄","🐙","🐝","🦊","🐼","🐸","🚀","🔥","🌈","🍕","☕","🎧","🧠","🐢","🦖","🍩"];
  const IDENTITY_KEY = "qa_focus_identity";
  const CLIENT_ID_KEY = "qa_focus_client_id";

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
  const doneOverlay = document.getElementById("done-overlay");

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
  function replayEntrance(el) {
    el.style.animation = "none";
    void el.offsetWidth; // force reflow
    el.style.animation = "";
  }

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

  function showPicker() {
    doneOverlay.hidden = true;
    countdownPanel.hidden = true;
    pickerPanel.hidden = false;
    replayEntrance(pickerPanel);
    document.querySelectorAll(".bubble").forEach(replayEntrance);
  }

  function showCountdown(row) {
    pickerPanel.hidden = true;
    doneOverlay.hidden = true;
    countdownPanel.hidden = false;
    countdownModeLabel.textContent = row.mode === "work" ? "Work session" : "Break";
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
      showPicker();
      return;
    }

    const endsAtMs = new Date(row.ends_at).getTime();

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
    };

    tick();
    tickTimer = setInterval(tick, 250);
  }

  async function startTimer(mode, minutes) {
    if (!minutes || minutes <= 0) return;
    const now = new Date();
    const endsAt = new Date(now.getTime() + minutes * 60 * 1000);
    const { error } = await sb.from("timer_state").update({
      mode,
      duration_sec: minutes * 60,
      started_at: now.toISOString(),
      ends_at: endsAt.toISOString(),
      started_by: identity.emoji + " " + identity.name,
      updated_at: now.toISOString(),
    }).eq("id", 1);
    if (error) console.error("Failed to start timer:", error);
  }

  async function resetRoom() {
    const { error } = await sb.from("timer_state").update({
      mode: "idle",
      duration_sec: null,
      started_at: null,
      ends_at: null,
      started_by: null,
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
      startTimer(activeMode, minutes);
    });
  });

  customStartBtn.addEventListener("click", () => {
    const minutes = parseInt(customMinutesInput.value, 10);
    if (!minutes || minutes <= 0) {
      customMinutesInput.focus();
      return;
    }
    startTimer(activeMode, minutes);
    customMinutesInput.value = "";
  });

  doneOverlay.addEventListener("click", () => {
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

    const saved = localStorage.getItem(IDENTITY_KEY);
    if (saved) {
      try {
        identity = JSON.parse(saved);
        if (identity && identity.name && identity.emoji) {
          enterRoom();
          return;
        }
      } catch (e) { /* fall through to entry screen */ }
    }
  }

  boot();
})();
