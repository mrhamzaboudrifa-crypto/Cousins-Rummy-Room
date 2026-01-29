/* Cousins Rummy Room — PRACTICE MODE (Bots)
   Fixes included:
   - Hand collapses/expands with arrow (so you can see unwanted pile)
   - Swipe never fights your finger: tap vs swipe detection
   - Unwanted pile shows TOP physical card; tap opens slider of whole pile
   - No snap-back: render loop only renders when needed
*/

const app = document.getElementById("app");

// ---------- Utilities ----------
const SUITS = ["♠","♥","♦","♣"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const SUIT_COLOR = (s) => (s==="♥"||s==="♦") ? "red" : "black";
const rankIndex = (r)=>RANKS.indexOf(r);
const clamp = (n,a,b)=>Math.max(a,Math.min(b,n));
const now = ()=>Date.now();
const escapeHtml = (s)=>(s||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const uid = ()=>Math.random().toString(36).slice(2,10);

// scoring: 10,J,Q,K,A => 10 points, below => 5 points
const RANK_VALUE = (r)=>(r==="A"||r==="10"||r==="J"||r==="Q"||r==="K")?10:5;
const pointsOfCards = (cards)=>cards.reduce((sum,c)=>sum+RANK_VALUE(c.r),0);
const cardLabel = (c)=>`${c.r}${c.s}`;

function parseParams(){
  const p=new URLSearchParams(location.search);
  const bots=clamp(parseInt(p.get("bots")||"1",10),1,3);
  const difficulty=(p.get("difficulty")||"easy").toLowerCase();
  const diff=["easy","mid","pro","goat"].includes(difficulty)?difficulty:"easy";
  return {bots,difficulty:diff};
}
const {bots:BOT_COUNT,difficulty:BOT_DIFFICULTY}=parseParams();

// ---------- Game State ----------
const state={
  dealerIndex:0,
  turnIndex:0,
  phase:"DRAW",             // DRAW -> MELD -> DISCARD
  turnMsLeft:60000,
  turnTimer:null,

  deck:[],
  unwanted:[],
  peekOpen:false,
  peekIndex:-1,

  players:[],
  selectedIds:new Set(),

  // rule: must lay at least 1 meld this round before adding to any meld
  laidMeldThisTurn:false,

  // UI helpers
  handOpen:false,
  handScrollLeft:0,
  peekScrollLeft:0,
  lastDrawnId:null,
  modal:null,

  uiNeedsRender:true
};

// ---------- Deck ----------
function makeDeck(){
  const deck=[];
  for(const s of SUITS){
    for(const r of RANKS){
      deck.push({id:uid(), r, s});
    }
  }
  for(let i=deck.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [deck[i],deck[j]]=[deck[j],deck[i]];
  }
  return deck;
}

// ---------- Meld validation ----------
function isValidSet(cards){
  if(cards.length<3) return false;
  const r=cards[0].r;
  return cards.every(c=>c.r===r);
}
function isValidRun(cards){
  if(cards.length<3) return false;
  const suit=cards[0].s;
  if(!cards.every(c=>c.s===suit)) return false;

  // A low
  const idx=cards.map(c=>rankIndex(c.r)).sort((a,b)=>a-b);
  const consecutiveLow=idx.every((v,i)=>i===0||v===idx[i-1]+1);
  if(consecutiveLow) return true;

  // A high (Q-K-A etc)
  if(!cards.some(c=>c.r==="A")) return false;
  const idxHigh=cards.map(c=>(c.r==="A"?13:rankIndex(c.r))).sort((a,b)=>a-b);
  return idxHigh.every((v,i)=>i===0||v===idxHigh[i-1]+1);
}
function validateMeld(cards){
  if(cards.length<3) return {ok:false, reason:"Meld must be 3+ cards."};
  if(isValidSet(cards)) return {ok:true, type:"set"};
  if(isValidRun(cards)) return {ok:true, type:"run"};
  return {ok:false, reason:"Not a valid set or run."};
}

// ---------- Players ----------
function makePlayers(){
  const youName = localStorage.getItem("crr_name") || "You";
  const names = ["Alice","Mike","John","Med","Lisa","Zara","Omar","Tara","Nina"];
  const bots=[];
  let used=new Set([youName.toLowerCase()]);

  for(let i=0;i<BOT_COUNT;i++){
    let n=names.find(x=>!used.has(x.toLowerCase())) || `Bot${i+1}`;
    used.add(n.toLowerCase());
    bots.push({uid:`bot_${i}`, name:n, bot:true});
  }

  return [{uid:"me", name:youName, bot:false}, ...bots].map(p=>({
    ...p,
    hand:[],
    melds:[],
    score:0,
    mustLayMeldFirst:true
  }));
}

function curPlayer(){ return state.players[state.turnIndex]; }
function mePlayer(){ return state.players.find(p=>p.uid==="me"); }
function isMyTurn(){ return curPlayer().uid==="me"; }

// ---------- Deal (7 cards each, next to dealer gets 8) ----------
function deal(){
  state.dealerIndex=Math.floor(Math.random()*state.players.length);
  const next=(state.dealerIndex+1)%state.players.length;

  for(let i=0;i<state.players.length;i++){
    const count=(i===next)?8:7;
    for(let k=0;k<count;k++){
      state.players[i].hand.push(state.deck.pop());
    }
  }

  // start unwanted with 1 card
  state.unwanted.push(state.deck.pop());
  state.peekOpen=false;
  state.peekIndex=state.unwanted.length-1;
  state.peekScrollLeft=999999;

  // first turn: clockwise from dealer
  state.turnIndex=next;
  state.phase="DRAW";
  state.selectedIds.clear();
  state.laidMeldThisTurn=false;
  state.turnMsLeft=60000;
}
// ---------- Turn timer ----------
function stopTurnTimer(){
  if(state.turnTimer){
    clearInterval(state.turnTimer);
    state.turnTimer=null;
  }
}
function startTurnTimer(){
  stopTurnTimer();
  const start=now();
  const startLeft=state.turnMsLeft;

  state.turnTimer=setInterval(()=>{
    const elapsed=now()-start;
    state.turnMsLeft=clamp(startLeft-elapsed,0,60000);
    if(state.turnMsLeft===0) onTimeoutAutoMove();
    requestRender();
  },250);
}

function nextTurnIndex(){ return (state.turnIndex+1)%state.players.length; }

function endTurn(){
  state.selectedIds.clear();
  state.laidMeldThisTurn=false;
  state.phase="DRAW";
  state.turnIndex=nextTurnIndex();
  state.turnMsLeft=60000;
  startTurnTimer();
  requestRender();
  if(curPlayer().bot) setTimeout(botAct,350);
}

function autoDrawFromDeck(p){
  if(state.deck.length===0) return;
  const c=state.deck.pop();
  c._justDrew=true;
  state.lastDrawnId=c.id;
  p.hand.unshift(c);              // FRONT
  state.phase="MELD";
}

function autoRandomDiscard(p){
  if(!p.hand.length) return;
  const idx=Math.floor(Math.random()*p.hand.length);
  const [c]=p.hand.splice(idx,1);
  state.unwanted.push(c);
  state.peekOpen=false;
  state.peekIndex=state.unwanted.length-1;
  state.peekScrollLeft=999999;
}

function onTimeoutAutoMove(){
  stopTurnTimer();
  const p=curPlayer();
  if(state.phase==="DRAW") autoDrawFromDeck(p);
  if(state.phase!=="DRAW") autoRandomDiscard(p);
  endTurn();
}

// ---------- Render scheduling ----------
function requestRender(){ state.uiNeedsRender=true; }
function renderLoopTick(){
  if(!state.uiNeedsRender) return;
  state.uiNeedsRender=false;
  renderGame();
}

// ---------- Selection ----------
function toggleSelect(cardId){
  if(!isMyTurn()) return;
  const me=mePlayer();
  if(!me.hand.find(c=>c.id===cardId)) return;

  if(state.selectedIds.has(cardId)) state.selectedIds.delete(cardId);
  else state.selectedIds.add(cardId);

  requestRender();
}
function getSelectedCardsFromHand(){
  const me=mePlayer();
  return [...state.selectedIds].map(id=>me.hand.find(c=>c.id===id)).filter(Boolean);
}

// ---------- Actions ----------
function clearJustDrewSoon(){
  setTimeout(()=>{
    const me=mePlayer();
    if(me) for(const c of me.hand) delete c._justDrew;
    state.lastDrawnId=null;
    requestRender();
  },900);
}

function drawFromDeck(){
  if(!isMyTurn()||state.phase!=="DRAW") return;
  const me=mePlayer();
  if(state.deck.length===0) return;

  const c=state.deck.pop();
  c._justDrew=true;
  state.lastDrawnId=c.id;
  me.hand.unshift(c);             // FRONT
  state.phase="MELD";
  requestRender();
  clearJustDrewSoon();
}

function takeUnwantedTop(){
  if(!isMyTurn()||state.phase!=="DRAW") return;
  const me=mePlayer();
  if(!state.unwanted.length) return;

  const c=state.unwanted.pop();
  c._justDrew=true;
  state.lastDrawnId=c.id;
  me.hand.unshift(c);
  state.phase="MELD";
  state.peekOpen=false;
  state.peekIndex=state.unwanted.length-1;
  state.peekScrollLeft=999999;
  requestRender();
  clearJustDrewSoon();
}

function takeUnwantedAll(){
  if(!isMyTurn()||state.phase!=="DRAW") return;
  const me=mePlayer();
  if(!state.unwanted.length) return;

  const pile=state.unwanted.splice(0,state.unwanted.length);
  for(let i=pile.length-1;i>=0;i--) me.hand.unshift(pile[i]);

  state.phase="MELD";
  state.peekOpen=false;
  state.peekIndex=-1;
  state.peekScrollLeft=0;
  requestRender();
}

function layMeld(){
  if(!isMyTurn()||state.phase==="DRAW") return;
  const me=mePlayer();
  const cards=getSelectedCardsFromHand();
  const v=validateMeld(cards);
  if(!v.ok){ alert(v.reason); return; }

  const ids=new Set(cards.map(c=>c.id));
  me.hand=me.hand.filter(c=>!ids.has(c.id));
  me.melds.push(cards);

  me.mustLayMeldFirst=false;
  state.laidMeldThisTurn=true;
  state.selectedIds.clear();
  requestRender();
}

function discardSelected(){
  if(!isMyTurn()||state.phase==="DRAW") return;
  const me=mePlayer();
  if(state.selectedIds.size!==1){
    alert("Select exactly 1 card to discard.");
    return;
  }
  const id=[...state.selectedIds][0];
  const idx=me.hand.findIndex(c=>c.id===id);
  if(idx<0) return;

  const [c]=me.hand.splice(idx,1);
  state.unwanted.push(c);
  state.selectedIds.clear();
  state.peekOpen=false;
  state.peekIndex=state.unwanted.length-1;
  state.peekScrollLeft=999999;
  requestRender();

  if(me.hand.length===0){
    endRound(me.uid);
    return;
  }
  endTurn();
}

// ---------- Round scoring ----------
function endRound(winnerUid){
  stopTurnTimer();
  const winner=state.players.find(p=>p.uid===winnerUid);

  // winner only gets points for what they laid down
  winner.score += pointsOfCards(winner.melds.flat());

  // losers cancellation logic
  for(const p of state.players){
    if(p.uid===winnerUid) continue;

    const laid=p.melds.flat();
    let laidTokens=laid.map(c=>RANK_VALUE(c.r));
    const handVals=p.hand.map(c=>RANK_VALUE(c.r));

    for(const hv of handVals){
      if(hv===10){
        const i10=laidTokens.indexOf(10);
        if(i10>=0){ laidTokens.splice(i10,1); continue; }
        const i5a=laidTokens.indexOf(5);
        if(i5a>=0){
          laidTokens.splice(i5a,1);
          const i5b=laidTokens.indexOf(5);
          if(i5b>=0) laidTokens.splice(i5b,1);
        }
      }else{
        const i5=laidTokens.indexOf(5);
        if(i5>=0) laidTokens.splice(i5,1);
      }
    }

    const laidTotal=pointsOfCards(laid);
    const remainingLaidTotal=laidTokens.reduce((a,b)=>a+b,0);
    const cancelledValue=laidTotal-remainingLaidTotal;

    const handTotal=pointsOfCards(p.hand);
    const uncancelled=Math.max(0, handTotal - cancelledValue);
    p.score -= uncancelled;
  }

  alert(`${winner.name} won the round!`);
  startNewRound();
}

function startNewRound(){
  state.deck=makeDeck();
  state.unwanted=[];
  state.selectedIds.clear();
  state.peekOpen=false;
  state.peekIndex=-1;
  state.handScrollLeft=0;
  state.peekScrollLeft=0;
  state.laidMeldThisTurn=false;

  for(const p of state.players){
    p.hand=[];
    p.melds=[];
    p.mustLayMeldFirst=true;
  }

  deal();
  startTurnTimer();
  requestRender();
  if(curPlayer().bot) setTimeout(botAct,350);
}

// ---------- Bot AI (simple stable) ----------
function botAct(){
  const p=curPlayer();
  if(!p.bot) return;

  if(state.phase==="DRAW"){
    autoDrawFromDeck(p);
    requestRender();
    setTimeout(()=>botMeldAndDiscard(p),450);
    return;
  }
  botMeldAndDiscard(p);
}

function removeFromHand(p,cards){
  const ids=new Set(cards.map(c=>c.id));
  p.hand=p.hand.filter(c=>!ids.has(c.id));
}

function botTryLayMeld(p){
  // try set first
  const byRank=new Map();
  for(const c of p.hand){
    if(!byRank.has(c.r)) byRank.set(c.r,[]);
    byRank.get(c.r).push(c);
  }
  for(const [,arr] of byRank){
    if(arr.length>=3){
      const meld=arr.slice(0, Math.min(4,arr.length));
      removeFromHand(p,meld);
      p.melds.push(meld);
      p.mustLayMeldFirst=false;
      state.laidMeldThisTurn=true;
      return true;
    }
  }
  return false;
}

function botDiscard(p){
  if(!p.hand.length) return;
  const [c]=p.hand.splice(Math.floor(Math.random()*p.hand.length),1);
  state.unwanted.push(c);
  state.peekOpen=false;
  state.peekIndex=state.unwanted.length-1;
  state.peekScrollLeft=999999;

  if(p.hand.length===0){ endRound(p.uid); return; }
  endTurn();
}

function botMeldAndDiscard(p){
  if(state.phase!=="MELD") return;
  botTryLayMeld(p);
  botDiscard(p);
}
// ---------- UI ----------
function formatMs(ms){ return `${Math.ceil(ms/1000)}s`; }
function isJustDrawn(c){ return c && (c._justDrew || c.id===state.lastDrawnId); }

function cardHTML(c,{selectable=false,selected=false}={}){
  const cls=["card",SUIT_COLOR(c.s)];
  if(selected) cls.push("sel");
  const click=selectable?`data-card="${c.id}"`:"";
  return `
    <div class="${cls.join(" ")}" ${click}>
      <div class="corner tl">${escapeHtml(c.r)}<br>${escapeHtml(c.s)}</div>
      <div class="pip">${escapeHtml(c.s)}</div>
      <div class="corner br">${escapeHtml(c.r)}<br>${escapeHtml(c.s)}</div>
    </div>
  `;
}

function renderGame(){
  const me=mePlayer();
  const cur=curPlayer();
  const others=state.players.filter(p=>p.uid!=="me");
  const topUnwanted=state.unwanted[state.unwanted.length-1];

  app.innerHTML=`
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
          <div style="font-weight:900; font-size:18px;">
            ${state.turnMsLeft<=15000 ? `<span class="danger">${formatMs(state.turnMsLeft)}</span>` : formatMs(state.turnMsLeft)}
          </div>
        </div>

        <div class="panel gameMain">

          <div class="seatRow" id="seatRow">
            ${others.map(p=>{
              const active=(p.uid===cur.uid)?"activeTurn":"";
              return `
                <div class="seatBox ${active}">
                  <div><b>${escapeHtml(p.name)}</b></div>
                  <div class="small">Cards left: ${p.hand.length}</div>
                  <div class="small">Score: ${p.score}</div>
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
                <div class="back"></div>
                <div class="label">TAP</div>
              </div>
              <div class="hint">Tap the deck to draw 1</div>
            </div>

            <div class="pileBox">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <b>Unwanted</b><span class="small">${state.unwanted.length} cards</span>
              </div>

              <div style="display:flex;justify-content:center; margin-top:8px;">
                ${
                  topUnwanted
                    ? `<div id="unwantedTopTap" style="cursor:pointer;">${cardHTML(topUnwanted)}</div>`
                    : `<div class="small">Empty</div>`
                }
              </div>

              <div class="hint">${topUnwanted ? "Tap the top card to peek the whole pile" : ""}</div>

              <div class="peekWrap">
                <div class="peekStrip" id="peekStrip" style="display:${state.peekOpen ? "flex":"none"}">
                  ${state.unwanted.map((c,i)=>{
                    const active=(i===state.peekIndex)?"active":"";
                    return `<div class="peekCard ${active}" data-peek="${i}">${cardHTML(c)}</div>`;
                  }).join("")}
                </div>
              </div>

              <div class="btnRow" style="margin-top:10px;">
                <button class="btn cyan" id="takeTop" ${(!isMyTurn()||state.phase!=="DRAW"||!topUnwanted)?"disabled":""}>Take Top</button>
                <button class="btn" id="takeAll" ${(!isMyTurn()||state.phase!=="DRAW"||!topUnwanted)?"disabled":""}>Take All</button>
              </div>

            </div>
          </div>

          <div class="meldTray">
            <div class="meldTrayHead">
              <b>Your melds</b>
              <span class="small">Score: <b>${me.score}</b></span>
            </div>
            <div class="meldTrayBody">
              ${
                me.melds.length
                  ? me.melds.map((meld,idx)=>`
                      <div class="meldBlock">
                        <div class="small">Meld ${idx+1}</div>
                        <div style="display:flex; gap:6px; margin-top:6px;">
                          ${meld.map(c=>cardHTML(c)).join("")}
                        </div>
                      </div>
                    `).join("")
                  : `<div class="small">No melds yet…</div>`
              }
            </div>
          </div>

        </div>

        <div class="handBar">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <b>Your hand</b>
              <div class="small">${state.handOpen ? "Swipe left/right" : "Collapsed (tap ▲) so you can see unwanted"}</div>
            </div>

            <button class="btn" id="toggleHand" style="width:auto; padding:10px 12px;">
              ${state.handOpen ? "▼" : "▲"}
            </button>
          </div>

          <div id="handWrap" style="display:${state.handOpen ? "block":"none"};">
            <div id="hand">
              ${me.hand.map(c=>{
                const selected = state.selectedIds.has(c.id);
                const glow = selected || isJustDrawn(c);
                return cardHTML(c,{selectable:true, selected:glow});
              }).join("")}
            </div>

            <div class="btnRow">
              <button class="btn cyan" id="layMeld" ${(!isMyTurn()||state.phase==="DRAW")?"disabled":""}>Lay Meld</button>
              <button class="btn" id="discard" ${(!isMyTurn()||state.phase==="DRAW")?"disabled":""}>Discard (1)</button>
            </div>
          </div>

        </div>

      </div>
    </div>
  `;

  // ---------- Wire events ----------
  document.getElementById("deckTap").onclick = drawFromDeck;

  document.getElementById("exitBtn").onclick = ()=>{
    if(confirm("Exit practice mode?")) location.href="./index.html";
  };

  document.getElementById("toggleHand").onclick = ()=>{
    state.handOpen = !state.handOpen;
    requestRender();
    setTimeout(()=>{
      const handEl=document.getElementById("hand");
      if(handEl && state.handOpen) handEl.scrollLeft = state.handScrollLeft;
    },0);
  };

  const topTap=document.getElementById("unwantedTopTap");
  if(topTap){
    topTap.onclick=()=>{
      state.peekOpen = !state.peekOpen;
      state.peekIndex = state.unwanted.length-1;
      if(state.peekOpen) state.peekScrollLeft = 999999;
      requestRender();
    };
  }

  const peekStrip=document.getElementById("peekStrip");
  if(peekStrip){
    peekStrip.scrollLeft = state.peekScrollLeft;
    peekStrip.addEventListener("scroll", ()=>{ state.peekScrollLeft = peekStrip.scrollLeft; }, {passive:true});
    peekStrip.querySelectorAll("[data-peek]").forEach(el=>{
      el.onclick=()=>{
        state.peekIndex=parseInt(el.getAttribute("data-peek"),10);
        requestRender();
      };
    });
  }

  const takeTop=document.getElementById("takeTop");
  if(takeTop) takeTop.onclick = takeUnwantedTop;

  const takeAll=document.getElementById("takeAll");
  if(takeAll) takeAll.onclick = takeUnwantedAll;

  const layBtn=document.getElementById("layMeld");
  if(layBtn) layBtn.onclick = layMeld;

  const discBtn=document.getElementById("discard");
  if(discBtn) discBtn.onclick = discardSelected;

  // ---------- Hand swipe vs tap (NO fighting) ----------
  const handEl=document.getElementById("hand");
  if(handEl){
    handEl.scrollLeft = state.handScrollLeft;
    handEl.addEventListener("scroll", ()=>{ state.handScrollLeft = handEl.scrollLeft; }, {passive:true});

    let down=null;
    handEl.onpointerdown=(e)=>{
      const cardEl=e.target.closest("[data-card]");
      if(!cardEl) return;
      down={id:cardEl.getAttribute("data-card"), x:e.clientX, y:e.clientY};
    };
    handEl.onpointerup=(e)=>{
      if(!down) return;
      const dx=Math.abs(e.clientX-down.x);
      const dy=Math.abs(e.clientY-down.y);
      if(dx>10 || dy>10){ down=null; return; } // swipe, not tap
      toggleSelect(down.id);
      down=null;
    };
    handEl.onpointercancel=()=>{ down=null; };
  }
}

// ---------- Boot ----------
function boot(){
  state.players = makePlayers();
  state.deck = makeDeck();
  state.unwanted = [];
  deal();
  startTurnTimer();
  renderGame();

  // Render only when needed (prevents snap-back + lag)
  setInterval(renderLoopTick, 120);

  if(curPlayer().bot) setTimeout(botAct,350);
}

boot();