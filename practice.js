/* Cousins Rummy Room — PRACTICE MODE (Smooth mobile)
   Key fixes:
   - NO constant full re-render while finger is dragging (stops “fight”)
   - Unwanted is biggest + shows TOP card as physical card
   - Deck is small
   - Peek opens instantly on touch (pointerdown), no multi-press
*/

const app = document.getElementById("app");

// ---------- Utilities ----------
const SUITS = ["♠","♥","♦","♣"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const SUIT_COLOR = (s) => (s==="♥"||s==="♦") ? "red" : "black";
const uid = ()=>Math.random().toString(36).slice(2,10);
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const escapeHtml = (s)=>(s||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

function parseParams(){
  const p = new URLSearchParams(location.search);
  const bots = clamp(parseInt(p.get("bots")||"1",10), 1, 3);
  const difficulty = (p.get("difficulty")||"easy").toLowerCase();
  return { bots, difficulty: ["easy","mid","pro","goat"].includes(difficulty)?difficulty:"easy" };
}
const { bots: BOT_COUNT, difficulty: BOT_DIFFICULTY } = parseParams();

function rankIndex(r){ return RANKS.indexOf(r); }
function cardLabel(c){ return `${c.r}${c.s}`; }

// ---------- State ----------
const state = {
  uiNeedsRender: true,
  isDragging: false,       // ✅ critical: prevents re-render during swipe
  handScrollLeft: 0,
  peekScrollLeft: 0,

  turnIndex: 0,
  phase: "DRAW",
  turnMsLeft: 60000,
  turnTimer: null,

  deck: [],
  unwanted: [],
  peekOpen: false,

  players: [],
  selectedIds: new Set(),
  lastDrawnId: null,
};

// ---------- Deck ----------
function makeDeck(){
  const d=[];
  for (const s of SUITS) for (const r of RANKS) d.push({id:uid(), r, s});
  for (let i=d.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [d[i],d[j]]=[d[j],d[i]];
  }
  return d;
}

// ---------- Meld validation ----------
function isValidSet(cards){
  if (cards.length<3) return false;
  const r = cards[0].r;
  return cards.every(c=>c.r===r);
}
function isValidRun(cards){
  if (cards.length<3) return false;
  const suit = cards[0].s;
  if (!cards.every(c=>c.s===suit)) return false;

  // A low
  const idx = cards.map(c=>rankIndex(c.r)).sort((a,b)=>a-b);
  const low = idx.every((v,i)=>i===0||v===idx[i-1]+1);
  if (low) return true;

  // A high
  if (!cards.some(c=>c.r==="A")) return false;
  const idxHigh = cards.map(c=> (c.r==="A"?13:rankIndex(c.r)) ).sort((a,b)=>a-b);
  return idxHigh.every((v,i)=>i===0||v===idxHigh[i-1]+1);
}
function validateMeld(cards){
  if (cards.length<3) return {ok:false, reason:"Meld must be 3+ cards."};
  if (isValidSet(cards)) return {ok:true, type:"set"};
  if (isValidRun(cards)) return {ok:true, type:"run"};
  return {ok:false, reason:"Not a valid set or run."};
}

// ---------- Players ----------
function makePlayers(){
  const youName = localStorage.getItem("crr_name") || "You";
  const names = ["Alice","Mike","John","Med","Lisa","Zara","Omar","Tara","Nina"];
  const bots=[];
  for (let i=0;i<BOT_COUNT;i++){
    bots.push({ uid:`bot_${i}`, name:names[i]||`Bot${i+1}`, bot:true });
  }
  return [
    { uid:"me", name:youName, bot:false },
    ...bots
  ].map(p=>({ ...p, hand:[], melds:[], mustLayMeldFirst:true, score:0 }));
}

function curPlayer(){ return state.players[state.turnIndex]; }
function mePlayer(){ return state.players.find(p=>p.uid==="me"); }
function isMyTurn(){ return curPlayer().uid==="me"; }

function requestRender(){
  state.uiNeedsRender = true;
}

// ---------- Deal ----------
function deal(){
  const dealer = Math.floor(Math.random()*state.players.length);
  const next = (dealer+1)%state.players.length;

  for (let i=0;i<state.players.length;i++){
    const count = (i===next)?8:7;
    for (let k=0;k<count;k++) state.players[i].hand.push(state.deck.pop());
  }

  state.unwanted.push(state.deck.pop());
  state.peekOpen = false;

  state.turnIndex = next;
  state.phase = "DRAW";
  state.selectedIds.clear();
  state.turnMsLeft = 60000;
}

// ---------- Timer ----------
function startTurnTimer(){
  stopTurnTimer();
  const started = Date.now();
  const startLeft = state.turnMsLeft;

  state.turnTimer = setInterval(()=>{
    const elapsed = Date.now() - started;
    state.turnMsLeft = clamp(startLeft - elapsed, 0, 60000);
    if (state.turnMsLeft === 0){
      onTimeout();
    }
    requestRender();
  }, 250);
}
function stopTurnTimer(){
  if (state.turnTimer){ clearInterval(state.turnTimer); state.turnTimer=null; }
}
function onTimeout(){
  stopTurnTimer();
  const p = curPlayer();
  if (state.phase==="DRAW") autoDrawFromDeck(p);
  if (state.phase!=="DRAW") autoRandomDiscard(p);
  endTurn();
}

// ---------- Actions ----------
function autoDrawFromDeck(p){
  if (!state.deck.length) return;
  const c = state.deck.pop();
  c._justDrew = true;
  state.lastDrawnId = c.id;
  p.hand.unshift(c); // front
  state.phase = "MELD";
}
function autoRandomDiscard(p){
  if (!p.hand.length) return;
  const idx = Math.floor(Math.random()*p.hand.length);
  const [c] = p.hand.splice(idx,1);
  state.unwanted.push(c);
  state.peekOpen = false;
}

function drawFromDeck(){
  if (!isMyTurn() || state.phase!=="DRAW") return;
  const me = mePlayer();
  autoDrawFromDeck(me);
  requestRender();
  clearJustDrewSoon();
}

function takeUnwantedTop(){
  if (!isMyTurn() || state.phase!=="DRAW") return;
  if (!state.unwanted.length) return;
  const me = mePlayer();
  const c = state.unwanted.pop();
  c._justDrew = true;
  state.lastDrawnId = c.id;
  me.hand.unshift(c);
  state.phase = "MELD";
  state.peekOpen = false;
  requestRender();
  clearJustDrewSoon();
}

function takeUnwantedAll(){
  if (!isMyTurn() || state.phase!=="DRAW") return;
  const me = mePlayer();
  if (!state.unwanted.length) return;
  const pile = state.unwanted.splice(0, state.unwanted.length);
  for (let i=pile.length-1;i>=0;i--) me.hand.unshift(pile[i]);
  state.phase = "MELD";
  state.peekOpen = false;
  requestRender();
}

function toggleSelect(id){
  if (!isMyTurn()) return;
  const me = mePlayer();
  if (!me.hand.find(c=>c.id===id)) return;
  if (state.selectedIds.has(id)) state.selectedIds.delete(id);
  else state.selectedIds.add(id);
  requestRender();
}
function selectedCards(){
  const me = mePlayer();
  return [...state.selectedIds].map(id=>me.hand.find(c=>c.id===id)).filter(Boolean);
}

function layMeld(){
  if (!isMyTurn() || state.phase==="DRAW") return;
  const me = mePlayer();
  const cards = selectedCards();
  const v = validateMeld(cards);
  if (!v.ok){ alert(v.reason); return; }

  const ids = new Set(cards.map(c=>c.id));
  me.hand = me.hand.filter(c=>!ids.has(c.id));
  me.melds.push(cards);

  me.mustLayMeldFirst = false;
  state.selectedIds.clear();
  requestRender();
}

function discardSelected(){
  if (!isMyTurn() || state.phase==="DRAW") return;
  const me = mePlayer();
  if (state.selectedIds.size!==1){ alert("Select exactly 1 card to discard."); return; }

  const id = [...state.selectedIds][0];
  const idx = me.hand.findIndex(c=>c.id===id);
  if (idx<0) return;

  const [c] = me.hand.splice(idx,1);
  state.unwanted.push(c);
  state.peekOpen = false;
  state.selectedIds.clear();

  if (me.hand.length===0){
    alert(`${me.name} won the round!`);
    startNewRound();
    return;
  }
  endTurn();
}

function endTurn(){
  state.selectedIds.clear();
  state.phase = "DRAW";
  state.turnIndex = (state.turnIndex+1) % state.players.length;
  state.turnMsLeft = 60000;
  startTurnTimer();
  requestRender();

  if (curPlayer().bot){
    setTimeout(botAct, 350);
  }
}

function startNewRound(){
  stopTurnTimer();
  state.deck = makeDeck();
  for (const p of state.players){
    p.hand=[]; p.melds=[]; p.mustLayMeldFirst=true;
  }
  deal();
  startTurnTimer();
  requestRender();
  if (curPlayer().bot) setTimeout(botAct, 350);
}

function clearJustDrewSoon(){
  setTimeout(()=>{
    const me = mePlayer();
    if (me) me.hand.forEach(c=>delete c._justDrew);
    state.lastDrawnId = null;
    requestRender();
  }, 900);
}

// ---------- Bot (very simple placeholder) ----------
function botAct(){
  const p = curPlayer();
  if (!p.bot) return;

  if (state.phase==="DRAW"){
    autoDrawFromDeck(p);
    requestRender();
    setTimeout(botAct, 350);
    return;
  }

  // discard random
  autoRandomDiscard(p);
  endTurn();
}

// ---------- Smooth horizontal drag (NO fighting) ----------
function enableDragScroll(el, rememberKey){
  if (!el) return;

  let down = false;
  let startX = 0;
  let startScroll = 0;
  let moved = false;

  el.classList.add("hScroll");
  el.style.touchAction = "pan-x";

  const posX = (e)=> (e.touches ? e.touches[0].clientX : e.clientX);

  const onDown = (e)=>{
    down = true;
    moved = false;
    state.isDragging = true;
    startX = posX(e);
    startScroll = el.scrollLeft;
  };

  const onMove = (e)=>{
    if (!down) return;
    const dx = posX(e) - startX;
    if (Math.abs(dx) > 2) moved = true;
    if (e.cancelable) e.preventDefault();
    el.scrollLeft = startScroll - dx;
    if (rememberKey) state[rememberKey] = el.scrollLeft;
  };

  const onUp = ()=>{
    down = false;
    state.isDragging = false;
    if (rememberKey) state[rememberKey] = el.scrollLeft;
    if (moved) requestRender();
  };

  el.addEventListener("touchstart", onDown, {passive:true});
  el.addEventListener("touchmove", onMove, {passive:false});
  el.addEventListener("touchend", onUp, {passive:true});
  el.addEventListener("touchcancel", onUp, {passive:true});

  // stop iOS “click after drag” selecting cards
  el.addEventListener("click", (e)=>{
    if (!moved) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
}

// ---------- UI ----------
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

function formatMs(ms){
  return `${Math.ceil(ms/1000)}s`;
}

// ✅ render only when needed, and NEVER during drag
function renderLoop(){
  if (state.isDragging) return;
  if (!state.uiNeedsRender) return;
  state.uiNeedsRender = false;
  render();
}

function render(){
  const me = mePlayer();
  const cur = curPlayer();
  const top = state.unwanted[state.unwanted.length-1];

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
            <div class="muted">Phase: ${escapeHtml(state.phase)} — Draw → (Lay) → Discard 1</div>
          </div>
          <div style="font-weight:900;font-size:18px;">${formatMs(state.turnMsLeft)}</div>
        </div>

        <div class="panel gameMain">

          <!-- Opponents -->
          <div class="seatRow">
            ${state.players.filter(p=>p.uid!=="me").map(p=>`
              <div class="seatBox ${p.uid===cur.uid ? "activeTurn":""}">
                <div><b>${escapeHtml(p.name)}</b></div>
                <div class="small">Cards left: ${p.hand.length}</div>
                <div class="small">Score: ${p.score}</div>
              </div>
            `).join("")}
          </div>

          <!-- Center: SMALL deck + BIG unwanted -->
          <div class="centerRow" style="grid-template-columns: .72fr 1.28fr;">
            <div class="pileBox" style="text-align:center;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <b>Deck</b><span class="small">${state.deck.length} left</span>
              </div>
              <div class="deckStack" id="deckTap" style="transform:scale(.78); transform-origin: top center;">
                <div class="back"></div>
                <div class="label">TAP</div>
              </div>
              <div class="hint">Draw 1</div>
            </div>

            <div class="pileBox">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <b>Unwanted</b><span class="small">${state.unwanted.length} cards</span>
              </div>

              <div style="display:flex; gap:12px; align-items:center; margin-top:8px;">
                <div id="unwantedTopCard" style="flex:0 0 auto;">
                  ${top ? cardHTML(top,{selectable:false, selected:false}) : `<div class="small">Empty</div>`}
                </div>
                <div style="flex:1;">
                  <div class="small">Tap the top card to peek the whole pile</div>
                  <div class="btnRow" style="margin-top:10px;">
                    <button class="btn cyan" id="takeTop" ${(!isMyTurn()||state.phase!=="DRAW"||!top)?"disabled":""}>Take Top</button>
                    <button class="btn" id="takeAll" ${(!isMyTurn()||state.phase!=="DRAW"||!top)?"disabled":""}>Take All</button>
                  </div>
                </div>
              </div>

              <div class="peekWrap" style="margin-top:12px; display:${state.peekOpen?"block":"none"};">
                <div class="peekStrip" id="peekStrip">
                  ${state.unwanted.map(c=>`<div class="peekCard">${cardHTML(c)}</div>`).join("")}
                </div>
              </div>

            </div>
          </div>
        </div>

        <!-- Hand -->
        <div class="handBar">
          <div class="handHead">
            <div>
              <b>Your hand</b>
              <div class="small">Swipe left/right • select cards • lay meld • discard</div>
            </div>
            <div class="small">Score: <b>${me.score}</b></div>
          </div>

          <div id="hand">
            ${me.hand.map(c=>{
              const selected = state.selectedIds.has(c.id);
              const highlight = selected || c._justDrew || c.id===state.lastDrawnId;
              return cardHTML(c,{selectable:true, selected:highlight});
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

  // --- Events ---
  const handEl = document.getElementById("hand");
  if (handEl){
    handEl.scrollLeft = state.handScrollLeft;
    enableDragScroll(handEl, "handScrollLeft");
    handEl.querySelectorAll("[data-card]").forEach(el=>{
      el.onpointerdown = (e)=>{
        // avoid scroll interpreting as tap
        if (state.isDragging) return;
        toggleSelect(el.getAttribute("data-card"));
      };
    });
  }

  const peek = document.getElementById("peekStrip");
  if (peek){
    peek.scrollLeft = state.peekScrollLeft;
    enableDragScroll(peek, "peekScrollLeft");
  }

  const topCard = document.getElementById("unwantedTopCard");
  if (topCard){
    topCard.onpointerdown = (e)=>{
      // instant open/close
      state.peekOpen = !state.peekOpen;
      requestRender();
      setTimeout(()=>{
        const strip = document.getElementById("peekStrip");
        if (strip && state.peekOpen) strip.scrollLeft = strip.scrollWidth;
      }, 0);
    };
  }

  const deckTap = document.getElementById("deckTap");
  if (deckTap) deckTap.onpointerdown = ()=>drawFromDeck();

  const takeTopBtn = document.getElementById("takeTop");
  if (takeTopBtn) takeTopBtn.onclick = takeUnwantedTop;

  const takeAllBtn = document.getElementById("takeAll");
  if (takeAllBtn) takeAllBtn.onclick = takeUnwantedAll;

  const layBtn = document.getElementById("layMeld");
  if (layBtn) layBtn.onclick = layMeld;

  const discBtn = document.getElementById("discard");
  if (discBtn) discBtn.onclick = discardSelected;

  const exitBtn = document.getElementById("exitBtn");
  if (exitBtn) exitBtn.onclick = ()=>{ if (confirm("Exit practice mode?")) location.href="./index.html"; };
}

// ---------- Boot ----------
function boot(){
  state.players = makePlayers();
  state.deck = makeDeck();
  deal();
  startTurnTimer();
  render();
  setInterval(renderLoop, 120);
  if (curPlayer().bot) setTimeout(botAct, 350);
}
boot();