/* Cousins Rummy Room — PRACTICE MODE (Start-to-finish)
   Fixes requested:
   ✅ Deck tiny top-right
   ✅ Unwanted biggest, shows TOP card physically
   ✅ DOUBLE TAP top unwanted card => open/close peek pile
   ✅ Peek pile: swipe + horizontal slider scrubber
   ✅ Hand swipe never selects cards (tap-vs-swipe guard)
   ✅ No “fighting” caused by re-render during drag (render paused while dragging)
*/

const app = document.getElementById("app");

// ---------- Constants ----------
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
const { bots: BOT_COUNT } = parseParams();

// ---------- State ----------
const state = {
  uiNeedsRender: true,
  isDragging: false,

  // remember scroll positions
  handScrollLeft: 0,
  peekScrollLeft: 0,

  // turn
  turnIndex: 0,
  phase: "DRAW",
  turnMsLeft: 60000,
  turnTimer: null,

  // piles
  deck: [],
  unwanted: [],
  peekOpen: false,

  // players
  players: [],
  selectedIds: new Set(),
  lastDrawnId: null,

  // double-tap timing
  lastTapTime: 0,
};

// ---------- Helpers ----------
function rankIndex(r){ return RANKS.indexOf(r); }

function requestRender(){ state.uiNeedsRender = true; }

function mePlayer(){ return state.players.find(p=>p.uid==="me"); }
function curPlayer(){ return state.players[state.turnIndex]; }
function isMyTurn(){ return curPlayer().uid==="me"; }

// ---------- Tap-vs-swipe guard ----------
function makeTapGuard(){ return {x:0,y:0,moved:false}; }
function posXY(e){ const t = e.touches ? e.touches[0] : e; return {x:t.clientX,y:t.clientY}; }
function markDown(g,e){ const p=posXY(e); g.x=p.x; g.y=p.y; g.moved=false; }
function markMove(g,e){
  const p=posXY(e);
  if (Math.abs(p.x-g.x)>8 || Math.abs(p.y-g.y)>8) g.moved=true;
}

// ---------- Drag-to-scroll (smooth, no fighting) ----------
function enableDragScroll(el, rememberKey){
  if (!el) return;

  let down=false, startX=0, startScroll=0, moved=false;
  el.style.touchAction="pan-x";

  const getX=(e)=> (e.touches ? e.touches[0].clientX : e.clientX);

  const onDown=(e)=>{
    down=true; moved=false;
    state.isDragging=true;
    startX=getX(e);
    startScroll=el.scrollLeft;
  };

  const onMove=(e)=>{
    if (!down) return;
    const dx=getX(e)-startX;
    if (Math.abs(dx)>2) moved=true;
    if (e.cancelable) e.preventDefault();
    el.scrollLeft = startScroll - dx;
    if (rememberKey) state[rememberKey] = el.scrollLeft;
  };

  const onUp=()=>{
    down=false;
    state.isDragging=false;
    if (rememberKey) state[rememberKey] = el.scrollLeft;
    if (moved) requestRender();
  };

  el.addEventListener("touchstart", onDown, {passive:true});
  el.addEventListener("touchmove", onMove, {passive:false});
  el.addEventListener("touchend", onUp, {passive:true});
  el.addEventListener("touchcancel", onUp, {passive:true});

  // block iOS “ghost click after drag”
  el.addEventListener("click", (e)=>{
    if (!moved) return;
    e.preventDefault(); e.stopPropagation();
  }, true);
}

// ---------- Slider scrubber ----------
function bindScrubber(rangeEl, scrollerEl, rememberKey){
  if (!rangeEl || !scrollerEl) return;

  const update = ()=>{
    const max = Math.max(0, scrollerEl.scrollWidth - scrollerEl.clientWidth);
    rangeEl.max = String(max);
    rangeEl.value = String(scrollerEl.scrollLeft);
  };

  rangeEl.addEventListener("input", ()=>{
    scrollerEl.scrollLeft = Number(rangeEl.value);
    if (rememberKey) state[rememberKey] = scrollerEl.scrollLeft;
  });

  scrollerEl.addEventListener("scroll", ()=>{
    if (rememberKey) state[rememberKey] = scrollerEl.scrollLeft;
    update();
  }, {passive:true});

  window.addEventListener("resize", update);
  setTimeout(update, 0);
}

