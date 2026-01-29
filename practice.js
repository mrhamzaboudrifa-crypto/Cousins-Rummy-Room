/* Cousins Rummy Room — PRACTICE MODE (Bots) — FULL FILE (REPLACE ALL)
   Key fixes:
   - NO constant re-render loop that fights scrolling
   - Hand is COLLAPSIBLE (▲ open / ▼ close) so Unwanted can be used
   - Unwanted peek strip scrolls smoothly and remembers position
   - Hand scroll remembers position
   - Draw from deck/unwanted goes to FRONT + highlight new card
   - Must lay at least 1 meld this round before adding to any meld
*/

const app = document.getElementById("app");

/* =========================
   Utilities / Constants
========================= */
const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUIT_COLOR = (s) => (s === "♥" || s === "♦") ? "red" : "black";
const rankIndex = (r) => RANKS.indexOf(r);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const now = () => Date.now();
const escapeHtml = (s) =>
  (s || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const uid = () => Math.random().toString(36).slice(2, 10);

const RANK_VALUE = (r) => (r === "A" || r === "10" || r === "J" || r === "Q" || r === "K") ? 10 : 5;
const cardLabel = (c) => `${c.r}${c.s}`;

function parseParams() {
  const p = new URLSearchParams(location.search);
  const bots = clamp(parseInt(p.get("bots") || "1", 10), 1, 3);
  const difficulty = (p.get("difficulty") || "easy").toLowerCase();
  const diff = ["easy", "mid", "pro", "goat"].includes(difficulty) ? difficulty : "easy";
  return { bots, difficulty: diff };
}

const { bots: BOT_COUNT, difficulty: BOT_DIFFICULTY } = parseParams();

/* =========================
   State
========================= */
const state = {
  // game flow
  turnIndex: 0,
  dealerIndex: 0,
  phase: "DRAW", // DRAW -> MELD -> DISCARD
  turnMsLeft: 60000,
  turnTimer: null,

  // piles
  deck: [],
  unwanted: [],
  peekOpen: false,
  peekIndex: -1,

  // players (0 is you)
  players: [],

  // selection
  selectedIds: new Set(),

  // rule: must lay at least 1 meld THIS ROUND before add-to-meld
  laidMeldThisTurn: false,

  // scroll memory
  handScrollLeft: 0,
  peekScrollLeft: 0,

  // new draw highlight
  lastDrawnId: null,

  // UI flags
  uiNeedsRender: true,

  // collapsible hand
  handOpen: false, // default collapsed

  // modal for opponent melds
  modal: null
};

/* =========================
   Deck / Meld Validation
========================= */
function makeDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (const r of RANKS) deck.push({ id: uid(), r, s });
  }
  // shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function isValidSet(cards) {
  if (cards.length < 3) return false;
  const r = cards[0].r;
  return cards.every(c => c.r === r);
}

// Run validation: same suit consecutive; Ace low or high (Q-K-A)
function isValidRun(cards) {
  if (cards.length < 3) return false;
  const suit = cards[0].s;
  if (!cards.every(c => c.s === suit)) return false;

  // low-A check
  const idx = cards.map(c => rankIndex(c.r)).sort((a, b) => a - b);
  const consecutiveLow = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  if (consecutiveLow) return true;

  // high-A check (A treated as 13)
  if (!cards.some(c => c.r === "A")) return false;
  const idxHigh = cards.map(c => (c.r === "A" ? 13 : rankIndex(c.r))).sort((a, b) => a - b);
  return idxHigh.every((v, i) => i === 0 || v === idxHigh[i - 1] + 1);
}

function validateMeld(cards) {
  if (cards.length < 3) return { ok: false, reason: "Meld must be 3+ cards." };
  if (isValidSet(cards)) return { ok: true, type: "set" };
  if (isValidRun(cards)) return { ok: true, type: "run" };
  return { ok: false, reason: "Not a valid set or run." };
}

function pointsOfCards(cards) {
  return cards.reduce((sum, c) => sum + RANK_VALUE(c.r), 0);
}

