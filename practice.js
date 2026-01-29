/* Cousins Rummy Room — PRACTICE MODE (Bots)
   Fix: hand slider no longer jumps back on iPhone
   - No constant render loop
   - Render only when needed (rAF)
   - Do NOT force scrollLeft while user is swiping
   - Deck draw goes to FRONT + highlight
*/

const app = document.getElementById("app");

// ---------- Utilities ----------
const SUITS = ["♠","♥","♦","♣"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const SUIT_COLOR = (s) => (s==="♥"||s==="♦") ? "red" : "black";
const uid = ()=>Math.random().toString(36).slice(2,10);
const clamp = (n,a,b)=>Math.max(a,Math.min(b,n));
const escapeHtml = (s)=>(s||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

function parseParams(){
  const p = new URLSearchParams(location.search);
  const bots = clamp(parseInt(p.get("bots")||"1",10), 1, 3);
  const difficulty = (p.get("difficulty")||"easy").toLowerCase();
  return { bots, difficulty: ["easy","mid","pro","goat"].includes(difficulty)?difficulty:"easy" };
}

const { bots: BOT_COUNT, difficulty: BOT_DIFFICULTY } = parseParams();

const RANK_VALUE = (r) => (r==="A"||r==="10"||r==="J"||r==="Q"||r==="K") ? 10 : 5;
const rankIndex = (r)=>RANKS.indexOf(r);

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

function cardLabel(c){ return `${c.r}${c.s}`; }

function isValidSet(cards){
  if (cards.length < 3) return false;
  const r = cards[0].r;
  return cards.every(c=>c.r===r);
}

function isValidRun(cards){
  if (cards.length < 3) return false;
  const suit = cards[0].s;
  if (!cards.every(c=>c.s===suit)) return false;

  // A low normal
  const idx = cards.map(c=>rankIndex(c.r)).sort((a,b)=>a-b);
  const consecutiveLow = idx.every((v,i)=> i===0 || v===idx[i-1]+1);
  if (consecutiveLow) return true;

  // A high (Q K A etc.)
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

// ---------- Game State ----------
const state = {
  players: [],
  deck: [],
  unwanted: [],
  peekOpen: false,
  peekIndex: 0,

  turnIndex: 0,
  phase: "DRAW", // DRAW -> MELD -> DISCARD
  turnMsLeft: 60000,
  turnTimer: null,

  selectedIds: new Set(),
  laidMeldThisTurn: false,
  lastDrawnId: null,

  modal: null,

  // hand scroll stability
  handScrollLeft: 0,
  handInteracting: false,
  handInteractionTimeout: null,

  // render scheduling
  renderQueued: false,
};

function makePlayers(){
  const youName = localStorage.getItem("crr_name") || "You";
  const names = ["Alice","Mike","John","Med","Lisa","Zara","Omar","Tara","Nina"];
  const bots = [];
  for (let i=0;i<BOT_COUNT;i++){
    bots.push({ uid:`bot_${i}`, name:names[i] || `Bot${i+1}`, bot:true });
  }
  return [
    { uid:"me", name:youName, bot:false },
    ...bots
  ].map(p=>({
    ...p,
    hand: [],
    melds: [],
    score: 0,
    mustLayMeldFirst: true, // per round
  }));
}

function curPlayer(){ return state.players[state.turnIndex]; }
function mePlayer(){ return state.players.find(p=>p.uid==="me"); }
function isMyTurn(){ return curPlayer().uid==="me"; }
function nextTurnIndex(){ return (state.turnIndex+1)%state.players.length; }

function scheduleRender(){
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(()=>{
    state.renderQueued = false;
    renderGame();
  });
}

// ---------- Deal ----------
function deal(){
  const dealerIndex = Math.floor(Math.random()*state.players.length);
  state.dealerIndex = dealerIndex;
  const nextIndex = (dealerIndex+1)%state.players.length;

  for (let i=0;i<state.players.length;i++){
    const count = (i===nextIndex) ? 8 : 7;
    for (let k=0;k<count;k++){
      state.players[i].hand.push(state.deck.pop());
    }
  }

  state.unwanted.push(state.deck.pop());
  state.peekIndex = state.unwanted.length-1;
  state.peekOpen = false;

  state.turnIndex = nextIndex;
  state.phase = "DRAW";
  state.selectedIds.clear();
  state.laidMeldThisTurn = false;
  state.turnMsLeft = 60000;
}

// ---------- Timer ----------
function startTurnTimer(){
  stopTurnTimer();
  state.turnTimer = setInterval(()=>{
    state.turnMsLeft = Math.max(0, state.turnMsLeft - 250);
    if (state.turnMsLeft === 0){
      onTimeoutAutoMove();
      return;
    }
    scheduleRender();
  }, 250);
}
function stopTurnTimer(){
  if (state.turnTimer){
    clearInterval(state.turnTimer);
    state.turnTimer = null;
  }
}

function onTimeoutAutoMove(){
  stopTurnTimer();
  const p = curPlayer();
  if (state.phase === "DRAW") autoDrawFromDeck(p);
  if (state.phase !== "DRAW") autoRandomDiscard(p);
  endTurn();
}

function autoDrawFromDeck(p){
  if (!state.deck.length) return;
  const c = state.deck.pop();
  c._justDrew = true;
  state.lastDrawnId = c.id;
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

// ---------- Selection ----------
function toggleSelect(cardId){
  if (!isMyTurn()) return;
  const me = mePlayer();
  if (!me.hand.find(c=>c.id===cardId)) return;

  if (state.selectedIds.has(cardId)) state.selectedIds.delete(cardId);
  else state.selectedIds.add(cardId);

  scheduleRender();
}

function getSelectedCardsFromHand(){
  const me = mePlayer();
  const ids = [...state.selectedIds];
  return ids.map(id=>me.hand.find(c=>c.id===id)).filter(Boolean);
}

// ---------- Actions ----------
function drawFromDeck(){
  if (!isMyTurn()) return;
  if (state.phase !== "DRAW") return;
  const me = mePlayer();
  if (!state.deck.length) return;

  const c = state.deck.pop();
  c._justDrew = true;
  state.lastDrawnId = c.id;

  // ✅ put at FRONT
  me.hand.unshift(c);

  state.phase = "MELD";
  scheduleRender();

  setTimeout(()=>{
    const me = mePlayer();
    if (me) me.hand.forEach(x=>delete x._justDrew);
    state.lastDrawnId = null;
    scheduleRender();
  }, 900);
}

function takeUnwantedTop(){
  if (!isMyTurn()) return;
  if (state.phase !== "DRAW") return;
  const me = mePlayer();
  if (!state.unwanted.length) return;

  const c = state.unwanted.pop();
  c._justDrew = true;
  state.lastDrawnId = c.id;
  me.hand.unshift(c);

  state.peekIndex = state.unwanted.length-1;
  state.peekOpen = false;
  state.phase = "MELD";
  scheduleRender();

  setTimeout(()=>{
    const me = mePlayer();
    if (me) me.hand.forEach(x=>delete x._justDrew);
    state.lastDrawnId = null;
    scheduleRender();
  }, 900);
}

function takeUnwantedAll(){
  if (!isMyTurn()) return;
  if (state.phase !== "DRAW") return;
  const me = mePlayer();
  if (!state.unwanted.length) return;

  const pile = state.unwanted.splice(0);
  // add to FRONT preserving order
  for (let i=pile.length-1;i>=0;i--) me.hand.unshift(pile[i]);

  state.peekIndex = -1;
  state.peekOpen = false;
  state.phase = "MELD";
  scheduleRender();
}

function layMeld(){
  if (!isMyTurn()) return;
  if (state.phase === "DRAW") return;

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
  scheduleRender();
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

  // win after discard
  if (me.hand.length === 0){
    endRound(me.uid);
    return;
  }

  endTurn();
}

function endTurn(){
  state.selectedIds.clear();
  state.laidMeldThisTurn = false;
  state.phase = "DRAW";
  state.turnIndex = nextTurnIndex();
  state.turnMsLeft = 60000;
  startTurnTimer();
  scheduleRender();

  if (curPlayer().bot){
    setTimeout(()=>botAct(), 350);
  }
}

// ---------- Round end ----------
function endRound(winnerUid){
  stopTurnTimer();

  const winner = state.players.find(p=>p.uid===winnerUid);
  const winnerLaid = winner.melds.flat();
  winner.score += pointsOfCards(winnerLaid);

  for (const p of state.players){
    if (p.uid === winnerUid) continue;

    const laid = p.melds.flat();
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
          continue;
        }
      } else {
        const i5 = laidTokens.indexOf(5);
        if (i5>=0){ laidTokens.splice(i5,1); continue; }
      }
    }

    const laidTotal = pointsOfCards(laid);
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
  scheduleRender();

  if (curPlayer().bot){
    setTimeout(()=>botAct(), 350);
  }
}

// ---------- Bot AI (simple) ----------
function botAct(){
  const p = curPlayer();
  if (!p.bot) return;

  if (state.phase === "DRAW"){
    // mostly deck, higher levels take unwanted if helpful
    const top = state.unwanted[state.unwanted.length-1];
    const takeTop = top && botWouldUseCard(p, top);
    if ((BOT_DIFFICULTY==="pro"||BOT_DIFFICULTY==="goat") && takeTop && Math.random()<0.7){
      const c = state.unwanted.pop();
      p.hand.unshift(c);
      state.phase = "MELD";
      state.peekIndex = state.unwanted.length-1;
      state.peekOpen = false;
    } else {
      autoDrawFromDeck(p);
    }
    scheduleRender();
    setTimeout(()=>botDiscard(p), 450);
    return;
  }

  botDiscard(p);
}

function botWouldUseCard(p, card){
  const sameRankCount = p.hand.filter(x=>x.r===card.r).length;
  if (sameRankCount>=2) return true;

  const sameSuit = p.hand.filter(x=>x.s===card.s).map(x=>rankIndex(x.r));
  const r = rankIndex(card.r);
  if (sameSuit.includes(r-1) || sameSuit.includes(r+1)) return true;

  return BOT_DIFFICULTY==="goat" && Math.random()<0.35;
}

function botDiscard(p){
  // discard worst
  let idx = 0, bestScore=-Infinity;
  for (let i=0;i<p.hand.length;i++){
    const c = p.hand[i];
    let keep = 0;
    keep += p.hand.filter(x=>x.r===c.r).length>=2 ? 3 : 0;
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

// ---------- Render ----------
function formatMs(ms){
  const s = Math.ceil(ms/1000);
  return `${s}s`;
}
function isJustDrawn(c){
  return c && (c._justDrew || c.id===state.lastDrawnId);
}

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
  // Save current hand scroll BEFORE rebuilding DOM
  const existingHand = document.getElementById("hand");
  if (existingHand) state.handScrollLeft = existingHand.scrollLeft;

  const me = mePlayer();
  const cur = curPlayer();
  const others = state.players.filter(p=>p.uid!=="me");

  app.innerHTML = `
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
            ${state.unwanted.length ? `Top: <b id="topPeek">${escapeHtml(cardLabel(state.unwanted[state.unwanted.length-1]))}</b> (tap to peek)` : "Empty"}
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
            <button class="btn" id="takeAll" ${(!isMyTurn()||state.phase!=="DRAW"||!state.unwanted.length)?"disabled":""}>Take All</button>
          </div>
        </div>
      </div>

      <div class="meldTray">
        <div class="meldTrayHead">
          <b>Your melds</b>
          <span class="small">${me.mustLayMeldFirst ? "Lay 1 meld first ⛔" : "Add-to-meld unlocked ✅"}</span>
        </div>
        <div class="meldTrayBody">
          ${me.melds.length ? me.melds.map((meld, idx)=>`
            <div class="meldBlock">
              <div class="small">Meld ${idx+1}</div>
              <div style="display:flex; gap:6px; margin-top:6px;">
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
            <div class="small">Select cards to lay meld (3+) or discard 1</div>
          </div>
          <div class="small">Score: <b>${me.score}</b></div>
        </div>

        <div id="hand">
          ${me.hand.map(c=>{
            const selected = state.selectedIds.has(c.id);
            const glow = selected || isJustDrawn(c);
            return cardHTML(c,{selectable:true, selected: glow});
          }).join("")}
        </div>

        <div class="btnRow">
          <button class="btn cyan" id="layMeld" ${(!isMyTurn()||state.phase==="DRAW")?"disabled":""}>Lay Meld</button>
          <button class="btn" id="discard" ${(!isMyTurn()||state.phase==="DRAW")?"disabled":""}>Discard (1)</button>
        </div>
      </div>
    </div>
  `;

  // --- Wire events ---
  const handEl = document.getElementById("hand");
  if (handEl){
    // ✅ only restore scroll when NOT actively swiping
    if (!state.handInteracting) handEl.scrollLeft = state.handScrollLeft;

    const setInteracting = ()=>{
      state.handInteracting = true;
      clearTimeout(state.handInteractionTimeout);
      state.handInteractionTimeout = setTimeout(()=>{
        state.handInteracting = false;
      }, 200);
    };

    handEl.addEventListener("touchstart", setInteracting, {passive:true});
    handEl.addEventListener("touchmove", setInteracting, {passive:true});
    handEl.addEventListener("scroll", ()=>{
      setInteracting();
      state.handScrollLeft = handEl.scrollLeft;
    }, {passive:true});

    handEl.querySelectorAll("[data-card]").forEach(el=>{
      el.onclick = ()=>toggleSelect(el.getAttribute("data-card"));
    });
  }

  const deckTap = document.getElementById("deckTap");
  if (deckTap) deckTap.onclick = drawFromDeck;

  const takeTopBtn = document.getElementById("takeTop");
  if (takeTopBtn) takeTopBtn.onclick = takeUnwantedTop;

  const takeAllBtn = document.getElementById("takeAll");
  if (takeAllBtn) takeAllBtn.onclick = takeUnwantedAll;

  const layBtn = document.getElementById("layMeld");
  if (layBtn) layBtn.onclick = layMeld;

  const discBtn = document.getElementById("discard");
  if (discBtn) discBtn.onclick = discardSelected;

  const topPeek = document.getElementById("topPeek");
  if (topPeek){
    topPeek.style.cursor="pointer";
    topPeek.onclick = ()=>{
      state.peekOpen = !state.peekOpen;
      state.peekIndex = state.unwanted.length-1;
      scheduleRender();
      setTimeout(()=>{
        const strip = document.getElementById("peekStrip");
        if (strip && state.peekOpen) strip.scrollLeft = strip.scrollWidth;
      }, 0);
    };
  }

  const peekStrip = document.getElementById("peekStrip");
  if (peekStrip){
    peekStrip.querySelectorAll("[data-peek]").forEach(el=>{
      el.onclick = ()=>{
        state.peekIndex = parseInt(el.getAttribute("data-peek"),10);
        scheduleRender();
      };
    });
  }

  const exitBtn = document.getElementById("exitBtn");
  if (exitBtn){
    exitBtn.onclick = ()=>{
      if (confirm("Exit practice mode?")) location.href = "./index.html";
    };
  }
}

// ---------- Boot ----------
function boot(){
  state.players = makePlayers();
  state.deck = makeDeck();
  deal();
  startTurnTimer();
  renderGame();

  if (curPlayer().bot){
    setTimeout(()=>botAct(), 350);
  }
}

boot();