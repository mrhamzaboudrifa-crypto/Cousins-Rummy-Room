/* Cousins Rummy Room — PRACTICE MODE (Bots)
   - One-screen mobile layout (no long page scroll)
   - Hand scroll is stable (doesn't jump back)
   - Unwanted pile: shows TOP, tap top to open "peek strip" (scroll cards), can take top or all
   - Deck: tap stack to draw (goes to FRONT + highlight)
   - Melds: compact tray above hand (horizontal); opponents melds via modal
   - Rule: must lay at least 1 meld this round before adding to any meld
*/

const app = document.getElementById("app");

// ---------- Utilities ----------
const SUITS = ["♠","♥","♦","♣"];
const SUIT_COLOR = (s) => (s==="♥"||s==="♦") ? "red" : "black";
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const RANK_VALUE = (r) => {
  // your scoring: 10,J,Q,K,A => 10 points, below => 5
  return (r==="A"||r==="10"||r==="J"||r==="Q"||r==="K") ? 10 : 5;
};
const now = () => Date.now();
const clamp = (n,a,b)=>Math.max(a,Math.min(b,n));
const escapeHtml = (s)=>(s||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const uid = ()=>Math.random().toString(36).slice(2,10);

function parseParams(){
  const p = new URLSearchParams(location.search);
  const bots = clamp(parseInt(p.get("bots")||"1",10), 1, 3);
  const difficulty = (p.get("difficulty")||"easy").toLowerCase();
  return { bots, difficulty: ["easy","mid","pro","goat"].includes(difficulty)?difficulty:"easy" };
}

// ---------- Game State ----------
const state = {
  screen: "game", // no setup screen here; practice jumps straight in
  startedAt: now(),
  uiNeedsRender: true,

  turnIndex: 0,
  turnMsLeft: 60000,
  turnTimer: null,

  deck: [],
  unwanted: [], // discard pile / unwanted pile
  peekIndex: 0, // which card we are "peeking" at
  peekOpen: false,

  // players[0] is YOU
  players: [],
  // selection
  selectedIds: new Set(),
  // to enforce rule: must lay at least 1 meld this round before adding
  laidMeldThisTurn: false,

  // for stable hand scroll
  handScrollLeft: 0,

  // highlight new draw
  lastDrawnId: null,

  // modal for opponent melds
  modal: null, // {title, melds}
};

const { bots: BOT_COUNT, difficulty: BOT_DIFFICULTY } = parseParams();

// ---------- Cards / Deck ----------
function makeDeck(){
  const deck = [];
  // No jokers
  for (const s of SUITS){
    for (const r of RANKS){
      deck.push({ id: uid(), r, s });
    }
  }
  // shuffle
  for (let i=deck.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardLabel(c){
  return `${c.r}${c.s}`;
}

function isSameRank(a,b){ return a.r===b.r; }
function isSameSuit(a,b){ return a.s===b.s; }

function rankIndex(r){ return RANKS.indexOf(r); }

// run validation: same suit consecutive; Ace can be low (A-2-3) or high (Q-K-A)
function isValidRun(cards){
  if (cards.length < 3) return false;
  // all same suit
  const suit = cards[0].s;
  if (!cards.every(c=>c.s===suit)) return false;

  // sort by rank index (A as 0)
  const idx = cards.map(c=>rankIndex(c.r)).sort((a,b)=>a-b);

  // normal consecutive (A as low)
  const consecutiveLow = idx.every((v,i)=> i===0 || v===idx[i-1]+1);
  if (consecutiveLow) return true;

  // handle high-A: e.g. Q K A => indices 10,11,0
  // detect if contains A and also contains Q & K or more like J Q K A etc.
  if (!cards.some(c=>c.r==="A")) return false;

  // map A to 13 for high check
  const idxHigh = cards.map(c=> (c.r==="A"?13:rankIndex(c.r)) ).sort((a,b)=>a-b);
  const consecutiveHigh = idxHigh.every((v,i)=> i===0 || v===idxHigh[i-1]+1);
  return consecutiveHigh;
}

function isValidSet(cards){
  if (cards.length < 3) return false;
  const r = cards[0].r;
  return cards.every(c=>c.r===r);
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
  const players = [
    { uid:"me", name: youName, bot:false },
    ...bots
  ].map(p=>({
    ...p,
    hand: [],
    melds: [], // array of arrays of cards
    score: 0,
    mustLayMeldFirst: true, // per round
  }));
  return players;
}

// ---------- Deal (7 cards each, dealer gives next 8) ----------
function deal(){
  // choose dealer = random for practice
  const dealerIndex = Math.floor(Math.random()*state.players.length);
  state.dealerIndex = dealerIndex;

  const nextIndex = (dealerIndex + 1) % state.players.length;

  // everyone gets 7, player next to dealer gets 8
  for (let i=0;i<state.players.length;i++){
    const count = (i===nextIndex) ? 8 : 7;
    for (let k=0;k<count;k++){
      state.players[i].hand.push(state.deck.pop());
    }
  }

  // start unwanted pile with 1 card
  state.unwanted.push(state.deck.pop());
  state.peekIndex = state.unwanted.length - 1;
  state.peekOpen = false;

  // first turn: clockwise from dealer (dealer+1)
  state.turnIndex = nextIndex;
  state.phase = "DRAW"; // must draw before lay/add
  state.selectedIds.clear();
  state.laidMeldThisTurn = false;

  state.turnMsLeft = 60000;
}

// ---------- Turn Timer ----------
function startTurnTimer(){
  stopTurnTimer();
  const start = now();
  const startLeft = state.turnMsLeft;

  state.turnTimer = setInterval(()=>{
    const elapsed = now() - start;
    state.turnMsLeft = clamp(startLeft - elapsed, 0, 60000);
    // audio cues at 30s and 15s remaining (smooth subtle)
    if (state.turnMsLeft <= 30000 && !state._chimed30){
      state._chimed30 = true;
      softChime(1);
    }
    if (state.turnMsLeft <= 15000 && !state._chimed15){
      state._chimed15 = true;
      softChime(2);
    }
    if (state.turnMsLeft === 0){
      onTimeoutAutoMove();
    }
    requestRender();
  }, 250);

  state._chimed30 = false;
  state._chimed15 = false;
}

function stopTurnTimer(){
  if (state.turnTimer){
    clearInterval(state.turnTimer);
    state.turnTimer = null;
  }
}

function softChime(times){
  // very subtle web-audio chime
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

// ---------- Auto-move on timeout ----------
function onTimeoutAutoMove(){
  stopTurnTimer();
  const p = curPlayer();
  // If not drawn yet, auto draw from deck
  if (state.phase === "DRAW"){
    autoDrawFromDeck(p);
  }
  // If drawn but not discarded, random discard
  if (state.phase !== "DRAW"){
    autoRandomDiscard(p);
  }
  endTurn();
}

function autoDrawFromDeck(p){
  if (state.deck.length===0) return;
  const c = state.deck.pop();
  c._justDrew = true;
  state.lastDrawnId = c.id;
  p.hand.unshift(c); // FRONT
  state.phase = "MELD"; // now can lay/add then must discard
}

function autoRandomDiscard(p){
  if (!p.hand.length) return;
  const idx = Math.floor(Math.random()*p.hand.length);
  const [c] = p.hand.splice(idx,1);
  state.unwanted.push(c);
  state.peekIndex = state.unwanted.length-1;
  state.peekOpen = false;
}

// ---------- Core helpers ----------
function curPlayer(){ return state.players[state.turnIndex]; }
function isMyTurn(){ return curPlayer().uid === "me"; }
function mePlayer(){ return state.players.find(x=>x.uid==="me"); }

function requestRender(){
  state.uiNeedsRender = true;
  // keep this extremely light; render loop below
}

function nextTurnIndex(){
  return (state.turnIndex + 1) % state.players.length;
}

function endTurn(){
  // reset per-turn flags
  state.selectedIds.clear();
  state.laidMeldThisTurn = false;
  state.phase = "DRAW";
  // new turn
  state.turnIndex = nextTurnIndex();
  state.turnMsLeft = 60000;
  startTurnTimer();
  requestRender();

  // bots auto-play
  if (curPlayer().bot){
    setTimeout(()=>botAct(), 350);
  }
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
  const sel = [...state.selectedIds];
  return sel.map(id=>me.hand.find(c=>c.id===id)).filter(Boolean);
}

// ---------- Actions ----------
function drawFromDeck(){
  if (!isMyTurn()) return;
  if (state.phase !== "DRAW") return;

  const me = mePlayer();
  if (state.deck.length===0) return;

  const c = state.deck.pop();
  c._justDrew = true;
  state.lastDrawnId = c.id;
  me.hand.unshift(c); // FRONT
  state.phase = "MELD";
  requestRender();

  // clear highlight after short time
  setTimeout(()=>{
    const me = mePlayer();
    if (me) for (const x of me.hand) delete x._justDrew;
    state.lastDrawnId = null;
    requestRender();
  }, 900);
}

function takeUnwantedTop(){
  if (!isMyTurn()) return;
  if (state.phase !== "DRAW") return;
  const me = mePlayer();
  if (!state.unwanted.length) return;

  // take top only, but must put 1 back later (discard still required)
  const c = state.unwanted.pop();
  c._justDrew = true;
  state.lastDrawnId = c.id;
  me.hand.unshift(c);
  state.peekIndex = state.unwanted.length-1;
  state.phase = "MELD";
  state.peekOpen = false;
  requestRender();

  setTimeout(()=>{
    const me = mePlayer();
    if (me) for (const x of me.hand) delete x._justDrew;
    state.lastDrawnId = null;
    requestRender();
  }, 900);
}

function takeUnwantedAll(){
  if (!isMyTurn()) return;
  if (state.phase !== "DRAW") return;
  const me = mePlayer();
  if (!state.unwanted.length) return;

  const pile = state.unwanted.splice(0, state.unwanted.length);
  // add to FRONT in same order (older first), newest last -> but front insertion
  for (let i=pile.length-1;i>=0;i--){
    me.hand.unshift(pile[i]);
  }
  // after taking all, you must discard 1 later
  state.peekIndex = -1;
  state.peekOpen = false;
  state.phase = "MELD";
  requestRender();
}

function layMeld(){
  if (!isMyTurn()) return;
  if (state.phase === "DRAW") return;

  const me = mePlayer();
  const cards = getSelectedCardsFromHand();
  const v = validateMeld(cards);
  if (!v.ok) { alert(v.reason); return; }

  // remove from hand
  const ids = new Set(cards.map(c=>c.id));
  me.hand = me.hand.filter(c=>!ids.has(c.id));

  // add meld
  me.melds.push(cards);

  // rule tracking
  state.laidMeldThisTurn = true;
  me.mustLayMeldFirst = false;

  state.selectedIds.clear();
  requestRender();

  // win check (must discard 1 to win; so only win AFTER discard)
}

function addToSelectedMeld(targetPlayerUid, meldIndex){
  // You can add 1+ cards to any meld, but ONLY if you laid at least 1 meld this round
  if (!isMyTurn()) return;
  if (state.phase === "DRAW") return;

  const me = mePlayer();
  if (me.mustLayMeldFirst && !state.laidMeldThisTurn){
    alert("You must lay at least 1 meld this round before adding to any meld.");
    return;
  }

  const target = state.players.find(p=>p.uid===targetPlayerUid);
  if (!target || !target.melds[meldIndex]) return;

  const selected = getSelectedCardsFromHand();
  if (!selected.length) return;

  // For simplicity: allow adding cards if it still forms valid set/run when appended
  const meld = target.melds[meldIndex].slice();
  const combined = meld.concat(selected);

  const v = validateMeld(combined);
  if (!v.ok){
    alert("Those cards can't be added to that meld.");
    return;
  }

  // remove from hand
  const ids = new Set(selected.map(c=>c.id));
  me.hand = me.hand.filter(c=>!ids.has(c.id));

  // update meld
  target.melds[meldIndex] = combined;

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

  // win condition: must finish by discarding one
  if (me.hand.length === 0){
    endRound(me.uid);
    return;
  }

  endTurn();
}

function endRound(winnerUid){
  stopTurnTimer();

  const winner = state.players.find(p=>p.uid===winnerUid);
  // winner points: only for what they laid down
  const winnerLaid = winner.melds.flat();
  winner.score += pointsOfCards(winnerLaid);

  // losers: cancellation logic described
  for (const p of state.players){
    if (p.uid === winnerUid) continue;

    const laid = p.melds.flat();
    // build list of laid "point tokens": A/10/J/Q/K=10, others=5
    let laidTokens = laid.map(c=>RANK_VALUE(c.r));
    // remove tokens using hand cards values first
    const handVals = p.hand.map(c=>RANK_VALUE(c.r));
    for (const hv of handVals){
      // cancel a matching token if possible, else cancel 5 using two 5? you said:
      // "Q left => use two 3s because they equate to 10 points"
      // We'll cancel by exact values first; if hv=10 and only 5s exist, cancel two 5s.
      if (hv===10){
        const idx10 = laidTokens.indexOf(10);
        if (idx10>=0) { laidTokens.splice(idx10,1); continue; }
        // try cancel two 5s
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
        // if only 10s exist, cancel one 10 with two 5 hand cards doesn't apply here
      }
    }

    // after cancellations, remaining hand values become negative points
    // if cancellations exhausted and hand still has value, those count negative
    // easiest: compute "uncancelled hand total" as (hand total - cancelled value)
    // We cancelled by consuming laidTokens; so cancelled value = laidTotal - remainingLaid
    const laidTotal = pointsOfCards(laid);
    const remainingLaidTotal = laidTokens.reduce((a,b)=>a+b,0);
    const cancelledValue = laidTotal - remainingLaidTotal;

    const handTotal = pointsOfCards(p.hand);
    const uncancelled = Math.max(0, handTotal - cancelledValue);

    p.score -= uncancelled;
  }

  // reset round: new deck, new deal
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

// ---------- Bot AI (simple but tiered) ----------
function botAct(){
  const p = curPlayer();
  if (!p.bot) return;

  // 1) Draw choice: easy mostly from deck; pro+ sometimes take unwanted top/all if helps
  if (state.phase === "DRAW"){
    botDraw(p);
    requestRender();
    setTimeout(()=>botMeldAndDiscard(p), 450);
    return;
  }

  botMeldAndDiscard(p);
}

function botDraw(p){
  const diff = BOT_DIFFICULTY;

  const top = state.unwanted[state.unwanted.length-1];
  const shouldTakeTop = top && botWouldUseCard(p, top, diff);

  if ((diff==="pro"||diff==="goat") && shouldTakeTop && Math.random()<0.7){
    // take top
    const c = state.unwanted.pop();
    p.hand.unshift(c);
    state.phase = "MELD";
    state.peekIndex = state.unwanted.length-1;
    state.peekOpen = false;
    return;
  }

  // default draw deck
  autoDrawFromDeck(p);
}

function botWouldUseCard(p, card, diff){
  // crude heuristic: if it matches any pair for set/run
  const sameRankCount = p.hand.filter(x=>x.r===card.r).length;
  if (sameRankCount>=2) return true;

  const sameSuit = p.hand.filter(x=>x.s===card.s).map(x=>rankIndex(x.r));
  const r = rankIndex(card.r);
  if (sameSuit.includes(r-1) || sameSuit.includes(r+1)) return true;

  // higher diff uses more often
  return diff==="goat" && Math.random()<0.35;
}

function botMeldAndDiscard(p){
  // try to lay at least one meld (bots always try)
  if (state.phase === "MELD"){
    botTryLayMeld(p);
    // after first lay, bot may add 1 card to existing melds if allowed
    if (!p.mustLayMeldFirst){
      botTryAddToMeld(p);
    }
    // then discard random-ish worst
    botDiscard(p);
  }
}

function botTryLayMeld(p){
  // find any set of 3 by rank
  const byRank = new Map();
  for (const c of p.hand){
    if (!byRank.has(c.r)) byRank.set(c.r, []);
    byRank.get(c.r).push(c);
  }
  for (const [r, arr] of byRank){
    if (arr.length>=3){
      const meld = arr.slice(0, Math.min(4, arr.length));
      removeFromHand(p, meld);
      p.melds.push(meld);
      p.mustLayMeldFirst = false;
      state.laidMeldThisTurn = true;
      return;
    }
  }

  // find any run of 3+ (same suit consecutive)
  const bySuit = new Map();
  for (const c of p.hand){
    if (!bySuit.has(c.s)) bySuit.set(c.s, []);
    bySuit.get(c.s).push(c);
  }
  for (const [s, arr] of bySuit){
    const sorted = arr.slice().sort((a,b)=>rankIndex(a.r)-rankIndex(b.r));
    // find consecutive window of 3
    for (let i=0;i<=sorted.length-3;i++){
      const window = [sorted[i], sorted[i+1], sorted[i+2]];
      if (isValidRun(window)){
        removeFromHand(p, window);
        p.melds.push(window);
        p.mustLayMeldFirst = false;
        state.laidMeldThisTurn = true;
        return;
      }
    }
    // try Q-K-A
    const hasQ = arr.find(c=>c.r==="Q");
    const hasK = arr.find(c=>c.r==="K");
    const hasA = arr.find(c=>c.r==="A");
    if (hasQ && hasK && hasA){
      const window = [hasQ, hasK, hasA];
      removeFromHand(p, window);
      p.melds.push(window);
      p.mustLayMeldFirst = false;
      state.laidMeldThisTurn = true;
      return;
    }
  }
}

function botTryAddToMeld(p){
  // try to add a single card to any meld that remains valid
  for (let i=0;i<p.hand.length;i++){
    const c = p.hand[i];
    for (const target of state.players){
      for (let m=0;m<target.melds.length;m++){
        const meld = target.melds[m];
        const combined = meld.concat([c]);
        if (validateMeld(combined).ok){
          // do it
          p.hand.splice(i,1);
          target.melds[m] = combined;
          return;
        }
      }
    }
  }
}

function botDiscard(p){
  // discard worst: prefer high value that doesn't fit
  let idx = 0;
  let bestScore = -Infinity;

  for (let i=0;i<p.hand.length;i++){
    const c = p.hand[i];
    // keep cards that help sets/runs
    let keep = 0;
    keep += p.hand.filter(x=>x.r===c.r).length>=2 ? 3 : 0;
    const suitIdx = p.hand.filter(x=>x.s===c.s).map(x=>rankIndex(x.r));
    const r = rankIndex(c.r);
    if (suitIdx.includes(r-1) || suitIdx.includes(r+1)) keep += 2;
    // prefer discarding low keep, and higher point
    const score = (RANK_VALUE(c.r)) - keep*3;
    if (score > bestScore){
      bestScore = score;
      idx = i;
    }
  }

  const [c] = p.hand.splice(idx,1);
  state.unwanted.push(c);
  state.peekIndex = state.unwanted.length-1;
  state.peekOpen = false;

  // win check: must win after discard
  if (p.hand.length===0){
    endRound(p.uid);
    return;
  }

  endTurn();
}

function removeFromHand(p, cards){
  const ids = new Set(cards.map(c=>c.id));
  p.hand = p.hand.filter(c=>!ids.has(c.id));
}

// ---------- Render ----------
function requestRenderLoop(){
  if (!state.uiNeedsRender) return;
  state.uiNeedsRender = false;
  renderGame();
}

function formatMs(ms){
  const s = Math.ceil(ms/1000);
  return `${s}s`;
}

function isJustDrawn(c){
  return c && (c._justDrew || c.id===state.lastDrawnId);
}

function cardHTML(c, {selectable=false, selected=false, small=false} = {}){
  const cls = ["card", SUIT_COLOR(c.s)];
  if (selected) cls.push("sel");
  if (small) cls.push("smallCard"); // (not used but safe)
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

  // seats (others)
  const others = state.players.filter(p=>p.uid!=="me");

  // keep hand scroll stable:
  // we store scrollLeft in requestRender() (below) and reapply after render
  app.innerHTML = `
    <div class="hdr">
      <div class="brand">
        <div class="title">Cousins</div>
        <div class="subtitle">Rummy Room</div>
        <div class="underline"></div>
      </div>
      <div class="exitMini" id="exitBtn">Menu</div>
    </div>

    <div class="turnBanner panel">
      <div>
        <b>${cur.uid==="me" ? "YOUR TURN" : `${escapeHtml(cur.name)}'s Turn`}</b>
        <div class="muted">Phase: ${escapeHtml(state.phase)} — Draw → (Lay/Add) → Discard 1</div>
      </div>
      <div style="font-weight:900; font-size:18px;">
        ${state.turnMsLeft<=15000 ? `<span class="danger">${formatMs(state.turnMsLeft)}</span>` : formatMs(state.turnMsLeft)}
      </div>
    </div>

    <div class="panel gameArea">

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
            ${state.unwanted.length ? `Top: <b>${escapeHtml(cardLabel(state.unwanted[state.unwanted.length-1]))}</b> (tap to peek)` : "Empty"}
          </div>

          <div class="peekWrap">
            <div class="peekStrip" id="peekStrip" style="display:${state.peekOpen ? "flex":"none"}">
              ${state.unwanted.map((c, i)=>{
                const active = (i===state.peekIndex) ? "active" : "";
                return `<div class="peekCard ${active}" data-peek="${i}">${cardHTML(c,{selectable:false})}</div>`;
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
          <span class="small">${me.mustLayMeldFirst ? "Lay 1 meld first ⛔" : "Add-to-meld unlocked ✅"}</span>
        </div>
        <div class="meldTrayBody">
          ${me.melds.length ? me.melds.map((meld, idx)=>`
            <div class="meldBlock meldTap" data-mymeld="${idx}">
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
            // also highlight brand-new draw
            const sel = selected || isJustDrawn(c);
            return cardHTML(c,{selectable:true, selected: sel});
          }).join("")}
        </div>

        <div class="btnRow">
          <button class="btn cyan" id="layMeld" ${(!isMyTurn()||state.phase==="DRAW")?"disabled":""}>Lay Meld</button>
          <button class="btn" id="discard" ${(!isMyTurn()||state.phase==="DRAW")?"disabled":""}>Discard (1)</button>
        </div>

        <div class="small" style="margin-top:8px;">
          Tip: Tap Unwanted top to peek. You must draw first every turn.
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
          ${state.modal.melds.length ? state.modal.melds.map((meld, idx)=>`
            <div class="meldBlock" style="margin-bottom:10px;">
              <div class="small">Meld ${idx+1}</div>
              <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
                ${meld.map(c=>cardHTML(c)).join("")}
              </div>
            </div>
          `).join("") : `<div class="small">No melds yet.</div>`}
        </div>
      </div>
    ` : "" }
  `;

  // Wire events
  const handEl = document.getElementById("hand");
  if (handEl){
    // restore scroll position
    handEl.scrollLeft = state.handScrollLeft;
    handEl.addEventListener("scroll", ()=>{
      state.handScrollLeft = handEl.scrollLeft;
    }, { passive:true });

    // tap to select
    handEl.querySelectorAll("[data-card]").forEach(el=>{
      el.onclick = ()=>toggleSelect(el.getAttribute("data-card"));
    });
  }

  const deckTap = document.getElementById("deckTap");
  if (deckTap){
    deckTap.onclick = drawFromDeck;
  }

  const takeTopBtn = document.getElementById("takeTop");
  if (takeTopBtn) takeTopBtn.onclick = takeUnwantedTop;

  const takeAllBtn = document.getElementById("takeAll");
  if (takeAllBtn) takeAllBtn.onclick = takeUnwantedAll;

  const layBtn = document.getElementById("layMeld");
  if (layBtn) layBtn.onclick = layMeld;

  const discBtn = document.getElementById("discard");
  if (discBtn) discBtn.onclick = discardSelected;

  // unwanted: tap top to open peek
  const topCardTap = document.querySelector(".pileBox .hint b");
  if (topCardTap){
    topCardTap.style.cursor = "pointer";
    topCardTap.onclick = ()=>{
      state.peekOpen = !state.peekOpen;
      state.peekIndex = state.unwanted.length-1;
      requestRender();
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
        requestRender();
      };
    });
  }

  // seat tap opens modal of opponent melds (keeps page short)
  const seatRow = document.getElementById("seatRow");
  if (seatRow){
    seatRow.querySelectorAll("[data-seat]").forEach(el=>{
      el.onclick = ()=>{
        const u = el.getAttribute("data-seat");
        const p = state.players.find(x=>x.uid===u);
        if (!p) return;
        state.modal = { title: `${p.name}'s melds`, melds: p.melds };
        requestRender();
      };
    });
  }

  const closeModal = document.getElementById("closeModal");
  if (closeModal){
    closeModal.onclick = ()=>{
      state.modal = null;
      requestRender();
    };
  }
  const modalBg = document.getElementById("modalBg");
  if (modalBg){
    modalBg.onclick = (e)=>{
      if (e.target.id === "modalBg"){
        state.modal = null;
        requestRender();
      }
    };
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

  // render loop (light)
  setInterval(requestRenderLoop, 60);

  // if first player is bot, let it act
  if (curPlayer().bot){
    setTimeout(()=>botAct(), 350);
  }
}

boot();