/* =========================
   Players / Deal
========================= */
function makePlayers() {
  const youName = localStorage.getItem("crr_name") || "You";
  const names = ["Alice", "Mike", "John", "Med", "Lisa", "Zara", "Omar", "Tara", "Nina"];

  const bots = [];
  let used = new Set([youName.toLowerCase()]);
  for (let i = 0; i < BOT_COUNT; i++) {
    let n = names.find(x => !used.has(x.toLowerCase())) || `Bot${i + 1}`;
    used.add(n.toLowerCase());
    bots.push({ uid: `bot_${i}`, name: n, bot: true });
  }

  return [
    { uid: "me", name: youName, bot: false },
    ...bots
  ].map(p => ({
    ...p,
    hand: [],
    melds: [],
    score: 0,
    mustLayMeldFirst: true
  }));
}

function deal() {
  state.dealerIndex = Math.floor(Math.random() * state.players.length);
  const nextIndex = (state.dealerIndex + 1) % state.players.length;

  // deal 7 each, next to dealer gets 8
  for (let i = 0; i < state.players.length; i++) {
    const count = (i === nextIndex) ? 8 : 7;
    for (let k = 0; k < count; k++) state.players[i].hand.push(state.deck.pop());
  }

  // unwanted starts with 1
  state.unwanted.push(state.deck.pop());
  state.peekIndex = state.unwanted.length - 1;
  state.peekOpen = false;

  // first turn is next to dealer
  state.turnIndex = nextIndex;
  state.phase = "DRAW";
  state.selectedIds.clear();
  state.laidMeldThisTurn = false;

  state.turnMsLeft = 60000;
}

/* =========================
   Turn / Timer
========================= */
function curPlayer() { return state.players[state.turnIndex]; }
function isMyTurn() { return curPlayer().uid === "me"; }
function mePlayer() { return state.players.find(p => p.uid === "me"); }

function startTurnTimer() {
  stopTurnTimer();
  const start = now();
  const startLeft = state.turnMsLeft;

  state.turnTimer = setInterval(() => {
    const elapsed = now() - start;
    state.turnMsLeft = clamp(startLeft - elapsed, 0, 60000);
    if (state.turnMsLeft === 0) onTimeoutAutoMove();
    requestRender();
  }, 250);
}

function stopTurnTimer() {
  if (state.turnTimer) {
    clearInterval(state.turnTimer);
    state.turnTimer = null;
  }
}

function onTimeoutAutoMove() {
  stopTurnTimer();
  const p = curPlayer();
  if (state.phase === "DRAW") autoDrawFromDeck(p);
  if (state.phase !== "DRAW") autoRandomDiscard(p);
  endTurn();
}

function nextTurnIndex() {
  return (state.turnIndex + 1) % state.players.length;
}

function endTurn() {
  state.selectedIds.clear();
  state.laidMeldThisTurn = false;
  state.phase = "DRAW";

  state.turnIndex = nextTurnIndex();
  state.turnMsLeft = 60000;
  startTurnTimer();
  requestRender();

  if (curPlayer().bot) setTimeout(() => botAct(), 350);
}

/* =========================
   Render Control (NO fighting)
========================= */
function requestRender() {
  state.uiNeedsRender = true;
  // we do NOT render immediately; we render in a light loop that only runs when needed
}

function renderLoopTick() {
  if (!state.uiNeedsRender) return;
  state.uiNeedsRender = false;
  renderGame();
}

/* =========================
   Selection
========================= */
function toggleSelect(cardId) {
  if (!isMyTurn()) return;
  const me = mePlayer();
  const card = me.hand.find(c => c.id === cardId);
  if (!card) return;

  if (state.selectedIds.has(cardId)) state.selectedIds.delete(cardId);
  else state.selectedIds.add(cardId);

  requestRender();
}

function getSelectedCardsFromHand() {
  const me = mePlayer();
  const ids = [...state.selectedIds];
  return ids.map(id => me.hand.find(c => c.id === id)).filter(Boolean);
}

/* =========================
   Actions
========================= */
function clearJustDrewSoon() {
  setTimeout(() => {
    const me = mePlayer();
    if (me) for (const c of me.hand) delete c._justDrew;
    state.lastDrawnId = null;
    requestRender();
  }, 900);
}

