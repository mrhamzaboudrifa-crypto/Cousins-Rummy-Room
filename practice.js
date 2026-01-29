/* Cousins Rummy Room — PRACTICE MODE (Bots)
   FIXED:
   ✅ Smooth sliders (no “fighting finger”) via drag-to-scroll
   ✅ Tap still works (tap selects cards, drag scrolls)
   ✅ Unwanted top card opens instantly
   ✅ Unwanted bigger, deck smaller (CSS handles size)
   ✅ Drawn card goes to FRONT + highlights
   ✅ Sort button groups potential melds
*/

const app = document.getElementById("app");

// ---------- Utilities ----------
const SUITS = ["♠","♥","♦","♣"];
const SUIT_COLOR = (s) => (s==="♥"||s==="♦") ? "red" : "black";
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const rankIndex = (r)=>RANKS.indexOf(r);
const RANK_VALUE = (r)=> (r==="A"||r==="10"||r==="J"||r==="Q"||r==="K") ? 10 : 5;

const now = ()=>Date.now();
const clamp = (n,a,b)=>Math.max(a,Math.min(b,n));
const escapeHtml = (s)=>(s||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const uid = ()=>Math.random().toString(36).slice(2,10);

function parseParams(){
  const p = new URLSearchParams(location.search);
  const bots = clamp(parseInt(p.get("bots")||"1",10), 1, 3);
  const difficulty = (p.get("difficulty")||"easy").toLowerCase();
  return {
    bots,
    difficulty: ["easy","mid","pro","goat"].includes(difficulty)?difficulty:"easy"
  };
}

function pointsOfCards(cards){
  return cards.reduce((sum,c)=>sum+RANK_VALUE(c.r),0);
}

function cardLabel(c){ return `${c.r}${c.s}`; }

// ---------- Smooth drag-to-scroll (fix “fighting finger”) ----------
function enableDragScroll(el, {allowClick=true} = {}){
  if (!el) return;

  let down = false;
  let startX = 0;
  let startScroll = 0;
  let moved = false;

  // IMPORTANT: stop browser from hijacking horizontal pan
  el.style.touchAction = "pan-x";

  const onDown = (e)=>{
    down = true;
    moved = false;
    startX = (e.touches ? e.touches[0].clientX : e.clientX);
    startScroll = el.scrollLeft;
  };

  const onMove = (e)=>{
    if (!down) return;
    const x = (e.touches ? e.touches[0].clientX : e.clientX);
    const dx = x - startX;

    if (Math.abs(dx) > 3) moved = true;

    // prevent page scroll from stealing it
    if (e.cancelable) e.preventDefault();

    el.scrollLeft = startScroll - dx;
  };

  const onUp = ()=>{
    down = false;
    // if we moved, prevent click selection “ghost taps”
    if (moved && !allowClick){
      // nothing
    }
  };

  el.addEventListener("touchstart", onDown, {passive:true});
  el.addEventListener("touchmove", onMove, {passive:false});
  el.addEventListener("touchend", onUp, {passive:true});

  el.addEventListener("mousedown", onDown);
  el.addEventListener("mousemove", onMove);
  el.addEventListener("mouseup", onUp);
  el.addEventListener("mouseleave", onUp);

  // suppress click if drag happened (this is the magic)
  if (allowClick){
    el.addEventListener("click", (e)=>{
      if (!moved) return;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }
}

// ---------- Game State ----------
const state = {
  players: [],
  deck: [],
  unwanted: [],
  peekOpen: false,
  peekIndex: 0,

  selectedIds: new Set(),
  lastDrawnId: null,

  dealerIndex: 0,
  turnIndex: 0,
  phase: "DRAW", // DRAW -> MELD -> discard
  laidMeldThisTurn: false,

  turnMsLeft: 60000,
  turnTimer: null,
  uiNeedsRender: true,

  modal: null // {title, melds}
};

const { bots: BOT_COUNT, difficulty: BOT_DIFFICULTY } = parseParams();

// ---------- Deck ----------
function makeDeck(){
  const d = [];
  for (const s of SUITS){
    for (const r of RANKS){
      d.push({ id: uid(), r, s });
    }
  }
  for (let i=d.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// ---------- Meld validation ----------
function isValidSet(cards){
  if (cards.length < 3) return false;
  const r = cards[0].r;
  return cards.every(c=>c.r===r);
}

function isValidRun(cards){
  if (cards.length < 3) return false;
  const suit = cards[0].s;
  if (!cards.every(c=>c.s===suit)) return false;

  const idx = cards.map(c=>rankIndex(c.r)).sort((a,b)=>a-b);
  const consecutiveLow = idx.every((v,i)=> i===0 || v===idx[i-1]+1);
  if (consecutiveLow) return true;

  if (!cards.some(c=>c.r==="A")) return false;
  const idxHigh = cards.map(c=> (c.r==="A"?13:rankIndex(c.r)) ).sort((a,b)=>a-b);
  return idxHigh.every((v,i)=> i===0 || v===idxHigh[i-1]+1);
}

function validateMeld(cards){
  if (cards.length < 3) return { ok:false, reason:"Meld must be 3+ cards." };
  if (isValidSet(cards)) return { ok:true, type:"set" };
  if (isValidRun(cards)) return { ok:true, type:"run" };
  return { ok:false, reason:"Not a valid set or run." };
}

// ---------- Players ----------
function makePlayers(){
  const youName = localStorage.getItem("crr_name") || "You";
  const names = ["Alice","Mike","John","Med","Lisa","Zara","Omar","Tara","Nina"];

  const bots = [];
  for (let i=0;i<BOT_COUNT;i++){
    bots.push({ uid:`bot_${i}`, name:names[i] || `Bot${i+1}`, bot:true });
  }

  return [{ uid:"me", name:youName, bot:false }, ...bots].map(p=>({
    ...p,
    hand: [],
    melds: [],
    score: 0,
    mustLayMeldFirst: true
  }));
}

function mePlayer(){ return state.players.find(p=>p.uid==="me"); }
function curPlayer(){ return state.players[state.turnIndex]; }
function isMyTurn(){ return curPlayer().uid==="me"; }

function requestRender(){ state.uiNeedsRender = true; }

// ---------- Deal ----------
function deal(){
  state.dealerIndex = Math.floor(Math.random()*state.players.length);
  const nextIndex = (state.dealerIndex + 1) % state.players.length;

  for (let i=0;i<state.players.length;i++){
    const count = (i===nextIndex) ? 8 : 7;
    for (let k=0;k<count;k++){
      state.players[i].hand.push(state.deck.pop());
    }
  }

  state.unwanted.push(state.deck.pop());
  state.peekOpen = false;
  state.peekIndex = state.unwanted.length-1;

  state.turnIndex = nextIndex;
  state.phase = "DRAW";
  state.selectedIds.clear();
  state.laidMeldThisTurn = false;

  state.turnMsLeft = 60000;
}

// ---------- Turn timer ----------
function stopTurnTimer(){
  if (state.turnTimer){
    clearInterval(state.turnTimer);
    state.turnTimer = null;
  }
}
function startTurnTimer(){
  stopTurnTimer();
  const start = now();
  const startLeft = state.turnMsLeft;

  state.turnTimer = setInterval(()=>{
    const elapsed = now()-start;
    state.turnMsLeft = clamp(startLeft - elapsed, 0, 60000);
    if (state.turnMsLeft===0){
      onTimeoutAutoMove();
    }
    requestRender();
  }, 250);
}

function nextTurnIndex(){
  return (state.turnIndex + 1) % state.players.length;
}

function endTurn(){
  state.selectedIds.clear();
  state.laidMeldThisTurn = false;
  state.phase = "DRAW";
  state.turnIndex = nextTurnIndex();
  state.turnMsLeft = 60000;
  startTurnTimer();
  requestRender();

  if (curPlayer().bot){
    setTimeout(()=>botAct(), 300);
  }
}

function onTimeoutAutoMove(){
  stopTurnTimer();
  const p = curPlayer();
  if (state.phase==="DRAW") autoDrawFromDeck(p);
  if (state.phase!=="DRAW") autoRandomDiscard(p);
  endTurn();
}

// ---------- Draw / unwanted ----------
function drawFromDeck(){
  if (!isMyTurn() || state.phase!=="DRAW") return;
  const me = mePlayer();
  if (!state.deck.length) return;

  const c = state.deck.pop();
  c._justDrew = true;
  state.lastDrawnId = c.id;

  me.hand.unshift(c); // FRONT
  state.phase = "MELD";
  requestRender();

  setTimeout(()=>{
    for (const x of me.hand) delete x._justDrew;
    state.lastDrawnId = null;
    requestRender();
  }, 900);
}

function takeUnwantedTop(){
  if (!isMyTurn() || state.phase!=="DRAW") return;
  const me = mePlayer();
  if (!state.unwanted.length) return;

  const c = state.unwanted.pop();
  c._justDrew = true;
  state.lastDrawnId = c.id;

  me.hand.unshift(c);
  state.peekIndex = state.unwanted.length-1;
  state.peekOpen = false;
  state.phase = "MELD";
  requestRender();

  setTimeout(()=>{
    for (const x of me.hand) delete x._justDrew;
    state.lastDrawnId = null;
    requestRender();
  }, 900);
}

function takeUnwantedAll(){
  if (!isMyTurn() || state.phase!=="DRAW") return;
  const me = mePlayer();
  if (!state.unwanted.length) return;

  const pile = state.unwanted.splice(0, state.unwanted.length);
  for (let i=pile.length-1;i>=0;i--){
    me.hand.unshift(pile[i]);
  }

  state.peekOpen = false;
  state.peekIndex = -1;
  state.phase = "MELD";
  requestRender();
}

// ---------- Selection ----------
function toggleSelect(cardId){
  if (!isMyTurn()) return;
  const me = mePlayer();
  const card = me.hand.find(c=>c.id===cardId);
  if (!card) return;

  if (state.selectedIds.has(cardId)) state.selectedIds.delete(cardId);
  else state.selectedIds.add(cardId);

  requestRender();
}

function getSelectedCardsFromHand(){
  const me = mePlayer();
  return [...state.selectedIds].map(id=>me.hand.find(c=>c.id===id)).filter(Boolean);
}

// ---------- Meld / discard ----------
function layMeld(){
  if (!isMyTurn() || state.phase==="DRAW") return;
  const me = mePlayer();

  const cards = getSelectedCardsFromHand();
  const v = validateMeld(cards);
  if (!v.ok){ alert(v.reason); return; }

  const ids = new Set(cards.map(c=>c.id));
  me.hand = me.hand.filter(c=>!ids.has(c.id));
  me.melds.push(cards);

  state.laidMeldThisTurn = true;
  me.mustLayMeldFirst = false;

  state.selectedIds.clear();
  requestRender();
}

function discardSelected(){
  if (!isMyTurn() || state.phase==="DRAW") return;
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

  if (me.hand.length===0){
    endRound(me.uid);
    return;
  }

  endTurn();
}

// ---------- End round ----------
function endRound(winnerUid){
  stopTurnTimer();
  const winner = state.players.find(p=>p.uid===winnerUid);

  const winnerLaid = winner.melds.flat();
  winner.score += pointsOfCards(winnerLaid);

  for (const p of state.players){
    if (p.uid===winnerUid) continue;

    const laid = p.melds.flat();
    const laidTotal = pointsOfCards(laid);
    let laidTokens = laid.map(c=>RANK_VALUE(c.r));

    const handVals = p.hand.map(c=>RANK_VALUE(c.r));
    for (const hv of handVals){
      if (hv===10){
        const i10 = laidTokens.indexOf(10);
        if (i10>=0){ laidTokens.splice(i10,1); continue; }
        const i5a = laidTokens.indexOf(5);
        if (i5a>=0){
          laidTokens.splice(i5a,1);
          const i5b = laidTokens.indexOf(5);
          if (i5b>=0) laidTokens.splice(i5b,1);
        }
      } else {
        const i5 = laidTokens.indexOf(5);
        if (i5>=0) laidTokens.splice(i5,1);
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
  for (const p of state.players){
    p.hand = [];
    p.melds = [];
    p.mustLayMeldFirst = true;
  }
  deal();
  startTurnTimer();
  requestRender();

  if (curPlayer().bot){
    setTimeout(()=>botAct(), 350);
  }
}

// ---------- Bot AI (simple) ----------
function autoDrawFromDeck(p){
  if (!state.deck.length) return;
  const c = state.deck.pop();
  p.hand.unshift(c);
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

function botAct(){
  const p = curPlayer();
  if (!p.bot) return;

  if (state.phase==="DRAW"){
    // higher diff sometimes take top if useful
    const top = state.unwanted[state.unwanted.length-1];
    const canTake = top && botWouldUseCard(p, top);
    if ((BOT_DIFFICULTY==="pro"||BOT_DIFFICULTY==="goat") && canTake && Math.random()<0.7){
      const c = state.unwanted.pop();
      p.hand.unshift(c);
      state.phase="MELD";
    } else {
      autoDrawFromDeck(p);
    }

    requestRender();
    setTimeout(()=>botMeldAndDiscard(p), 450);
    return;
  }

  botMeldAndDiscard(p);
}

function botWouldUseCard(p, card){
  const sameRankCount = p.hand.filter(x=>x.r===card.r).length;
  if (sameRankCount>=2) return true;

  const sameSuit = p.hand.filter(x=>x.s===card.s).map(x=>rankIndex(x.r));
  const r = rankIndex(card.r);
  if (sameSuit.includes(r-1) || sameSuit.includes(r+1)) return true;

  return (BOT_DIFFICULTY==="goat" && Math.random()<0.35);
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
      p.mustLayMeldFirst = false;
      state.laidMeldThisTurn = true;
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
      const win = [sorted[i],sorted[i+1],sorted[i+2]];
      if (isValidRun(win)){
        removeFromHand(p, win);
        p.melds.push(win);
        p.mustLayMeldFirst = false;
        state.laidMeldThisTurn = true;
        return true;
      }
    }
  }
  return false;
}

function botDiscard(p){
  let idx = 0;
  let best = -Infinity;
  for (let i=0;i<p.hand.length;i++){
    const c = p.hand[i];
    let keep = 0;
    keep += (p.hand.filter(x=>x.r===c.r).length>=2) ? 3 : 0;
    const suitIdx = p.hand.filter(x=>x.s===c.s).map(x=>rankIndex(x.r));
    const r = rankIndex(c.r);
    if (suitIdx.includes(r-1) || suitIdx.includes(r+1)) keep += 2;

    const score = RANK_VALUE(c.r) - keep*3;
    if (score > best){ best = score; idx = i; }
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

function botMeldAndDiscard(p){
  if (state.phase!=="MELD") return;
  botTryLayMeld(p);
  botDiscard(p);
}

// ---------- Sort helper (groups likely melds) ----------
function sortHandSmart(){
  if (!isMyTurn()) return;
  const me = mePlayer();

  // group by rank (sets)
  const byRank = new Map();
  for (const c of me.hand){
    if (!byRank.has(c.r)) byRank.set(c.r, []);
    byRank.get(c.r).push(c);
  }

  // group by suit then rank (runs)
  const bySuit = new Map();
  for (const c of me.hand){
    if (!bySuit.has(c.s)) bySuit.set(c.s, []);
    bySuit.get(c.s).push(c);
  }

  // Score each card: prefer ones that are near melds
  const score = new Map();
  for (const c of me.hand){
    let s = 0;
    const rGroup = byRank.get(c.r) || [];
    if (rGroup.length>=2) s += 10;
    if (rGroup.length>=3) s += 20;

    const suitGroup = (bySuit.get(c.s) || []).map(x=>rankIndex(x.r));
    const ri = rankIndex(c.r);
    if (suitGroup.includes(ri-1)) s += 6;
    if (suitGroup.includes(ri+1)) s += 6;
    if (suitGroup.includes(ri-2)) s += 2;
    if (suitGroup.includes(ri+2)) s += 2;

    // keep high cards slightly grouped too
    s += RANK_VALUE(c.r)===10 ? 1 : 0;

    score.set(c.id, s);
  }

  me.hand.sort((a,b)=>{
    const sa = score.get(a.id)||0;
    const sb = score.get(b.id)||0;
    if (sb !== sa) return sb - sa;
    // tie: suit then rank
    if (a.s !== b.s) return SUITS.indexOf(a.s) - SUITS.indexOf(b.s);
    return rankIndex(a.r) - rankIndex(b.r);
  });

  requestRender();
}

// ---------- Render ----------
function formatMs(ms){
  const s = Math.ceil(ms/1000);
  return `${s}s`;
}
function isJustDrawn(c){ return c && (c._justDrew || c.id===state.lastDrawnId); }

function cardHTML(c, {selectable=false, selected=false} = {}){
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

function renderGame(){
  const me = mePlayer();
  const cur = curPlayer();
  const others = state.players.filter(p=>p.uid!=="me");

  // IMPORTANT: keep practice layout exactly as you like
  app.innerHTML = `
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
          <div class="muted">Phase: ${escapeHtml(state.phase)} — Draw → (Lay) → Discard 1</div>
        </div>
        <div style="font-weight:900; font-size:18px;">
          ${state.turnMsLeft<=15000 ? `<span class="danger">${formatMs(state.turnMsLeft)}</span>` : formatMs(state.turnMsLeft)}
        </div>
      </div>

      <div class="panel gameMain">

        <div class="seatRow" id="seatRow">
          ${others.map(p=>{
            const active = (p.uid===cur.uid) ? "activeTurn" : "";
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
            <div class="hint">Tap to draw 1</div>
          </div>

          <div class="pileBox">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <b>Unwanted</b>
              <span class="small">${state.unwanted.length} cards</span>
            </div>

            <div class="unwantedTop" id="unwantedTop">
              ${
                state.unwanted.length
                  ? `<div id="unwantedTopCard" style="cursor:pointer;">${cardHTML(state.unwanted[state.unwanted.length-1])}</div>`
                  : `<div class="small" style="margin-top:16px;">Empty</div>`
              }
            </div>
            <div class="hint">${state.unwanted.length ? `Tap the top card to peek the whole pile` : ""}</div>

            <div class="peekWrap">
              <div class="peekStrip" id="peekStrip" style="display:${state.peekOpen ? "flex":"none"}">
                ${state.unwanted.map((c,i)=>{
                  const active = (i===state.peekIndex) ? "active" : "";
                  return `<div class="peekCard ${active}" data-peek="${i}">${cardHTML(c)}</div>`;
                }).join("")}
              </div>
            </div>

            <div class="btnRow" style="margin-top:10px;">
              <button class="btn cyan" id="takeTop" ${(!isMyTurn()||state.phase!=="DRAW"||!state.unwanted.length)?"disabled":""}>Take Top</button>
              <button class="btn" id="takeAll" ${(!isMyTurn()||state.phase!=="DRAW"||!state.unwanted.length)?"disabled":""}>Take All</button>
            </div>
          </div>
        </div>

        <div class="meldTray" id="meldTray">
          <div class="meldTrayHead">
            <b>Your melds</b>
            <span class="small">${me.mustLayMeldFirst ? "Lay 1 meld first ⛔" : "Unlocked ✅"}</span>
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

        <div class="handBar">
          <div class="handHead">
            <div>
              <b>Your hand</b>
              <div class="small">Swipe left/right</div>
            </div>
            <div style="display:flex; gap:8px; align-items:center;">
              <button class="btn" id="sortBtn" style="width:auto; padding:10px 12px;">Sort</button>
              <div class="small">Score: <b>${me.score}</b></div>
            </div>
          </div>

          <div id="hand">
            ${me.hand.map(c=>{
              const selected = state.selectedIds.has(c.id);
              const hi = selected || isJustDrawn(c);
              return cardHTML(c,{selectable:true, selected: hi});
            }).join("")}
          </div>

          <div class="btnRow">
            <button class="btn cyan" id="layMeld" ${(!isMyTurn()||state.phase==="DRAW")?"disabled":""}>Lay Meld</button>
            <button class="btn" id="discard" ${(!isMyTurn()||state.phase==="DRAW")?"disabled":""}>Discard (1)</button>
          </div>
        </div>

      </div>
    </div>
  `;

  // Wire events
  const handEl = document.getElementById("hand");
  enableDragScroll(handEl, {allowClick:true});
  if (handEl){
    handEl.querySelectorAll("[data-card]").forEach(el=>{
      el.addEventListener("click", ()=>toggleSelect(el.getAttribute("data-card")));
    });
  }

  const peekStrip = document.getElementById("peekStrip");
  enableDragScroll(peekStrip, {allowClick:false});
  if (peekStrip){
    peekStrip.querySelectorAll("[data-peek]").forEach(el=>{
      el.addEventListener("click", ()=>{
        state.peekIndex = parseInt(el.getAttribute("data-peek"),10);
        requestRender();
      });
    });
  }

  const seatRow = document.getElementById("seatRow");
  enableDragScroll(seatRow, {allowClick:false});

  const meldTrayBody = document.getElementById("meldTrayBody");
  enableDragScroll(meldTrayBody, {allowClick:false});

  const deckTap = document.getElementById("deckTap");
  if (deckTap) deckTap.addEventListener("click", drawFromDeck);

  const takeTopBtn = document.getElementById("takeTop");
  if (takeTopBtn) takeTopBtn.addEventListener("click", takeUnwantedTop);

  const takeAllBtn = document.getElementById("takeAll");
  if (takeAllBtn) takeAllBtn.addEventListener("click", takeUnwantedAll);

  const layBtn = document.getElementById("layMeld");
  if (layBtn) layBtn.addEventListener("click", layMeld);

  const discBtn = document.getElementById("discard");
  if (discBtn) discBtn.addEventListener("click", discardSelected);

  const sortBtn = document.getElementById("sortBtn");
  if (sortBtn) sortBtn.addEventListener("click", sortHandSmart);

  // Unwanted top card: opens instantly, one tap
  const top = document.getElementById("unwantedTopCard");
  if (top){
    top.addEventListener("click", ()=>{
      state.peekOpen = !state.peekOpen;
      state.peekIndex = state.unwanted.length-1;
      requestRender();
      setTimeout(()=>{
        const strip = document.getElementById("peekStrip");
        if (strip && state.peekOpen) strip.scrollLeft = strip.scrollWidth;
      }, 0);
    }, {passive:true});
  }

  const exitBtn = document.getElementById("exitBtn");
  if (exitBtn){
    exitBtn.addEventListener("click", ()=>{
      if (confirm("Exit practice mode?")) location.href = "./index.html";
    });
  }
}

// ---------- Render loop ----------
function requestRenderLoop(){
  if (!state.uiNeedsRender) return;
  state.uiNeedsRender = false;
  renderGame();
}

// ---------- Boot ----------
function boot(){
  state.players = makePlayers();
  state.deck = makeDeck();
  deal();
  startTurnTimer();
  renderGame();

  setInterval(requestRenderLoop, 60);

  if (curPlayer().bot){
    setTimeout(()=>botAct(), 350);
  }
}

boot();