// ---------- Deck creation ----------
function makeDeck(){
  const d=[];
  for (const s of SUITS) for (const r of RANKS) d.push({id:uid(), r, s});
  for (let i=d.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [d[i],d[j]]=[d[j],d[i]];
  }
  return d;
}

// ---------- Players ----------
function makePlayers(){
  const youName = localStorage.getItem("crr_name") || "You";
  const names = ["Alice","Mike","John","Med","Lisa","Zara","Omar","Tara","Nina"];
  const bots=[];
  for (let i=0;i<BOT_COUNT;i++){
    bots.push({ uid:`bot_${i}`, name:names[i]||`Bot${i+1}`, bot:true });
  }
  return [{ uid:"me", name:youName, bot:false }, ...bots].map(p=>({
    ...p,
    hand: [],
    melds: [],
    score: 0,
  }));
}

// ---------- Deal ----------
function deal(){
  const dealer = Math.floor(Math.random()*state.players.length);
  const next = (dealer+1)%state.players.length;

  for (let i=0;i<state.players.length;i++){
    const count = (i===next)?8:7;
    for (let k=0;k<count;k++){
      state.players[i].hand.push(state.deck.pop());
    }
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
    if (state.turnMsLeft===0) onTimeout();
    requestRender();
  }, 250);
}
function stopTurnTimer(){
  if (state.turnTimer){
    clearInterval(state.turnTimer);
    state.turnTimer=null;
  }
}
function onTimeout(){
  stopTurnTimer();
  const p = curPlayer();
  if (state.phase==="DRAW") autoDrawFromDeck(p);
  if (state.phase!=="DRAW") autoRandomDiscard(p);
  endTurn();
}

// ---------- Actions ----------
function clearJustDrewSoon(){
  setTimeout(()=>{
    const me = mePlayer();
    if (me) me.hand.forEach(c=>delete c._justDrew);
    state.lastDrawnId = null;
    requestRender();
  }, 900);
}

function autoDrawFromDeck(p){
  if (!state.deck.length) return;
  const c = state.deck.pop();
  c._justDrew = true;
  state.lastDrawnId = c.id;
  p.hand.unshift(c); // FRONT
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
  autoDrawFromDeck(mePlayer());
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
  if (!state.unwanted.length) return;
  const me = mePlayer();
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
  state.turnIndex = (state.turnIndex+1)%state.players.length;
  state.turnMsLeft = 60000;
  startTurnTimer();
  requestRender();

  if (curPlayer().bot) setTimeout(botAct, 350);
}

function startNewRound(){
  stopTurnTimer();
  state.deck = makeDeck();
  for (const p of state.players){
    p.hand=[]; p.melds=[];
  }
  deal();
  startTurnTimer();
  requestRender();
  if (curPlayer().bot) setTimeout(botAct, 350);
}