function drawFromDeck() {
  if (!isMyTurn()) return;
  if (state.phase !== "DRAW") return;
  const me = mePlayer();
  if (state.deck.length === 0) return;

  const c = state.deck.pop();
  c._justDrew = true;
  state.lastDrawnId = c.id;
  me.hand.unshift(c); // FRONT

  state.phase = "MELD";
  requestRender();
  clearJustDrewSoon();
}

function takeUnwantedTop() {
  if (!isMyTurn()) return;
  if (state.phase !== "DRAW") return;
  const me = mePlayer();
  if (!state.unwanted.length) return;

  const c = state.unwanted.pop();
  c._justDrew = true;
  state.lastDrawnId = c.id;
  me.hand.unshift(c);

  state.peekIndex = state.unwanted.length - 1;
  state.peekOpen = false;
  state.phase = "MELD";
  requestRender();
  clearJustDrewSoon();
}

function takeUnwantedAll() {
  if (!isMyTurn()) return;
  if (state.phase !== "DRAW") return;
  const me = mePlayer();
  if (!state.unwanted.length) return;

  const pile = state.unwanted.splice(0, state.unwanted.length);
  for (let i = pile.length - 1; i >= 0; i--) me.hand.unshift(pile[i]);

  state.peekIndex = -1;
  state.peekOpen = false;
  state.phase = "MELD";
  requestRender();
}

function layMeld() {
  if (!isMyTurn()) return;
  if (state.phase === "DRAW") return;

  const me = mePlayer();
  const cards = getSelectedCardsFromHand();
  const v = validateMeld(cards);
  if (!v.ok) { alert(v.reason); return; }

  const ids = new Set(cards.map(c => c.id));
  me.hand = me.hand.filter(c => !ids.has(c.id));
  me.melds.push(cards);

  state.selectedIds.clear();
  state.laidMeldThisTurn = true;
  me.mustLayMeldFirst = false;

  requestRender();
}

function discardSelected() {
  if (!isMyTurn()) return;
  if (state.phase === "DRAW") return;

  const me = mePlayer();
  if (state.selectedIds.size !== 1) {
    alert("Select exactly 1 card to discard.");
    return;
  }

  const id = [...state.selectedIds][0];
  const idx = me.hand.findIndex(c => c.id === id);
  if (idx < 0) return;

  const [c] = me.hand.splice(idx, 1);
  state.unwanted.push(c);

  state.selectedIds.clear();
  state.peekIndex = state.unwanted.length - 1;
  state.peekOpen = false;
  requestRender();

  // win must happen after discard
  if (me.hand.length === 0) {
    endRound(me.uid);
    return;
  }

  endTurn();
}

// AUTO helpers
function autoDrawFromDeck(p) {
  if (state.deck.length === 0) return;
  const c = state.deck.pop();
  p.hand.unshift(c);
  state.phase = "MELD";
}
function autoRandomDiscard(p) {
  if (!p.hand.length) return;
  const idx = Math.floor(Math.random() * p.hand.length);
  const [c] = p.hand.splice(idx, 1);
  state.unwanted.push(c);
  state.peekIndex = state.unwanted.length - 1;
  state.peekOpen = false;
}

/* =========================
   End Round / Scoring
========================= */
function endRound(winnerUid) {
  stopTurnTimer();
  const winner = state.players.find(p => p.uid === winnerUid);

  winner.score += pointsOfCards(winner.melds.flat());

  for (const p of state.players) {
    if (p.uid === winnerUid) continue;

    const laid = p.melds.flat();
    let laidTokens = laid.map(c => RANK_VALUE(c.r));

    const handVals = p.hand.map(c => RANK_VALUE(c.r));
    for (const hv of handVals) {
      if (hv === 10) {
        const i10 = laidTokens.indexOf(10);
        if (i10 >= 0) { laidTokens.splice(i10, 1); continue; }

        const i5a = laidTokens.indexOf(5);
        if (i5a >= 0) {
          laidTokens.splice(i5a, 1);
          const i5b = laidTokens.indexOf(5);
          if (i5b >= 0) laidTokens.splice(i5b, 1);
          continue;
        }
      } else {
        const i5 = laidTokens.indexOf(5);
        if (i5 >= 0) { laidTokens.splice(i5, 1); continue; }
      }
    }

    const laidTotal = pointsOfCards(laid);
    const remainingLaidTotal = laidTokens.reduce((a, b) => a + b, 0);
    const cancelledValue = laidTotal - remainingLaidTotal;

    const handTotal = pointsOfCards(p.hand);
    const uncancelled = Math.max(0, handTotal - cancelledValue);

    p.score -= uncancelled;
  }

  alert(`${winner.name} won the round!`);
  startNewRound();
}

