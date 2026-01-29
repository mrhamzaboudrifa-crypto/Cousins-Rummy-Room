/* Cousins Rummy Room — PRACTICE MODE (Bots)
   - One-screen mobile layout
   - Stable hand scrolling
   - Unwanted: Top visible + tap to peek strip + Take Top / Take All
   - Deck: tap stack to draw (goes to FRONT + highlight)
   - Meld tray compact
   - Must lay at least 1 meld this round before adding to any meld
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
  return { bots, difficulty: ["easy","mid","pro","goat"].includes(difficulty)?difficulty:"easy" };
}

// ---------- Game State ----------
const state = {
  uiNeedsRender: true,
  startedAt: now(),

  dealerIndex: 0,
  turnIndex: 0,
  turnMsLeft: 60000,
  turnTimer: null,
  phase: "DRAW",

  deck: [],
  unwanted: [],
  peekIndex: 0,
  peekOpen: false,

  players: [],
  selectedIds: new Set(),

  laidMeldThisTurn: false,
  handScrollLeft: 0,
  lastDrawnId: null,

  modal: null,
};

const { bots: BOT_COUNT, difficulty: BOT_DIFFICULTY } = parseParams();

// ---------- Deck ----------
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
function rankIndex(r){ return RANKS.indexOf(r); }

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

function isValidSet(cards){
  if (cards.length < 3) return false;
  const r = cards[0].r;
  return cards.every(c=>c.r===r);
}

function validateMeld(cards){
  if (cards.length < 3) return { ok:false, reason:"Meld must be 3+ cards." };
  if (isValidSet(cards)) return { ok:true };
  if (isValidRun(cards)) return { ok:true };
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
    bots.push({ uid:`bot_${i}`, name:n, bot:true });
  }
  return [{ uid:"me", name:youName, bot:false }, ...bots].map(p=>({
    ...p, hand:[], melds:[], score:0, mustLayMeldFirst:true
  }));
}

// ---------- Deal ----------
function deal(){
  state.dealerIndex = Math.floor(Math.random()*state.players.length);
  const nextIndex = (state.dealerIndex + 1) % state.players.length;

  for (let i=0;i<state.players.length;i++){
    const count = (i===nextIndex) ? 8 : 7;
    for (let k=0;k<count;k++) state.players[i].hand.push(state.deck.pop());
  }

  state.unwanted = [state.deck.pop()];
  state.peekIndex = state.unwanted.length-1;
  state.peekOpen = false;

  state.turnIndex = nextIndex;
  state.phase = "DRAW";
  state.selectedIds.clear();
  state.laidMeldThisTurn = false;
  state.turnMsLeft = 60000;
}

// ---------- Timer + chime ----------
function stopTurnTimer(){
  if (state.turnTimer){ clearInterval(state.turnTimer); state.turnTimer=null; }
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
function startTurnTimer(){
  stopTurnTimer();
  const start = now();
  const startLeft = state.turnMsLeft;
  state._chimed30=false; state._chimed15=false;

  state.turnTimer=setInterval(()=>{
    const elapsed = now()-start;
    state.turnMsLeft = clamp(startLeft-elapsed, 0, 60000);

    if (state.turnMsLeft<=30000 && !state._chimed30){ state._chimed30=true; softChime(1); }
    if (state.turnMsLeft<=15000 && !state._chimed15){ state._chimed15=true; softChime(2); }
    if (state.turnMsLeft===0) onTimeoutAutoMove();

    requestRender();
  }, 250);
}

// ---------- Core helpers ----------
function curPlayer(){ return state.players[state.turnIndex]; }
function mePlayer(){ return state.players.find(p=>p.uid==="me"); }
function isMyTurn(){ return curPlayer().uid==="me"; }
function nextTurnIndex(){ return (state.turnIndex+1)%state.players.length; }
function requestRender(){ state.uiNeedsRender=true; }

// ---------- Timeout auto-move ----------
function autoDrawFromDeck(p){
  if (!state.deck.length) return;
  const c = state.deck.pop();
  c._justDrew=true;
  state.lastDrawnId=c.id;
  p.hand.unshift(c);
  state.phase="MELD";
}
function autoRandomDiscard(p){
  if (!p.hand.length) return;
  const idx=Math.floor(Math.random()*p.hand.length);
  const [c]=p.hand.splice(idx,1);
  state.unwanted.push(c);
  state.peekIndex = state.unwanted.length-1;
  state.peekOpen=false;
}
function onTimeoutAutoMove(){
  stopTurnTimer();
  const p=curPlayer();
  if (state.phase==="DRAW") autoDrawFromDeck(p);
  if (state.phase!=="DRAW") autoRandomDiscard(p);
  endTurn();
}

// ---------- Turn end ----------
function endTurn(){
  state.selectedIds.clear();
  state.laidMeldThisTurn=false;
  state.phase="DRAW";
  state.turnIndex = nextTurnIndex();
  state.turnMsLeft=60000;
  startTurnTimer();
  requestRender();

  if (curPlayer().bot) setTimeout(()=>botAct(), 350);
}

// ---------- Selection ----------
function toggleSelect(cardId){
  if (!isMyTurn()) return;
  if (state.selectedIds.has(cardId)) state.selectedIds.delete(cardId);
  else state.selectedIds.add(cardId);
  requestRender();
}
function getSelectedCardsFromHand(){
  const me=mePlayer();
  return [...state.selectedIds].map(id=>me.hand.find(c=>c.id===id)).filter(Boolean);
}

// ---------- Actions ----------
function drawFromDeck(){
  if (!isMyTurn() || state.phase!=="DRAW" || !state.deck.length) return;
  const me=mePlayer();
  const c = state.deck.pop();
  c._justDrew=true;
  state.lastDrawnId=c.id;
  me.hand.unshift(c);
  state.phase="MELD";
  requestRender();
  setTimeout(()=>{
    const me=mePlayer();
    if (me) for (const x of me.hand) delete x._justDrew;
    state.lastDrawnId=null;
    requestRender();
  }, 900);
}

function takeUnwantedTop(){
  if (!isMyTurn() || state.phase!=="DRAW" || !state.unwanted.length) return;
  const me=mePlayer();
  const c = state.unwanted.pop();
  c._justDrew=true;
  state.lastDrawnId=c.id;
  me.hand.unshift(c);
  state.peekIndex = state.unwanted.length-1;
  state.peekOpen=false;
  state.phase="MELD";
  requestRender();
  setTimeout(()=>{
    const me=mePlayer();
    if (me) for (const x of me.hand) delete x._justDrew;
    state.lastDrawnId=null;
    requestRender();
  }, 900);
}

function takeUnwantedAll(){
  if (!isMyTurn() || state.phase!=="DRAW" || !state.unwanted.length) return;
  const me=mePlayer();
  const pile = state.unwanted.splice(0, state.unwanted.length);
  for (let i=pile.length-1;i>=0;i--) me.hand.unshift(pile[i]);
  state.peekIndex=-1;
  state.peekOpen=false;
  state.phase="MELD";
  requestRender();
}

function layMeld(){
  if (!isMyTurn() || state.phase==="DRAW") return;
  const me=mePlayer();
  const cards=getSelectedCardsFromHand();
  const v=validateMeld(cards);
  if (!v.ok){ alert(v.reason); return; }

  const ids=new Set(cards.map(c=>c.id));
  me.hand = me.hand.filter(c=>!ids.has(c.id));
  me.melds.push(cards);

  state.laidMeldThisTurn=true;
  me.mustLayMeldFirst=false;

  state.selectedIds.clear();
  requestRender();
}

function discardSelected(){
  if (!isMyTurn() || state.phase==="DRAW") return;
  const me=mePlayer();
  if (state.selectedIds.size!==1){ alert("Select exactly 1 card to discard."); return; }
  const id=[...state.selectedIds][0];
  const idx=me.hand.findIndex(c=>c.id===id);
  if (idx<0) return;
  const [c]=me.hand.splice(idx,1);
  state.unwanted.push(c);
  state.peekIndex=state.unwanted.length-1;
  state.peekOpen=false;
  state.selectedIds.clear();

  if (me.hand.length===0){ endRound(me.uid); return; }
  endTurn();
}

// ---------- Scoring / Round end ----------
function endRound(winnerUid){
  stopTurnTimer();
  const winner = state.players.find(p=>p.uid===winnerUid);
  winner.score += pointsOfCards(winner.melds.flat());

  for (const p of state.players){
    if (p.uid===winnerUid) continue;
    const laid=p.melds.flat();
    let laidTokens=laid.map(c=>RANK_VALUE(c.r));
    const handVals=p.hand.map(c=>RANK_VALUE(c.r));

    for (const hv of handVals){
      if (hv===10){
        const idx10=laidTokens.indexOf(10);
        if (idx10>=0){ laidTokens.splice(idx10,1); continue; }
        const i5a=laidTokens.indexOf(5);
        if (i5a>=0){
          laidTokens.splice(i5a,1);
          const i5b=laidTokens.indexOf(5);
          if (i5b>=0) laidTokens.splice(i5b,1);
        }
      } else {
        const idx5=laidTokens.indexOf(5);
        if (idx5>=0) laidTokens.splice(idx5,1);
      }
    }

    const laidTotal=pointsOfCards(laid);
    const remainingLaidTotal=laidTokens.reduce((a,b)=>a+b,0);
    const cancelledValue=laidTotal-remainingLaidTotal;

    const handTotal=pointsOfCards(p.hand);
    const uncancelled=Math.max(0, handTotal-cancelledValue);
    p.score -= uncancelled;
  }

  alert(`${winner.name} won the round!`);
  startNewRound();
}

function startNewRound(){
  state.deck=makeDeck();
  for (const p of state.players){
    p.hand=[]; p.melds=[]; p.mustLayMeldFirst=true;
  }
  deal();
  startTurnTimer();
  requestRender();
  if (curPlayer().bot) setTimeout(()=>botAct(), 350);
}

// ---------- Bot AI (same as you had, kept simple) ----------
function botAct(){
  const p=curPlayer();
  if (!p.bot) return;
  if (state.phase==="DRAW"){ botDraw(p); requestRender(); setTimeout(()=>botMeldAndDiscard(p), 450); return; }
  botMeldAndDiscard(p);
}

function botWouldUseCard(p, card){
  const sameRankCount = p.hand.filter(x=>x.r===card.r).length;
  if (sameRankCount>=2) return true;
  const sameSuit = p.hand.filter(x=>x.s===card.s).map(x=>rankIndex(x.r));
  const r = rankIndex(card.r);
  return sameSuit.includes(r-1) || sameSuit.includes(r+1) || (BOT_DIFFICULTY==="goat" && Math.random()<0.35);
}

function botDraw(p){
  const top = state.unwanted[state.unwanted.length-1];
  const shouldTakeTop = top && botWouldUseCard(p, top);

  if ((BOT_DIFFICULTY==="pro"||BOT_DIFFICULTY==="goat") && shouldTakeTop && Math.random()<0.7){
    const c = state.unwanted.pop();
    p.hand.unshift(c);
    state.phase="MELD";
    state.peekIndex=state.unwanted.length-1;
    state.peekOpen=false;
  } else {
    autoDrawFromDeck(p);
  }
}

function removeFromHand(p, cards){
  const ids=new Set(cards.map(c=>c.id));
  p.hand=p.hand.filter(c=>!ids.has(c.id));
}

function botTryLayMeld(p){
  const byRank=new Map();
  for (const c of p.hand){
    if (!byRank.has(c.r)) byRank.set(c.r, []);
    byRank.get(c.r).push(c);
  }
  for (const arr of byRank.values()){
    if (arr.length>=3){
      const meld = arr.slice(0, Math.min(4, arr.length));
      removeFromHand(p, meld);
      p.melds.push(meld);
      p.mustLayMeldFirst=false;
      state.laidMeldThisTurn=true;
      return;
    }
  }
}

function botDiscard(p){
  if (!p.hand.length) return;
  const idx=Math.floor(Math.random()*p.hand.length);
  const [c]=p.hand.splice(idx,1);
  state.unwanted.push(c);
  state.peekIndex=state.unwanted.length-1;
  state.peekOpen=false;

  if (p.hand.length===0){ endRound(p.uid); return; }
  endTurn();
}

function botMeldAndDiscard(p){
  if (state.phase!=="MELD") return;
  botTryLayMeld(p);
  botDiscard(p);
}

// ---------- Render helpers ----------
function formatMs(ms){ return `${Math.ceil(ms/1000)}s`; }
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

// IMPORTANT: we only bind scroll handler once
let handScrollBound = false;

function renderGame(){
  const me=mePlayer();
  const cur=curPlayer();
  const others=state.players.filter(p=>p.uid!=="me");

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
            <b>Deck</b><span class="small">${state.deck.length} left</span>
          </div>
          <div class="deckStack" id="deckTap" title="Tap to draw 1">
            <div class="back"></div><div class="label">TAP</div>
          </div>
          <div class="hint">Tap the deck to draw 1</div>
        </div>

        <div class="pileBox">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <b>Unwanted</b><span class="small">${state.unwanted.length} cards</span>
          </div>

          <div class="hint" id="unwantedTopTap">
            ${state.unwanted.length ? `Top: <b>${escapeHtml(cardLabel(state.unwanted[state.unwanted.length-1]))}</b> (tap to peek)` : "Empty"}
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
            const sel = selected || isJustDrawn(c);
            return cardHTML(c,{selectable:true, selected: sel});
          }).join("")}
        </div>

        <div class="btnRow">
          <button class="btn cyan" id="layMeld" ${(!isMyTurn()||state.phase==="DRAW")?"disabled":""}>Lay Meld</button>
          <button class="btn" id="discard" ${(!isMyTurn()||state.phase==="DRAW")?"disabled":""}>Discard (1)</button>
        </div>

        <div class="small" style="margin-top:8px;">Tap Unwanted top to peek. You must draw first every turn.</div>
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

  // Hand scroll restore
  const handEl = document.getElementById("hand");
  if (handEl){
    handEl.scrollLeft = state.handScrollLeft;
    if (!handScrollBound){
      handScrollBound = true;
      handEl.addEventListener("scroll", ()=>{ state.handScrollLeft = handEl.scrollLeft; }, { passive:true });
    }
    handEl.querySelectorAll("[data-card]").forEach(el=>{
      el.onclick = ()=>toggleSelect(el.getAttribute("data-card"));
    });
  }

  document.getElementById("deckTap").onclick = drawFromDeck;
  document.getElementById("takeTop").onclick = takeUnwantedTop;
  document.getElementById("takeAll").onclick = takeUnwantedAll;
  document.getElementById("layMeld").onclick = layMeld;
  document.getElementById("discard").onclick = discardSelected;

  // Correct: unwanted top tap binds to the right element
  const topTap = document.getElementById("unwantedTopTap");
  if (topTap && state.unwanted.length){
    topTap.style.cursor="pointer";
    topTap.onclick = ()=>{
      state.peekOpen = !state.peekOpen;
      state.peekIndex = state.unwanted.length-1;
      requestRender();
      setTimeout(()=>{
        const strip=document.getElementById("peekStrip");
        if (strip && state.peekOpen) strip.scrollLeft = strip.scrollWidth;
      },0);
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

  // Opponent meld modal
  const seatRow=document.getElementById("seatRow");
  if (seatRow){
    seatRow.querySelectorAll("[data-seat]").forEach(el=>{
      el.onclick = ()=>{
        const u=el.getAttribute("data-seat");
        const p=state.players.find(x=>x.uid===u);
        if (!p) return;
        state.modal = { title:`${p.name}'s melds`, melds:p.melds };
        requestRender();
      };
    });
  }

  const closeModal=document.getElementById("closeModal");
  if (closeModal) closeModal.onclick = ()=>{ state.modal=null; requestRender(); };

  const modalBg=document.getElementById("modalBg");
  if (modalBg) modalBg.onclick = (e)=>{ if (e.target.id==="modalBg"){ state.modal=null; requestRender(); } };

  document.getElementById("exitBtn").onclick = ()=>{
    if (confirm("Exit practice mode?")) location.href="./index.html";
  };
}

// ---------- Render loop ----------
function requestRenderLoop(){
  if (!state.uiNeedsRender) return;
  state.uiNeedsRender=false;
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
  if (curPlayer().bot) setTimeout(()=>botAct(), 350);
}
boot();