// ---------- Bot (simple placeholder) ----------
function botAct(){
  const p = curPlayer();
  if (!p.bot) return;

  if (state.phase==="DRAW"){
    autoDrawFromDeck(p);
    requestRender();
    setTimeout(botAct, 250);
    return;
  }
  autoRandomDiscard(p);
  endTurn();
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

function formatMs(ms){ return `${Math.ceil(ms/1000)}s`; }

// Render loop (IMPORTANT: does not re-render during drag)
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
      <div class="shell gameLayout" style="position:relative;">

        <!-- Tiny deck top-right -->
        <div class="deckTiny" id="deckTap">
          <div class="miniBack"></div>
          <div class="miniTxt">${state.deck.length}</div>
        </div>

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
            <div class="muted">Phase: ${escapeHtml(state.phase)} — Draw → (Play) → Discard</div>
          </div>
          <div style="font-weight:900;font-size:18px;">${formatMs(state.turnMsLeft)}</div>
        </div>

        <div class="panel gameMain">

          <!-- Big Unwanted -->
          <div class="pileBox unwantedBig">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <b>Unwanted</b>
              <span class="small">${state.unwanted.length} cards</span>
            </div>

            <div class="unwantedTopRow">
              <div class="topCardWrap" id="unwantedTopCard">
                ${top ? cardHTML(top) : `<div class="small">Empty</div>`}
              </div>

              <div class="unwantedInfo">
                <div class="small">
                  Double-tap the top card to ${state.peekOpen ? "close" : "open"} the pile
                </div>
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
              <input id="peekScrubber" class="scrubber" type="range" min="0" value="0" />
            </div>
          </div>

        </div>

        <!-- Hand -->
        <div class="handBar">
          <div class="handHead">
            <div>
              <b>Your hand</b>
              <div class="small">Swipe smoothly (won’t select while swiping)</div>
            </div>
            <div class="small">Score: <b>${me.score}</b></div>
          </div>

          <div id="hand">
            ${me.hand.map(c=>{
              const selected = state.selectedIds.has(c.id);
              const hi = selected || c._justDrew || c.id===state.lastDrawnId;
              return cardHTML(c,{selectable:true, selected:hi});
            }).join("")}
          </div>

          <input id="handScrubber" class="scrubber" type="range" min="0" value="0" />

          <div class="btnRow">
            <button class="btn" id="discard" ${(!isMyTurn()||state.phase==="DRAW")?"disabled":""}>Discard (1)</button>
          </div>
        </div>

      </div>
    </div>
  `;

  // Deck tiny tap
  document.getElementById("deckTap").onpointerdown = ()=>{
    drawFromDeck();
  };

  // Unwanted top double-tap open/close
  const topCard = document.getElementById("unwantedTopCard");
  if (topCard){
    const g = makeTapGuard();
    topCard.addEventListener("pointerdown", (e)=>markDown(g,e));
    topCard.addEventListener("pointermove", (e)=>markMove(g,e));
    topCard.addEventListener("pointerup", ()=>{
      if (g.moved) return; // swipe => ignore
      const t = Date.now();
      if (t - state.lastTapTime < 320){
        state.peekOpen = !state.peekOpen;
        requestRender();
        setTimeout(()=>{
          const strip = document.getElementById("peekStrip");
          if (strip && state.peekOpen) strip.scrollLeft = strip.scrollWidth;
        }, 0);
      }
      state.lastTapTime = t;
    });
  }

  // Buttons
  const takeTopBtn = document.getElementById("takeTop");
  if (takeTopBtn) takeTopBtn.onclick = takeUnwantedTop;

  const takeAllBtn = document.getElementById("takeAll");
  if (takeAllBtn) takeAllBtn.onclick = takeUnwantedAll;

  const discardBtn = document.getElementById("discard");
  if (discardBtn) discardBtn.onclick = discardSelected;

  const exitBtn = document.getElementById("exitBtn");
  if (exitBtn) exitBtn.onclick = ()=>{ if (confirm("Exit practice mode?")) location.href="./index.html"; };

  // Hand scroll + no select on swipe
  const handEl = document.getElementById("hand");
  if (handEl){
    handEl.scrollLeft = state.handScrollLeft;
    enableDragScroll(handEl, "handScrollLeft");

    // tap vs swipe selection guard per-card
    handEl.querySelectorAll("[data-card]").forEach(el=>{
      const g = makeTapGuard();
      el.addEventListener("pointerdown", (e)=>markDown(g,e));
      el.addEventListener("pointermove", (e)=>markMove(g,e));
      el.addEventListener("pointerup", ()=>{
        if (g.moved) return; // swiping => no selection
        toggleSelect(el.getAttribute("data-card"));
      });
    });

    bindScrubber(document.getElementById("handScrubber"), handEl, "handScrollLeft");
  }

  // Peek strip scroll + scrubber
  const peekEl = document.getElementById("peekStrip");
  if (peekEl){
    peekEl.scrollLeft = state.peekScrollLeft;
    enableDragScroll(peekEl, "peekScrollLeft");
    bindScrubber(document.getElementById("peekScrubber"), peekEl, "peekScrollLeft");
  }
}

// slider helper
function bindScrubber(rangeEl, scrollerEl, rememberKey){
  if (!rangeEl || !scrollerEl) return;

  const update = ()=>{
    const max = Math.max(0, scrollerEl.scrollWidth - scrollerEl.clientWidth);
    rangeEl.max = String(max);
    rangeEl.value = String(scrollerEl.scrollLeft);
  };

  rangeEl.addEventListener("input", ()=>{
    scrollerEl.scrollLeft = Number(rangeEl.value);
    if (rememberKey) state[rememberKey] = scrollerEl.scrollLeft;
  });

  scrollerEl.addEventListener("scroll", ()=>{
    if (rememberKey) state[rememberKey] = scrollerEl.scrollLeft;
    update();
  }, {passive:true});

  window.addEventListener("resize", update);
  setTimeout(update, 0);
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