function startNewRound() {
  state.deck = makeDeck();
  for (const p of state.players) {
    p.hand = [];
    p.melds = [];
    p.mustLayMeldFirst = true;
  }
  state.unwanted = [];
  state.selectedIds.clear();
  state.peekOpen = false;
  state.peekIndex = -1;
  state.handScrollLeft = 0;
  state.peekScrollLeft = 0;
  state.laidMeldThisTurn = false;

  deal();
  startTurnTimer();
  requestRender();

  if (curPlayer().bot) setTimeout(() => botAct(), 350);
}

/* =========================
   Bot AI (tiered simple)
========================= */
function botAct() {
  const p = curPlayer();
  if (!p.bot) return;

  if (state.phase === "DRAW") {
    botDraw(p);
    requestRender();
    setTimeout(() => botMeldAndDiscard(p), 450);
    return;
  }
  botMeldAndDiscard(p);
}

function botWouldUseCard(p, card, diff) {
  const sameRankCount = p.hand.filter(x => x.r === card.r).length;
  if (sameRankCount >= 2) return true;

  const sameSuitIdx = p.hand.filter(x => x.s === card.s).map(x => rankIndex(x.r));
  const r = rankIndex(card.r);
  if (sameSuitIdx.includes(r - 1) || sameSuitIdx.includes(r + 1)) return true;

  return diff === "goat" && Math.random() < 0.35;
}

function botDraw(p) {
  const diff = BOT_DIFFICULTY;
  const top = state.unwanted[state.unwanted.length - 1];
  const shouldTakeTop = top && botWouldUseCard(p, top, diff);

  if ((diff === "pro" || diff === "goat") && shouldTakeTop && Math.random() < 0.7) {
    const c = state.unwanted.pop();
    p.hand.unshift(c);
    state.phase = "MELD";
    state.peekIndex = state.unwanted.length - 1;
    state.peekOpen = false;
    return;
  }

  autoDrawFromDeck(p);
}

function removeFromHand(p, cards) {
  const ids = new Set(cards.map(c => c.id));
  p.hand = p.hand.filter(c => !ids.has(c.id));
}

function botTryLayMeld(p) {
  const byRank = new Map();
  for (const c of p.hand) {
    if (!byRank.has(c.r)) byRank.set(c.r, []);
    byRank.get(c.r).push(c);
  }
  for (const [, arr] of byRank) {
    if (arr.length >= 3) {
      const meld = arr.slice(0, Math.min(4, arr.length));
      removeFromHand(p, meld);
      p.melds.push(meld);
      p.mustLayMeldFirst = false;
      state.laidMeldThisTurn = true;
      return true;
    }
  }

  const bySuit = new Map();
  for (const c of p.hand) {
    if (!bySuit.has(c.s)) bySuit.set(c.s, []);
    bySuit.get(c.s).push(c);
  }
  for (const [, arr] of bySuit) {
    const sorted = arr.slice().sort((a, b) => rankIndex(a.r) - rankIndex(b.r));
    for (let i = 0; i <= sorted.length - 3; i++) {
      const window = [sorted[i], sorted[i + 1], sorted[i + 2]];
      if (isValidRun(window)) {
        removeFromHand(p, window);
        p.melds.push(window);
        p.mustLayMeldFirst = false;
        state.laidMeldThisTurn = true;
        return true;
      }
    }
    const hasQ = arr.find(c => c.r === "Q");
    const hasK = arr.find(c => c.r === "K");
    const hasA = arr.find(c => c.r === "A");
    if (hasQ && hasK && hasA) {
      const window = [hasQ, hasK, hasA];
      removeFromHand(p, window);
      p.melds.push(window);
      p.mustLayMeldFirst = false;
      state.laidMeldThisTurn = true;
      return true;
    }
  }

  return false;
}

