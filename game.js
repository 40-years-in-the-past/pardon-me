// Game logic and rendering. All numbers come from config.js, all text from locales/bg.js.
(function () {
  "use strict";

  const CFG = window.GAME_CONFIG;
  const L = window.LOCALE;

  const TICK_MS = 100;
  const HOLD_MS = 1500;
  const ACTION_KEYS = ["minister", "influencer", "pardon"];
  const INTERVIEW_KEYS = ["praise", "evasive", "insult"];
  const POST_COLORS = ["#3b5b92", "#b03a2e", "#1e8449", "#7d3c98", "#ca6f1e", "#2e4053"];

  const els = {};
  let state = null;
  let shown = {};          // last rendered values, used to flash changes
  let timerId = null;
  let lastTick = 0;

  // ---------- helpers ----------

  function h(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function randInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function shuffle(list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  function resolveValue(value) {
    return Array.isArray(value) ? randInt(value[0], value[1]) : value;
  }

  // Replaces {placeholders} with explicit vars or config names.
  function fill(text, vars) {
    const values = Object.assign({}, CFG.names, vars || {});
    return String(text).replace(/\{(\w+)\}/g, function (match, key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match;
    });
  }

  // Looks up a locale string by dotted path. A missing key shows its path, so gaps are easy to spot.
  function t(path, vars) {
    const value = path.split(".").reduce(function (obj, key) {
      return obj == null ? undefined : obj[key];
    }, L);
    return fill(value === undefined ? path : value, vars);
  }

  function formatEffect(effect) {
    return Object.keys(effect).map(function (key) {
      const value = resolveValue(effect[key]);
      if (key === "money") {
        return (value < 0 ? "-" : "+") + t("ui.currency") + Math.abs(value);
      }
      return (value > 0 ? "+" : "") + value + " " + t("ui." + key);
    }).join(", ");
  }

  function dayLabel() {
    return t("ui.day", { day: Math.min(state.day, CFG.game.days), total: CFG.game.days });
  }

  function totalEvents() {
    return CFG.game.days * CFG.game.eventsPerDay;
  }

  function setImage(img, src) {
    img.classList.remove("is-missing");
    img.src = src;
  }

  function initialsOf(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2)
      .map(function (word) { return word.charAt(0).toUpperCase(); })
      .join("");
  }

  function colorFor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    }
    return POST_COLORS[hash % POST_COLORS.length];
  }

  // ---------- stats and effects ----------

  function clampStat(value) {
    return Math.max(CFG.game.stat.min, Math.min(CFG.game.stat.max, value));
  }

  // Applies an effect to the state. Returns the resolved numbers (ranges are rolled here).
  function applyEffect(effect) {
    const applied = {};
    Object.keys(effect).forEach(function (key) {
      const value = resolveValue(effect[key]);
      applied[key] = value;
      if (key === "money") state.money = Math.max(0, state.money + value);
      else if (key === "friendship") state.friendship = clampStat(state.friendship + value);
      else if (key === "pr") state.pr = clampStat(state.pr + value);
    });
    return applied;
  }

  function canAfford(effect) {
    return Object.keys(effect).every(function (key) {
      return effect[key] >= 0 || state[key] + effect[key] >= 0;
    });
  }

  function moodFor(pr) {
    const band = CFG.moodBands.find(function (b) { return pr >= b.min; });
    return band ? band.key : "worried";
  }

  // ---------- events ----------

  function drawFromDeck(name, source) {
    if (!state.decks[name] || state.decks[name].length === 0) {
      state.decks[name] = shuffle(source);
    }
    return state.decks[name].pop();
  }

  function pickFakePage() {
    const pages = CFG.names.fakePages;
    let free = pages.filter(function (page) { return state.usedPages.indexOf(page) === -1; });
    if (free.length === 0) {
      state.usedPages = [];
      free = pages.slice();
    }
    const page = pick(free);
    state.usedPages.push(page);
    return page;
  }

  function chooseEventType() {
    const chance = Math.min(CFG.scandal.maxChance, state.pardons * CFG.scandal.chancePerPardon);
    if (Math.random() < chance) return "scandal";

    const weights = CFG.eventWeights;
    const types = Object.keys(weights);
    const total = types.reduce(function (sum, type) { return sum + weights[type]; }, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < types.length; i++) {
      roll -= weights[types[i]];
      if (roll < 0) return types[i];
    }
    return types[types.length - 1];
  }

  function createEvent(type) {
    if (type === "satire") {
      const data = drawFromDeck("satire", L.events.satire);
      return {
        type: type,
        data: data,
        page: pickFakePage(),
        effectKey: data.tone === "fan" ? "satireFan" : "satireMock",
        applied: null
      };
    }
    if (type === "interview") {
      return {
        type: type,
        data: drawFromDeck("interview", L.events.interview),
        order: shuffle(INTERVIEW_KEYS),
        answered: false,
        timedOut: false,
        choice: null,
        applied: null
      };
    }
    // news or scandal
    return {
      type: type,
      data: drawFromDeck(type, L.events[type]),
      effectKey: type,
      applied: null
    };
  }

  function startEvent() {
    if (state.eventIndex >= totalEvents()) {
      endGame();
      return;
    }
    state.day = Math.floor(state.eventIndex / CFG.game.eventsPerDay) + 1;
    const event = createEvent(chooseEventType());
    if (event.effectKey) {
      event.applied = applyEffect(CFG.effects[event.effectKey]);
    }
    state.current = event;
    state.eventRemainingMs = CFG.game.eventDurationMs;
    state.holdMs = 0;
    renderAll();
  }

  function finishEvent() {
    state.eventIndex += 1;
    startEvent();
  }

  function onEventTimeout() {
    const event = state.current;
    if (event.type === "interview" && !event.answered) {
      answerInterview(CFG.game.interviewTimeoutAnswer, true);
      state.holdMs = HOLD_MS; // keep the feedback on screen briefly
      return;
    }
    finishEvent();
  }

  function answerInterview(choice, timedOut) {
    const event = state.current;
    if (!event || event.type !== "interview" || event.answered || state.over) return;
    event.answered = true;
    event.timedOut = Boolean(timedOut);
    event.choice = choice;
    event.applied = applyEffect(CFG.effects.interview[choice]);
    renderEvent();
    renderHud();
  }

  // ---------- actions and NPC panel ----------

  function onActionClick(key) {
    if (state.over || state.intro) return;
    const action = CFG.actions[key];
    if (state.cooldowns[key] > 0) {
      showNpc(key, "cooldownLines");
    } else if (!canAfford(action.effect)) {
      showNpc(key, "cannotAffordLines");
    } else {
      applyEffect(action.effect);
      if (action.isPardon) state.pardons += 1;
      state.cooldowns[key] = action.cooldownMs;
      showNpc(key, "reactionLines");
      renderHud();
      renderActions();
    }
  }

  function showNpc(key, linesKey) {
    const action = CFG.actions[key];
    els.npcText.textContent = fill(pick(L.actions[key][linesKey]));
    els.npcPanel.classList.toggle("text-only", !action.hasNpcImage);
    if (action.hasNpcImage) {
      setImage(els.npcImage, CFG.assets.npcs + key + ".png");
      els.npcImage.alt = t("actions." + key + ".label");
      els.npcImage.hidden = false;
    } else {
      els.npcImage.hidden = true;
    }
    state.npcOpen = true;
    els.eventCard.hidden = true;
    els.npcPanel.hidden = false;
  }

  function closeNpc() {
    state.npcOpen = false;
    els.npcPanel.hidden = true;
    if (!state.over) els.eventCard.hidden = false;
  }

  // ---------- timing ----------

  function tick() {
    const now = performance.now();
    const dt = Math.min(250, now - lastTick);
    lastTick = now;
    if (state.over) return;

    // Cooldowns always run.
    ACTION_KEYS.forEach(function (key) {
      state.cooldowns[key] = Math.max(0, state.cooldowns[key] - dt);
    });

    // Event timer and feedback hold pause while the NPC panel is open.
    if (!state.npcOpen) {
      if (state.eventRemainingMs > 0) {
        state.eventRemainingMs = Math.max(0, state.eventRemainingMs - dt);
        if (state.eventRemainingMs === 0) {
          onEventTimeout();
          return;
        }
      } else {
        state.holdMs -= dt;
        if (state.holdMs <= 0) {
          finishEvent();
          return;
        }
      }
    }

    renderTimer();
    renderActions();
  }

  function startLoop() {
    stopLoop();
    lastTick = performance.now();
    timerId = setInterval(tick, TICK_MS);
  }

  function stopLoop() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  // ---------- ending ----------

  function endGame() {
    state.over = true;
    state.npcOpen = false;
    state.current = null;
    state.eventRemainingMs = 0;
    stopLoop();

    els.npcPanel.hidden = true;
    els.eventCard.hidden = true;

    const won = state.pr >= CFG.game.winThreshold;
    const vars = {
      pr: state.pr,
      threshold: CFG.game.winThreshold,
      money: state.money,
      friendship: state.friendship,
      pardons: state.pardons
    };
    els.endTitle.textContent = t(won ? "ui.winTitle" : "ui.loseTitle");
    els.endText.textContent = t(won ? "ui.winText" : "ui.loseText", vars);
    els.endStats.textContent = t("ui.finalStats", vars);
    els.endPanel.hidden = false;

    renderHud();
    renderActions();
    renderTimer();
  }

  function newGame() {
    state = {
      money: CFG.game.startValues.money,
      friendship: CFG.game.startValues.friendship,
      pr: CFG.game.startValues.pr,
      pardons: 0,
      day: 1,
      eventIndex: 0,
      current: null,
      eventRemainingMs: 0,
      holdMs: 0,
      npcOpen: false,
      over: false,
      intro: true,
      cooldowns: {},
      decks: {},
      usedPages: []
    };
    ACTION_KEYS.forEach(function (key) { state.cooldowns[key] = 0; });
    shown = {};
    stopLoop();

    els.endPanel.hidden = true;
    els.npcPanel.hidden = true;
    els.eventCard.hidden = true;
    els.introPanel.hidden = false;

    renderAll();
  }

  // Ends the intro screen and starts the first event and the timer.
  function beginPlay() {
    if (!state || !state.intro || state.over) return;
    state.intro = false;
    els.introPanel.hidden = true;
    els.eventCard.hidden = false;
    startEvent();
    startLoop();
  }

  // ---------- rendering ----------

  function renderAll() {
    renderHud();
    renderEvent();
    renderActions();
    renderTimer();
  }

  function flashIfChanged(node, key, value) {
    if (key in shown && shown[key] !== value) {
      node.classList.remove("flash");
      void node.offsetWidth; // restart the animation
      node.classList.add("flash");
    }
    shown[key] = value;
  }

  function renderHud() {
    els.day.textContent = dayLabel();
    els.money.textContent = t("ui.currency") + state.money;
    els.friendship.textContent = t("ui.friendshipCurrency") + String(state.friendship);
    els.prValue.textContent = String(state.pr);
    els.prFill.style.height = state.pr + "%";

    const mood = moodFor(state.pr);
    els.moodZone.dataset.mood = mood;
    if (els.avatar.dataset.mood !== mood) {
      els.avatar.dataset.mood = mood;
      setImage(els.avatar, CFG.assets.moods + mood + ".png");
      els.avatar.alt = t("ui.avatarAlt", { mood: t("moods." + mood) });
    }

    flashIfChanged(els.statMoney, "money", state.money);
    flashIfChanged(els.statFriendship, "friendship", state.friendship);
    flashIfChanged(els.prBar, "pr", state.pr);
  }

  function renderTimer() {
    const ratio = Math.max(0, Math.min(1, state.eventRemainingMs / CFG.game.eventDurationMs));
    els.timerFill.style.width = ratio * 100 + "%";
  }

  function renderActions() {
    ACTION_KEYS.forEach(function (key) {
      const view = els.actions[key];
      const cooldown = state.cooldowns[key];
      const affordable = canAfford(CFG.actions[key].effect);
      view.button.classList.toggle("on-cooldown", cooldown > 0);
      view.button.classList.toggle("unaffordable", !affordable);
      view.button.disabled = state.over || state.intro;
      view.cooldown.textContent = cooldown > 0
        ? t("ui.cooldown", { s: Math.ceil(cooldown / 1000) })
        : "";
    });
  }

  function renderEvent() {
    const event = state.current;
    els.eventCard.replaceChildren();
    if (!event) return;

    let card;
    if (event.type === "satire") card = buildSocialPost(event);
    else if (event.type === "interview") card = buildInterview(event);
    else card = buildNewspaper(event);

    if (event.applied) {
      card.append(h("div", "delta-chip", formatEffect(event.applied)));
    }
    els.eventCard.append(card);
  }

  function buildReactions() {
    const bar = h("div", "reactions");
    CFG.reactionIcons.forEach(function (icon) {
      const chip = h("span", "reaction");
      chip.append(h("span", "reaction-icon", icon), h("span", "reaction-count", String(randInt(12, 480))));
      bar.append(chip);
    });
    return bar;
  }

  function buildSocialPost(event) {
    const post = h("article", "post");
    const head = h("header", "post-head");
    const badge = h("div", "page-badge", initialsOf(event.page));
    badge.style.background = colorFor(event.page);
    const meta = h("div", "post-meta");
    meta.append(h("div", "page-name", event.page), h("div", "post-time", t("ui.justNow")));
    head.append(badge, meta);
    post.append(head, h("p", "post-text", fill(event.data.text)), buildReactions());
    return post;
  }

  function buildNewspaper(event) {
    const isScandal = event.type === "scandal";
    const paper = h("article", "newspaper" + (isScandal ? " is-breaking" : ""));
    if (isScandal) paper.append(h("div", "breaking-banner", t("ui.breaking")));

    const dateline = h("div", "dateline", dayLabel());

    paper.append(
      h("div", "masthead", CFG.names.masthead),
      dateline,
      h("h2", "headline", fill(event.data.headline)),
      h("p", "subhead", fill(event.data.subhead)),
      h("p", "newspaper-body", fill(event.data.body))
    );
    return paper;
  }

  function buildInterview(event) {
    const tv = h("article", "tv");
    const top = h("div", "tv-top");
    top.append(h("span", "live-tag", t("ui.live")), h("span", null, t("ui.reporter")));
    tv.append(top, h("p", "question", fill(event.data.question)));

    const answers = h("div", "answers");
    event.order.forEach(function (key) {
      const button = h("button", "answer answer-" + key, fill(event.data.answers[key]));
      button.type = "button";
      button.disabled = event.answered;
      if (event.answered && event.choice === key) button.classList.add("chosen");
      button.addEventListener("click", function () { answerInterview(key, false); });
      answers.append(button);
    });
    tv.append(answers);

    if (event.answered) {
      const feedbackKey = event.timedOut ? "timeout" : event.choice;
      tv.append(h("p", "feedback", fill(L.feedback[feedbackKey])));
    }
    return tv;
  }

  // ---------- setup ----------

  function cacheElements() {
    els.day = document.getElementById("hud-day");
    els.statMoney = document.getElementById("stat-money");
    els.money = document.getElementById("stat-money-value");
    els.statFriendship = document.getElementById("stat-friendship");
    els.friendship = document.getElementById("stat-friendship-value");
    els.eventCard = document.getElementById("event-card");
    els.timerFill = document.getElementById("event-timer-fill");
    els.npcPanel = document.getElementById("npc-panel");
    els.npcImage = document.getElementById("npc-image");
    els.npcText = document.getElementById("npc-text");
    els.npcClose = document.getElementById("npc-close");
    els.endPanel = document.getElementById("end-panel");
    els.endTitle = document.getElementById("end-title");
    els.endText = document.getElementById("end-text");
    els.endStats = document.getElementById("end-stats");
    els.restart = document.getElementById("restart-btn");
    els.introPanel = document.getElementById("intro-panel");
    els.introStart = document.getElementById("intro-start");
    els.avatar = document.getElementById("avatar-img");
    els.moodZone = document.getElementById("mood-zone");
    els.prBar = document.getElementById("pr-bar");
    els.prFill = document.getElementById("pr-fill");
    els.prValue = document.getElementById("pr-value");
    els.actions = {};
  }

  function applyStaticText() {
    document.title = t("ui.title");
    document.querySelectorAll("[data-i18n]").forEach(function (node) {
      node.textContent = t(node.getAttribute("data-i18n"));
    });
  }

  function attachImageFallbacks() {
    document.querySelectorAll("img").forEach(function (img) {
      img.addEventListener("error", function () { img.classList.add("is-missing"); });
    });
  }

  function setupActions() {
    ACTION_KEYS.forEach(function (key) {
      const button = document.querySelector('[data-action="' + key + '"]');
      button.querySelector(".action-label").textContent = t("actions." + key + ".label");
      button.querySelector(".action-cost").textContent = formatEffect(CFG.actions[key].effect);
      setImage(button.querySelector(".thumb"), CFG.assets.thumbs + key + ".png");
      els.actions[key] = {
        button: button,
        cooldown: button.querySelector(".action-cooldown")
      };
      button.addEventListener("click", function () { onActionClick(key); });
    });
  }

  function init() {
    cacheElements();
    applyStaticText();
    attachImageFallbacks();
    setupActions();
    els.npcClose.addEventListener("click", closeNpc);
    els.restart.addEventListener("click", newGame);
    els.introStart.addEventListener("click", beginPlay);
    newGame();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
