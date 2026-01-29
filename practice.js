/* Cousins Rummy Room — PRACTICE MODE (Bots)
   FIXED:
   - No re-render loop (prevents scroll fighting)
   - Never re-render while user is actively dragging a horizontal slider
   - Big tap target for Unwanted top to open peek
   - Smooth hand + peek scrolling (pan-x)
   - Deck draw inserts at FRONT + highlight
*/

const app = document.getElementById("app");

// ---------- Utilities ----------
const SUITS = ["♠","♥","♦","♣"];
const SUIT_COLOR = (s) => (s==="♥"||s==="♦") ? "red" : "black";
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const RANK_VALUE = (r) => (r==="A"||r==="10"||r==="J"||r==="Q"||r==="K") ? 10 : 5;

const now = () => Date.now();
const clamp = (n,a,b)=>Math.max(a,Math.min(b,n));
const escapeHtml = (s)=>(s||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const uid = ()=>Math.random().toString(36).slice(2,10);

function parseParams(){
  const p = new URLSearchParams(location.search);
  const bots = clamp(parseInt(p.get("bots")||"1",10), 1, 3);
  const difficulty = (p.get("difficulty")||"easy").toLowerCase();
  return {
    bots,
    difficulty: ["easy","mid","pro","goat"].includes(difficulty) ? difficulty : "easy"
  };
}

function cardLabel(c){ return `${c.r}${c.s}`; }
function rankIndex(r){ return RANKS.indexOf(r); }

// ---------- State ----------
const state = {
  // turn / timer
  turnIndex: 0,
  dealerIndex: 0,
  phase: "DRAW", // DRAW -> MELD -> DISCARD
  turnMsLeft: 60000,
  timerId: null,
  _chimed30: false,
  _chimed15: false,

  // piles
  deck: [],
  unwanted: [],
  peekOpen: false,
  peekIndex: 0,

  // players
  players: [],

  // selection
  selectedIds: new Set(),
  lastDrawnId: null,

  // rule: must lay at least 1 meld first THIS ROUND before adding
  laidMeldThisRound: new Set(), // store uids who have laid at least one meld this round

  // modal
  modal: null, // {title, melds}

  // scroll stability
  handScrollLeft: 0,
  peekScrollLeft: 0,

  // interaction lock (prevents fighting)
  dragging: {
    hand: false,
    peek: false,
    seats: false,
    melds: false
  },

  // render scheduler
  needsRender: true,
  renderQueued: false,
};

const { bots: BOT_COUNT, difficulty: BOT_DIFFICULTY } = parseParams();

// ---------- Deck / Meld validation ----------
function makeDeck(){
  const deck = [];
  for (const s of SUITS){
    for (const r of RANKS){
      deck.push({ id: uid(), r, s });
    }
  }
  for (let i=deck.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function isValidSet(cards){
  if (cards.length < 3) return false;
  const r = cards[0].r;
  return cards.every(c=>c.r===r);
}

function isValidRun(cards){
  if (cards.length < 3) return false;
  const suit = cards[0].s;
  if (!cards.every(c=>c.s===suit)) return false;

  // low-A check
  const idx = cards.map(c=>rankIndex(c.r)).sort((a,b)=>a-b);
  const consecutiveLow = idx.every((v,i)=> i===0 || v===idx[i-1]+1);
  if (consecutiveLow) return true;

  // high-A check (A treated as 13)
  if (!cards.some(c=>c.r==="A")) return false;
  const idxHigh = cards.map(c=> (c.r==="A"?13:rankIndex(c.r)) ).sort((a,b)=>a-b);
  const consecutiveHigh = idxHigh.every((v,i)=> i===0 || v===idxHigh[i-1]+1);
  return consecutiveHigh;
}

function validateMeld(cards){
  if (cards.length < 3) return { ok:false, reason:"Meld must be 3+ cards." };
  if (isValidSet(cards)) return { ok:true, type:"set" };
  if (isValidRun(cards)) return { ok:true, type:"run" };
  return { ok:false, reason:"Not a valid set or run." };
}

function pointsOfCards(cards){
  return cards.reduce((sum,c)=>sum+RANK_VALUE(c.r),0);
}

// ---------- Players ----------
function makePlayers(){
  const youName = localStorage.getItem("crr_name") || "You";
  const names = ["Alice","Mike","John","Med","Lisa","Zara","Omar","Tara","Nina"];
  const bots = [];
  let used = new Set([youName.toLowerCase()]);
  for (let i=0;i<BOT_COUNT;i++){
    let n = names.find(x=>!used.has(x.toLowerCase())) || `Bot${i+1}`;
    used.add(n.toLowerCase());
    bots.push({ uid: `bot_${i}`, name: n, bot:true });
  }
  return [
    { uid:"me", name: youName, bot:false },
    ...bots
  ].map(p=>({
    ...p,
    hand: [],
    melds: [],
    score: 0,
  }));
}

function curPlayer(){ return state.players[state.turnIndex]; }
function mePlayer(){ return state.players.find(p=>p.uid==="me"); }
function isMyTurn(){ return curPlayer().uid === "me"; }

// ---------- Deal ----------
function deal(){
  state.dealerIndex = Math.floor(Math.random()*state.players.length);
  const nextIndex = (state.dealerIndex + 1) % state.players.length;

  for (const p of state.players){
    p.hand = [];
    p.melds = [];
  }

  // 7 each; next to dealer gets 8
  for (let i=0;i<state.players.length;i++){
    const count = (i===nextIndex) ? 8 : 7;
    for (let k=0;k<count;k++){
      state.players[i].hand.push(state.deck.pop());
    }
  }

  // unwanted starts with 1
  state.unwanted = [state.deck.pop()];
  state.peekOpen = false;
  state.peekIndex = state.unwanted.length-1;

  state.turnIndex = nextIndex;
  state.phase = "DRAW";
  state.selectedIds.clear();
  state.lastDrawnId = null;

  // rule reset per round
  state.laidMeldThisRound = new Set();

  state.turnMsLeft = 60000;
  state._chimed30 = false;
  state._chimed15 = false;
}

// ---------- Render Scheduling (NO LOOP) ----------
function canRenderNow(){
  // If user is dragging any horizontal scroller, do not re-render (prevents fighting)
  return !(state.dragging.hand || state.dragging.peek || state.dragging.seats || state.dragging.melds);
}

function requestRender(){
  state.needsRender = true;
  if (state.renderQueued) return;
  state.renderQueued = true;

  requestAnimationFrame(()=>{
    state.renderQueued = false;
    if (!state.needsRender) return;
    if (!canRenderNow()){
      // wait until user stops dragging
      requestRender();
      return;
    }
    state.needsRender = false;
    renderGame();
  });
}

// ---------- Timer ----------
function stopTimer(){
  if (state.timerId){
    clearInterval(state.timerId);
    state.timerId = null;
  }
}

function softChime(times){
  try{
    const ctx = softChime._ctx || (softChime._ctx = new (window.AudioContext||window.webkitAudioContext)());
    const t0 = ctx.currentTime + 0.02;
    for (let i=0;i<times;i++){
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(660, t0 + i*0.12);
      g.gain.setValueAtTime(0.0001, t0 + i*0.12);
      g.gain.exponentialRampToValueAtTime(0.03, t0 + i*0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i*0.12 + 0.18);
      o.connect(g); g.connect(ctx.destination);
      o.start(t0 + i*0.12);
      o.stop(t0 + i*0.12 + 0.19);
    }
  }catch{}
}

function startTimer(){
  stopTimer();
  const start = now();
  const startLeft = state.turnMsLeft;

  state.timerId = setInterval(()=>{
    const elapsed = now() - start;
    state.turnMsLeft = clamp(startLeft - elapsed, 0, 60000);

    if (state.turnMsLeft <= 30000 && !state._chimed30){
      state._chimed30 = true; softChime(1);
    }
    if (state.turnMsLeft <= 15000 && !state._chimed15){
      state._chimed15 = true; softChime(2);
    }

    if (state.turnMsLeft === 0){
      onTimeout();
      return;
    }

    // Timer text update (safe: small render, but we still use requestRender)
    requestRender();
  }, 250);
}

function onTimeout(){
  stopTimer();
  const p = curPlayer();
  if (state.phase === "DRAW"){
    autoDrawFromDeck(p);
  }
  if (state.phase !== "DRAW"){
    autoRandomDiscard(p);
  }
  endTurn();
}

// ---------- Actions ----------
function autoDrawFromDeck(p){
  if (!state.deck.length) return;
  const c = state.deck.pop();
  state.lastDrawnId = c.id;
  p.hand.unshift(c);           // FRONT
  state.phase = "MELD";
}

function autoRandomDiscard(p){
  if (!p.hand.length) return;
  const idx = Math.floor(Math.random()*p.hand.length);
  const [c] = p.hand.splice(idx,1);
  state.unwanted.push(c);
  state.peekIndex = state.unwanted.length-1;
  state.peekOpen = false;
}

function drawFromDeck(){
  if (!isMyTurn()) return;
  if (state.phase !== "DRAW") return;
  if (!state.deck.length) return;

  const me = mePlayer();
  const c = state.deck.pop();
  state.lastDrawnId = c.id;
  me.hand.unshift(c);          // FRONT
  state.phase = "MELD";

  requestRender();

  // remove highlight after short time without re-render spam
  setTimeout(()=>{
    state.lastDrawnId = null;
    requestRender();
  }, 650);
}

function takeUnwantedTop(){
  if (!isMyTurn()) return;
  if (state.phase !== "DRAW") return;
  const me = mePlayer();
  if (!state.unwanted.length) return;

  const c = state.unwanted.pop();
  state.lastDrawnId = c.id;
  me.hand.unshift(c);
  state.peekIndex = state.unwanted.length-1;
  state.peekOpen = false;
  state.phase = "MELD";

  requestRender();
  setTimeout(()=>{ state.lastDrawnId=null; requestRender(); }, 650);
}

function takeUnwantedAll(){
  if (!isMyTurn()) return;
  if (state.phase !== "DRAW") return;
  const me = mePlayer();
  if (!state.unwanted.length) return;

  const pile = state.unwanted.splice(0, state.unwanted.length);
  for (let i=pile.length-1;i>=0;i--) me.hand.unshift(pile[i]);

  state.peekIndex = -1;
  state.peekOpen = false;
  state.phase = "MELD";

  requestRender();
}

function toggleSelect(cardId){
  if (!isMyTurn()) return;
  const me = mePlayer();
  if (!me.hand.some(c=>c.id===cardId)) return;

  if (state.selectedIds.has(cardId)) state.selectedIds.delete(cardId);
  else state.selectedIds.add(cardId);

  requestRender();
}

function getSelectedCardsFromHand(){
  const me = mePlayer();
  const ids = [...state.selectedIds];
  return ids.map(id=>me.hand.find(c=>c.id===id)).filter(Boolean);
}

function layMeld(){
  if (!isMyTurn()) return;
  if (state.phase === "DRAW") return;

  const me = mePlayer();
  const cards = getSelectedCardsFromHand();
  const v = validateMeld(cards);
  if (!v.ok) { alert(v.reason); return; }

  const ids = new Set(cards.map(c=>c.id));
  me.hand = me.hand.filter(c=>!ids.has(c.id));
  me.melds.push(cards);

  // mark rule unlocked for the rest of this round
  state.laidMeldThisRound.add(me.uid);

  state.selectedIds.clear();
  requestRender();
}

function discardSelected(){
  if (!isMyTurn()) return;
  if (state.phase === "DRAW") return;

  const me = mePlayer();
  if (state.selectedIds.size !== 1){
    alert("Select exactly 1 card to discard.");
    return;
  }
  const id = [...state.selectedIds][0];
  const idx = me.hand.findIndex(c=>c.id===id);
  if (idx<0) return;

  const [c] = me.hand.splice(idx,1);
  state.unwanted.push(c);
  state.peekIndex = state.unwanted.length-1;
  state.peekOpen = false;
  state.selectedIds.clear();

  // win only after discard
  if (me.hand.length===0){
    endRound(me.uid);
    return;
  }

  endTurn();
}

function endTurn(){
  state.selectedIds.clear();
  state.phase = "DRAW";
  state.turnIndex = (state.turnIndex + 1) % state.players.length;
  state.turnMsLeft = 60000;
  state._chimed30 = false;
  state._chimed15 = false;

  startTimer();
  requestRender();

  if (curPlayer().bot){
    setTimeout(()=>botAct(), 350);
  }
}

// ---------- Round End / Scoring ----------
function endRound(winnerUid){
  stopTimer();
  const winner = state.players.find(p=>p.uid===winnerUid);

  const winnerLaid = winner.melds.flat();
  winner.score += pointsOfCards(winnerLaid);

  for (const p of state.players){
    if (p.uid === winnerUid) continue;

    const laid = p.melds.flat();
    const laidTotal = pointsOfCards(laid);

    // cancellation tokens (10s and 5s)
    let laidTokens = laid.map(c=>RANK_VALUE(c.r));
    const handVals = p.hand.map(c=>RANK_VALUE(c.r));

    for (const hv of handVals){
      if (hv===10){
        const idx10 = laidTokens.indexOf(10);
        if (idx10>=0) { laidTokens.splice(idx10,1); continue; }
        const i5a = laidTokens.indexOf(5);
        if (i5a>=0){
          laidTokens.splice(i5a,1);
          const i5b = laidTokens.indexOf(5);
          if (i5b>=0) laidTokens.splice(i5b,1);
          continue;
        }
      }else{
        const idx5 = laidTokens.indexOf(5);
        if (idx5>=0){ laidTokens.splice(idx5,1); continue; }
      }
    }

    const remainingLaidTotal = laidTokens.reduce((a,b)=>a+b,0);
    const cancelledValue = laidTotal - remainingLaidTotal;

    const handTotal = pointsOfCards(p.hand);
    const uncancelled = Math.max(0, handTotal - cancelledValue);

    p.score -= uncancelled;
  }

  alert(`${winner.name} won the round!`);
  startNewRound();
}

function startNewRound(){
  state.deck = makeDeck();
  deal();
  startTimer();
  requestRender();

  if (curPlayer().bot){
    setTimeout(()=>botAct(), 350);
  }
}

// ---------- Bots ----------
function botAct(){
  const p = curPlayer();
  if (!p.bot) return;

  if (state.phase === "DRAW"){
    botDraw(p);
    requestRender();
    setTimeout(()=>botMeldDiscard(p), 450);
    return;
  }

  botMeldDiscard(p);
}

function botWouldUseCard(p, card){
  const sameRankCount = p.hand.filter(x=>x.r===card.r).length;
  if (sameRankCount>=2) return true;

  const sameSuitIdx = p.hand.filter(x=>x.s===card.s).map(x=>rankIndex(x.r));
  const r = rankIndex(card.r);
  if (sameSuitIdx.includes(r-1) || sameSuitIdx.includes(r+1)) return true;

  return BOT_DIFFICULTY==="goat" && Math.random()<0.35;
}

function botDraw(p){
  const top = state.unwanted[state.unwanted.length-1];
  const shouldTakeTop = top && botWouldUseCard(p, top);

  if ((BOT_DIFFICULTY==="pro"||BOT_DIFFICULTY==="goat") && shouldTakeTop && Math.random()<0.7){
    const c = state.unwanted.pop();
    p.hand.unshift(c);
    state.phase = "MELD";
    state.peekIndex = state.unwanted.length-1;
    state.peekOpen = false;
    return;
  }
  autoDrawFromDeck(p);
}

function removeFromHand(p, cards){
  const ids = new Set(cards.map(c=>c.id));
  p.hand = p.hand.filter(c=>!ids.has(c.id));
}

function botTryLayMeld(p){
  // sets
  const byRank = new Map();
  for (const c of p.hand){
    if (!byRank.has(c.r)) byRank.set(c.r, []);
    byRank.get(c.r).push(c);
  }
  for (const arr of byRank.values()){
    if (arr.length>=3){
      const meld = arr.slice(0, Math.min(4, arr.length));
      removeFromHand(p, meld);
      p.melds.push(meld);
      state.laidMeldThisRound.add(p.uid);
      return true;
    }
  }

  // runs
  const bySuit = new Map();
  for (const c of p.hand){
    if (!bySuit.has(c.s)) bySuit.set(c.s, []);
    bySuit.get(c.s).push(c);
  }
  for (const arr of bySuit.values()){
    const sorted = arr.slice().sort((a,b)=>rankIndex(a.r)-rankIndex(b.r));
    for (let i=0;i<=sorted.length-3;i++){
      const win = [sorted[i], sorted[i+1], sorted[i+2]];
      if (isValidRun(win)){
        removeFromHand(p, win);
        p.melds.push(win);
        state.laidMeldThisRound.add(p.uid);
        return true;
      }
    }
    const hasQ = arr.find(c=>c.r==="Q");
    const hasK = arr.find(c=>c.r==="K");
    const hasA = arr.find(c=>c.r==="A");
    if (hasQ && hasK && hasA){
      const win = [hasQ,hasK,hasA];
      removeFromHand(p, win);
      p.melds.push(win);
      state.laidMeldThisRound.add(p.uid);
      return true;
    }
  }
  return false;
}

function botDiscard(p){
  let idx = 0;
  let bestScore = -Infinity;

  for (let i=0;i<p.hand.length;i++){
    const c = p.hand[i];
    let keep = 0;
    keep += (p.hand.filter(x=>x.r===c.r).length>=2) ? 3 : 0;

    const suitIdx = p.hand.filter(x=>x.s===c.s).map(x=>rankIndex(x.r));
    const r = rankIndex(c.r);
    if (suitIdx.includes(r-1) || suitIdx.includes(r+1)) keep += 2;

    const score = RANK_VALUE(c.r) - keep*3;
    if (score > bestScore){ bestScore = score; idx = i; }
  }

  const [c] = p.hand.splice(idx,1);
  state.unwanted.push(c);
  state.peekIndex = state.unwanted.length-1;
  state.peekOpen = false;

  if (p.hand.length===0){
    endRound(p.uid);
    return;
  }
  endTurn();
}

function botMeldDiscard(p){
  if (state.phase === "MELD"){
    botTryLayMeld(p);
    botDiscard(p);
  }
}

// ---------- UI Helpers ----------
function formatMs(ms){
  const s = Math.ceil(ms/1000);
  return `${s}s`;
}

function cardHTML(c, {selectable=false, selected=false} = {}){
  const cls = ["card", SUIT_COLOR(c.s)];
  if (selected) cls.push("sel");
  const attr = selectable ? `data-card="${c.id}"` : "";
  return `
    <div class="${cls.join(" ")}" ${attr}>
      <div class="corner tl">${escapeHtml(c.r)}<br>${escapeHtml(c.s)}</div>
      <div class="pip">${escapeHtml(c.s)}</div>
      <div class="corner br">${escapeHtml(c.r)}<br>${escapeHtml(c.s)}</div>
    </div>
  `;
}

function renderGame(){
  const me = mePlayer();
  const cur = curPlayer();
  const others = state.players.filter(p=>p.uid!=="me");

  // preserve current scroll positions if elements exist
  const handEl = document.getElementById("hand");
  if (handEl) state.handScrollLeft = handEl.scrollLeft;
  const peekEl = document.getElementById("peekStrip");
  if (peekEl) state.peekScrollLeft = peekEl.scrollLeft;

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
            <b>${cur.uid==="me" ? "YOUR TURN" : `${escapeHtml(cur.name)}'s Turn`}</b>
            <div class="muted">Phase: ${escapeHtml(state.phase)} — Draw → (Lay/Add) → Discard 1</div>
          </div>
          <div style="font-weight:900; font-size:18px;">
            ${state.turnMsLeft<=15000 ? `<span class="danger">${formatMs(state.turnMsLeft)}</span>` : formatMs(state.turnMsLeft)}
          </div>
        </div>

        <div class="panel gameMain">

          <div class="seatRow" id="seatRow">
            ${others.map(p=>{
              const active = (p.uid===cur.uid) ? "activeTurn" : "";
              const unlocked = state.laidMeldThisRound.has(p.uid);
              return `
                <div class="seatBox ${active}" data-seat="${p.uid}">
                  <div><b>${escapeHtml(p.name)}</b></div>
                  <div class="small">Cards left: ${p.hand.length}</div>
                  <div class="small">Score: ${p.score}</div>
                  <div class="small">${unlocked ? "Add-to-meld unlocked ✅" : "Must lay 1 meld first ⛔"}</div>
                </div>
              `;
            }).join("")}
          </div>

          <div class="centerRow">

            <div class="pileBox unwantedBig">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <b>Unwanted</b>
                <span class="small">${state.unwanted.length} cards</span>
              </div>

              <div class="unwantedTopTap" id="unwantedTopTap" ${state.unwanted.length?``:`style="opacity:.6"`}>
                <span class="small">Top</span>
                <b>${state.unwanted.length ? escapeHtml(cardLabel(state.unwanted[state.unwanted.length-1])) : "Empty"}</b>
                <span class="small">(tap to peek)</span>
              </div>

              <div class="peekWrap">
                <div class="peekStrip" id="peekStrip" style="display:${state.peekOpen ? "flex":"none"}">
                  ${state.unwanted.map((c, i)=>{
                    const active = (i===state.peekIndex) ? "active" : "";
                    return `<div class="peekCard ${active}" data-peek="${i}">${cardHTML(c)}</div>`;
                  }).join("")}
                </div>
              </div>

              <div class="btnRow" style="margin-top:10px;">
                <button class="btn cyan" id="takeTop" ${(!isMyTurn()||state.phase!=="DRAW"||!state.unwanted.length)?"disabled":""}>Take Top</button>
                <button class="btn" id="takeAll" ${(!isMyTurn()||state.phase!=="DRAW"||!state.unwanted.length)?"disabled":""}>Take ALL</button>
              </div>
            </div>

            <div class="pileBox deckSmall">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <b>Deck</b>
                <span class="small">${state.deck.length} left</span>
              </div>

              <div class="deckStack" id="deckTap" title="Tap to draw 1">
                <div class="back"></div>
                <div class="label">TAP</div>
              </div>
              <div class="hint">Tap to draw 1</div>
            </div>

          </div>

          <div class="meldTray" id="meldTray">
            <div class="meldTrayHead">
              <b>Your melds</b>
              <span class="small">${state.laidMeldThisRound.has("me") ? "Add-to-meld unlocked ✅" : "Lay 1 meld first ⛔"}</span>
            </div>
            <div class="meldTrayBody" id="meldTrayBody">
              ${me.melds.length ? me.melds.map((meld, idx)=>`
                <div class="meldBlock">
                  <div class="small">Meld ${idx+1}</div>
                  <div style="display:flex; gap:8px; margin-top:8px;">
                    ${meld.map(c=>cardHTML(c)).join("")}
                  </div>
                </div>
              `).join("") : `<div class="small">No melds yet…</div>`}
            </div>
          </div>

        </div>

        <div class="handBar">
          <div class="handHead">
            <div>
              <b>Your hand</b>
              <div class="small">Slide left/right to view cards</div>
            </div>
            <div class="small">Score: <b>${me.score}</b></div>
          </div>

          <div id="hand">
            ${me.hand.map(c=>{
              const selected = state.selectedIds.has(c.id) || c.id===state.lastDrawnId;
              return cardHTML(c,{selectable:true, selected});
            }).join("")}
          </div>

          <div class="btnRow">
            <button class="btn cyan" id="layMeld" ${(!isMyTurn()||state.phase==="DRAW")?"disabled":""}>Lay Meld</button>
            <button class="btn" id="discard" ${(!isMyTurn()||state.phase==="DRAW")?"disabled":""}>Discard (1)</button>
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
              ${state.modal.melds.length ? state.modal.melds.map((meld, idx)=>`
                <div class="item" style="margin-bottom:10px;">
                  <div class="small">Meld ${idx+1}</div>
                  <div style="display:flex; gap:10px; margin-top:8px; flex-wrap:wrap;">
                    ${meld.map(c=>cardHTML(c)).join("")}
                  </div>
                </div>
              `).join("") : `<div class="small">No melds yet.</div>`}
            </div>
          </div>
        `:""}

      </div>
    </div>
  `;

  // restore scroll positions (no fighting because we block render during drag)
  const hand = document.getElementById("hand");
  if (hand) hand.scrollLeft = state.handScrollLeft;
  const peek = document.getElementById("peekStrip");
  if (peek) peek.scrollLeft = state.peekScrollLeft;
}

// ---------- Interaction (Event Delegation + Drag Lock) ----------
function setDragging(which, v){
  state.dragging[which] = v;
  if (!v) requestRender(); // when user releases, render any pending changes
}

function bindGlobalHandlers(){
  // Deck draw
  app.addEventListener("click", (e)=>{
    const t = e.target.closest("#deckTap");
    if (t) { drawFromDeck(); return; }

    const topTap = e.target.closest("#unwantedTopTap");
    if (topTap){
      if (!state.unwanted.length) return;
      state.peekOpen = !state.peekOpen;
      state.peekIndex = state.unwanted.length - 1;
      requestRender();
      // after open, scroll to end (show top at right)
      setTimeout(()=>{
        const strip = document.getElementById("peekStrip");
        if (strip && state.peekOpen){
          strip.scrollLeft = strip.scrollWidth;
          state.peekScrollLeft = strip.scrollLeft;
        }
      }, 0);
      return;
    }

    const btnTop = e.target.closest("#takeTop");
    if (btnTop) { takeUnwantedTop(); return; }

    const btnAll = e.target.closest("#takeAll");
    if (btnAll) { takeUnwantedAll(); return; }

    const lay = e.target.closest("#layMeld");
    if (lay) { layMeld(); return; }

    const disc = e.target.closest("#discard");
    if (disc) { discardSelected(); return; }

    const exit = e.target.closest("#exitBtn");
    if (exit){
      if (confirm("Exit practice mode?")) location.href = "./index.html";
      return;
    }

    const close = e.target.closest("#closeModal");
    if (close){
      state.modal = null;
      requestRender();
      return;
    }

    const modalBg = e.target.closest("#modalBg");
    if (modalBg && e.target.id==="modalBg"){
      state.modal = null;
      requestRender();
      return;
    }

    const seat = e.target.closest("[data-seat]");
    if (seat){
      const u = seat.getAttribute("data-seat");
      const p = state.players.find(x=>x.uid===u);
      if (!p) return;
      state.modal = { title: `${p.name}'s melds`, melds: p.melds };
      requestRender();
      return;
    }

    const peekCard = e.target.closest("[data-peek]");
    if (peekCard){
      state.peekIndex = parseInt(peekCard.getAttribute("data-peek"),10);
      requestRender();
      return;
    }

    const card = e.target.closest("[data-card]");
    if (card){
      toggleSelect(card.getAttribute("data-card"));
      return;
    }
  }, { passive:true });

  // Drag locking for smooth horizontal scroll
  function bindDragLock(elId, key){
    app.addEventListener("pointerdown", (e)=>{
      const el = document.getElementById(elId);
      if (!el) return;
      if (!el.contains(e.target)) return;
      setDragging(key, true);
    }, { passive:true });

    window.addEventListener("pointerup", ()=>{
      if (state.dragging[key]) setDragging(key, false);
    }, { passive:true });

    window.addEventListener("pointercancel", ()=>{
      if (state.dragging[key]) setDragging(key, false);
    }, { passive:true });

    window.addEventListener("touchend", ()=>{
      if (state.dragging[key]) setDragging(key, false);
    }, { passive:true });
  }

  bindDragLock("hand", "hand");
  bindDragLock("peekStrip", "peek");
  bindDragLock("seatRow", "seats");
  bindDragLock("meldTrayBody", "melds");

  // Track scroll positions without forcing re-render
  app.addEventListener("scroll", (e)=>{
    const hand = document.getElementById("hand");
    if (hand && e.target===hand) state.handScrollLeft = hand.scrollLeft;

    const peek = document.getElementById("peekStrip");
    if (peek && e.target===peek) state.peekScrollLeft = peek.scrollLeft;
  }, { passive:true, capture:true });
}

// ---------- Boot ----------
function boot(){
  state.players = makePlayers();
  state.deck = makeDeck();
  deal();
  renderGame();
  bindGlobalHandlers();
  startTimer();

  if (curPlayer().bot){
    setTimeout(()=>botAct(), 350);
  }
}

boot();