function botTryAddToMeld(p) {
  for (let i = 0; i < p.hand.length; i++) {
    const c = p.hand[i];
    for (const target of state.players) {
      for (let m = 0; m < target.melds.length; m++) {
        const meld = target.melds[m];
        const combined = meld.concat([c]);
        if (validateMeld(combined).ok) {
          p.hand.splice(i, 1);
          target.melds[m] = combined;
          return true;
        }
      }
    }
  }
  return false;
}

function botDiscard(p) {
  let idx = 0;
  let bestScore = -Infinity;

  for (let i = 0; i < p.hand.length; i++) {
    const c = p.hand[i];
    let keep = 0;
    keep += (p.hand.filter(x => x.r === c.r).length >= 2) ? 3 : 0;

    const suitIdx = p.hand.filter(x => x.s === c.s).map(x => rankIndex(x.r));
    const r = rankIndex(c.r);
    if (suitIdx.includes(r - 1) || suitIdx.includes(r + 1)) keep += 2;

    const score = (RANK_VALUE(c.r)) - keep * 3;
    if (score > bestScore) {
      bestScore = score;
      idx = i;
    }
  }

  const [c] = p.hand.splice(idx, 1);
  state.unwanted.push(c);
  state.peekIndex = state.unwanted.length - 1;
  state.peekOpen = false;

  if (p.hand.length === 0) {
    endRound(p.uid);
    return;
  }

  endTurn();
}

function botMeldAndDiscard(p) {
  if (state.phase !== "MELD") return;

  botTryLayMeld(p);
  if (!p.mustLayMeldFirst) botTryAddToMeld(p);
  botDiscard(p);
}

/* =========================
   UI helpers
========================= */
function formatMs(ms) {
  return `${Math.ceil(ms / 1000)}s`;
}

function isJustDrawn(c) {
  return c && (c._justDrew || c.id === state.lastDrawnId);
}

function cardHTML(c, { selectable = false, selected = false } = {}) {
  const cls = ["card", SUIT_COLOR(c.s)];
  if (selected) cls.push("sel");
  const click = selectable ? `data-card="${c.id}"` : "";
  return `
    <div class="${cls.join(" ")}" ${click}>
      <div class="corner tl">${escapeHtml(c.r)}<br>${escapeHtml(c.s)}</div>
      <div class="pip">${escapeHtml(c.s)}</div>
      <div class="corner br">${escapeHtml(c.r)}<br>${escapeHtml(c.s)}</div>
    </div>
  `;
}

/* =========================
   Render
========================= */
function renderGame() {
  const me = mePlayer();
  const cur = curPlayer();
  const others = state.players.filter(p => p.uid !== "me");

  app.innerHTML = `
    <div class="safe">
      <div class="shell gameLayout">

        <div class="hdr">
          <div class="brand">
            <div class="title">Cousins</div>
            <div class="subtitle">Rummy Room</div>
            <div class="underline"></div>
          </div>
          <div class="exitMini" id="exitBtn">Menu</div>
        </div>

        <div class="turnBanner">
          <div>
            <b>${cur.uid === "me" ? "YOUR TURN" : `${escapeHtml(cur.name)}'s Turn`}</b>
            <div class="muted">Phase: ${escapeHtml(state.phase)} — Draw → (Lay/Add) → Discard 1</div>
          </div>
          <div style="font-weight:900; font-size:18px;">
            ${state.turnMsLeft <= 15000 ? `<span class="danger">${formatMs(state.turnMsLeft)}</span>` : formatMs(state.turnMsLeft)}
          </div>
        </div>

        <div class="panel gameMain">

          <div class="seatRow" id="seatRow">
            ${others.map(p => {
              const active = (p.uid === cur.uid) ? "activeTurn" : "";
              return `
                <div class="seatBox ${active}" data-seat="${p.uid}">
                  <div><b>${escapeHtml(p.name)}</b></div>
                  <div class="small">Cards left: ${p.hand.length}</div>
                  <div class="small">Score: ${p.score}</div>
                  <div class="small">${p.mustLayMeldFirst ? "Must lay 1 meld first ⛔" : "Add-to-meld unlocked ✅"}</div>
                </div>
              `;
            }).join("")}
          </div>

          <div class="centerRow">
            <div class="pileBox">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <b>Deck</b>
                <span class="small">${state.deck.length} left</span>
              </div>
              <div class="deckStack" id="deckTap" title="Tap to draw 1">
                <div class="back"></div>
                <div class="label">TAP</div>
              </div>
              <div class="hint">Tap the deck to draw 1</div>
            </div>

            <div class="pileBox">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <b>Unwanted</b>
                <span class="small">${state.unwanted.length} cards</span>
              </div>

              <div class="hint">
                ${state.unwanted.length
                  ? `Top: <b id="unwantedTop" style="cursor:pointer;">${escapeHtml(cardLabel(state.unwanted[state.unwanted.length - 1]))}</b> (tap to peek)`
                  : "Empty"}
              </div>

              <div class="peekWrap">
                <div class="peekStrip" id="peekStrip" style="display:${state.peekOpen ? "flex" : "none"}">
                  ${state.unwanted.map((c, i) => {
                    const active = (i === state.peekIndex) ? "active" : "";
                    return `<div class="peekCard ${active}" data-peek="${i}">${cardHTML(c)}</div>`;
                  }).join("")}
                </div>
              </div>

              <div class="btnRow" style="margin-top:10px;">
                <button class="btn cyan" id="takeTop" ${(!isMyTurn() || state.phase !== "DRAW" || !state.unwanted.length) ? "disabled" : ""}>Take Top</button>
                <button class="btn" id="takeAll" ${(!isMyTurn() || state.phase !== "DRAW" || !state.unwanted.length) ? "disabled" : ""}>Take All</button>
              </div>
            </div>
          </div>

          <div class="meldTray">
            <div class="meldTrayHead">
              <b>Your melds</b>
              <span class="small">${me.mustLayMeldFirst ? "Lay 1 meld first ⛔" : "Add-to-meld unlocked ✅"}</span>
            </div>
            <div class="meldTrayBody">
              ${me.melds.length ? me.melds.map((meld, idx) => `
                <div class="meldBlock">
                  <div class="small">Meld ${idx + 1}</div>
                  <div style="display:flex; gap:6px; margin-top:6px;">
                    ${meld.map(c => cardHTML(c)).join("")}
                  </div>
                </div>
              `).join("") : `<div class="small">No melds yet…</div>`}
            </div>
          </div>

        </div>

        <!-- Collapsible Hand Bar -->
        <div class="handBar">
          <div class="handHead" style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <b>Your hand</b>
              <div class="small">${state.handOpen ? "Slide left/right to view cards" : "Collapsed (tap ▲ to open)"}</div>
            </div>
            <button class="btn" id="toggleHand" style="width:auto; padding:10px 12px;">
              ${state.handOpen ? "▼" : "▲"}
            </button>
          </div>

          <div id="handWrap" style="display:${state.handOpen ? "block" : "none"};">
            <div id="hand">
              ${me.hand.map(c => {
                const selected = state.selectedIds.has(c.id);
                const glow = selected || isJustDrawn(c);
                return cardHTML(c, { selectable: true, selected: glow });
              }).join("")}
            </div>

            <div class="btnRow">
              <button class="btn cyan" id="layMeld" ${(!isMyTurn() || state.phase === "DRAW") ? "disabled" : ""}>Lay Meld</button>
              <button class="btn" id="discard" ${(!isMyTurn() || state.phase === "DRAW") ? "disabled" : ""}>Discard (1)</button>
            </div>
          </div>
        </div>

      </div>
    </div>

    ${state.modal ? `
      <div id="modalBg" style="position:fixed; inset:0; background:rgba(0,0,0,.55); display:flex; align-items:center; justify-content:center; padding:12px;">
        <div class="panel" style="width:min(940px, 96vw); max-height:80dvh; overflow:auto; padding:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <b>${escapeHtml(state.modal.title)}</b>
            <button class="btn" id="closeModal" style="width:auto;">Close</button>
          </div>
          <div style="height:10px"></div>
          ${state.modal.melds.length ? state.modal.melds.map((meld, idx) => `
            <div class="meldBlock" style="margin-bottom:10px;">
              <div class="small">Meld ${idx + 1}</div>
              <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
                ${meld.map(c => cardHTML(c)).join("")}
              </div>
            </div>
          `).join("") : `<div class="small">No melds yet.</div>`}
        </div>
      </div>
    ` : ""}
  `;

  // ---------- Wire events (AFTER render) ----------
  const deckTap = document.getElementById("deckTap");
  if (deckTap) deckTap.onclick = drawFromDeck;

  const takeTopBtn = document.getElementById("takeTop");
  if (takeTopBtn) takeTopBtn.onclick = takeUnwantedTop;

  const takeAllBtn = document.getElementById("takeAll");
  if (takeAllBtn) takeAllBtn.onclick = takeUnwantedAll;

  const toggleHandBtn = document.getElementById("toggleHand");
  if (toggleHandBtn) {
    toggleHandBtn.onclick = () => {
      state.handOpen = !state.handOpen;
      requestRender();

      // when opening, restore scroll position after paint
      setTimeout(() => {
        const handEl = document.getElementById("hand");
        if (handEl && state.handOpen) handEl.scrollLeft = state.handScrollLeft;
      }, 0);
    };
  }

  const handEl = document.getElementById("hand");
  if (handEl) {
    // restore scroll
    handEl.scrollLeft = state.handScrollLeft;

    // store scroll
    handEl.addEventListener("scroll", () => {
      state.handScrollLeft = handEl.scrollLeft;
    }, { passive: true });

    // select
    handEl.querySelectorAll("[data-card]").forEach(el => {
      el.onclick = () => toggleSelect(el.getAttribute("data-card"));
    });
  }

  const layBtn = document.getElementById("layMeld");
  if (layBtn) layBtn.onclick = layMeld;

  const discBtn = document.getElementById("discard");
  if (discBtn) discBtn.onclick = discardSelected;

  const topTap = document.getElementById("unwantedTop");
  if (topTap) {
    topTap.onclick = () => {
      state.peekOpen = !state.peekOpen;
      state.peekIndex = state.unwanted.length - 1;
      requestRender();

      setTimeout(() => {
        const strip = document.getElementById("peekStrip");
        if (strip && state.peekOpen) {
          // restore scroll or jump to end if first open
          strip.scrollLeft = (state.peekScrollLeft > 0) ? state.peekScrollLeft : strip.scrollWidth;
        }
      }, 0);
    };
  }

  const peekStrip = document.getElementById("peekStrip");
  if (peekStrip) {
    // restore scroll
    peekStrip.scrollLeft = state.peekScrollLeft;

    // store scroll
    peekStrip.addEventListener("scroll", () => {
      state.peekScrollLeft = peekStrip.scrollLeft;
    }, { passive: true });

    // select peek card
    peekStrip.querySelectorAll("[data-peek]").forEach(el => {
      el.onclick = () => {
        state.peekIndex = parseInt(el.getAttribute("data-peek"), 10);
        requestRender();
      };
    });
  }

  // seats modal
  const seatRow = document.getElementById("seatRow");
  if (seatRow) {
    seatRow.querySelectorAll("[data-seat]").forEach(el => {
      el.onclick = () => {
        const u = el.getAttribute("data-seat");
        const p = state.players.find(x => x.uid === u);
        if (!p) return;
        state.modal = { title: `${p.name}'s melds`, melds: p.melds };
        requestRender();
      };
    });
  }

  const closeModal = document.getElementById("closeModal");
  if (closeModal) closeModal.onclick = () => { state.modal = null; requestRender(); };

  const modalBg = document.getElementById("modalBg");
  if (modalBg) {
    modalBg.onclick = (e) => {
      if (e.target.id === "modalBg") {
        state.modal = null;
        requestRender();
      }
    };
  }

  const exitBtn = document.getElementById("exitBtn");
  if (exitBtn) {
    exitBtn.onclick = () => {
      if (confirm("Exit practice mode?")) location.href = "./index.html";
    };
  }
}

/* =========================
   Boot
========================= */
function boot() {
  state.players = makePlayers();
  state.deck = makeDeck();
  state.unwanted = [];

  deal();
  startTurnTimer();

  renderGame();

  // ✅ light render loop (only renders when needed)
  setInterval(renderLoopTick, 120);

  if (curPlayer().bot) setTimeout(() => botAct(), 350);
}

boot();