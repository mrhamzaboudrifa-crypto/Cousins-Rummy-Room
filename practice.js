// Practice vs Bots (local) — stable rendering + proper mobile behavior
// Turn: must Draw (deck OR unwanted) -> may lay meld(s) -> must Discard 1 to end.
// Unwanted: you can peek; to take deeper card you must Take All.
// Meld validation: Set 3-4 of a kind, Run same suit consecutive, Ace low/high.

const app = document.getElementById("app");

const SUITS = ["♠","♥","♦","♣"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

function makeDeck(){
  let id=0, d=[];
  for (const s of SUITS) for (const r of RANKS) d.push({id:`c${id++}`, r, s});
  return d;
}
function shuffle(a){
  for (let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
const rankNum = (r)=> r==="A"?1: r==="J"?11: r==="Q"?12: r==="K"?13: Number(r);
const isRed = (s)=> (s==="♥" || s==="♦");

function validSet(cards){
  if (cards.length<3 || cards.length>4) return false;
  const rr = cards[0].r;
  return cards.every(c=>c.r===rr);
}
function consecutive(nums){
  for (let i=1;i<nums.length;i++) if (nums[i]!==nums[i-1]+1) return false;
  return true;
}
function validRun(cards){
  if (cards.length<3) return false;
  const suit = cards[0].s;
  if (!cards.every(c=>c.s===suit)) return false;

  let nums = cards.map(c=>rankNum(c.r)).sort((a,b)=>a-b);
  for (let i=1;i<nums.length;i++) if (nums[i]===nums[i-1]) return false;
  if (consecutive(nums)) return true;

  // Ace high
  if (nums.includes(1)){
    const alt = nums.map(n=>n===1?14:n).sort((a,b)=>a-b);
    if (consecutive(alt)) return true;
  }
  return false;
}
function validateMeld(cards){
  if (cards.length<3) return {ok:false, why:"Select at least 3 cards."};
  if (validSet(cards)) return {ok:true, kind:"set"};
  if (validRun(cards)) return {ok:true, kind:"run"};
  return {ok:false, why:"Not a valid set or run."};
}

function qs(){
  const p = new URLSearchParams(location.search);
  return {
    bots: Math.min(3, Math.max(1, Number(p.get("bots")||"1"))),
    difficulty: (p.get("difficulty")||"easy").toLowerCase()
  };
}

let audioReady=false, ac=null;
function unlockAudio(){
  if (audioReady) return;
  audioReady=true;
  ac = new (window.AudioContext || window.webkitAudioContext)();
}
function chime(){
  if (!audioReady || !ac) return;
  const now = ac.currentTime;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type="sine";
  o.frequency.setValueAtTime(523.25, now);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.06, now+0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, now+0.18);
  o.connect(g); g.connect(ac.destination);
  o.start(now); o.stop(now+0.2);
}
function doubleChime(){ chime(); setTimeout(chime, 160); }

const state = {
  screen: "setup",
  bots: qs().bots,
  difficulty: ["easy","mid","pro","goat"].includes(qs().difficulty) ? qs().difficulty : "easy",
  deck: [],
  unwanted: [],
  players: [],
  dealer: 0,
  turn: 0,
  phase: "draw", // draw -> play -> discard
  selected: new Set(),
  peekIndex: 0,
  turnEndsAt: 0,
  warned30: false,
  warned15: false,
  didDraw: false,
  // rendering control
  uiNeedsRender: true,
};

function botNames(n){ return ["Alice","Mike","John"].slice(0,n); }
function cardLabel(c){ return `${c.r}${c.s}`; }

function requestRender(){ state.uiNeedsRender = true; }

function render(){
  state.uiNeedsRender = false;
  if (state.screen==="setup") return renderSetup();
  return renderGame();
}

function renderSetup(){
  const name = localStorage.getItem("crr_name") || "You";
  app.innerHTML = `
    <div class="safe">
      <div class="shell">
        <div class="title">Cousins</div>
        <div class="subtitle">Rummy Room</div>
        <div class="underline"></div>

        <div class="panel grid">
          <div><b>Practice vs Bots</b><div class="small">Default difficulty is Easy</div></div>

          <div>
            <div class="small">How many bots?</div>
            <div class="pills">
              ${[1,2,3].map(n=>`<div class="pill ${state.bots===n?"active":""}" data-b="${n}">${n} bot${n>1?"s":""}</div>`).join("")}
            </div>
          </div>

          <div>
            <div class="small">Difficulty</div>
            <div class="pills">
              ${["easy","mid","pro","goat"].map(d=>`<div class="pill ${state.difficulty===d?"active":""}" data-d="${d}">${d.toUpperCase()}</div>`).join("")}
            </div>
            <div class="note">Easy is beatable. Pro/GOAT will make you work hard.</div>
          </div>

          <button class="btn cyan" id="startBtn">Start Practice</button>
          <button class="btn" id="backBtn">Back to Lobby</button>
        </div>
      </div>
    </div>
  `;

  document.querySelectorAll("[data-b]").forEach(el=>{
    el.onclick=()=>{ state.bots=Number(el.dataset.b); requestRender(); };
  });
  document.querySelectorAll("[data-d]").forEach(el=>{
    el.onclick=()=>{ state.difficulty=el.dataset.d; requestRender(); };
  });

  document.getElementById("startBtn").onclick=()=>{
    unlockAudio();
    startGame(name);
  };
  document.getElementById("backBtn").onclick=()=>location.href="index.html";
}
function startGame(youName){
  state.deck = shuffle(makeDeck());
  state.unwanted = [];
  state.players = [
    {id:0, name: youName || "You", isBot:false, hand:[], melds:[]},
    ...botNames(state.bots).map((n,i)=>({id:i+1, name:n, isBot:true, hand:[], melds:[]}))
  ];

  state.dealer = Math.floor(Math.random()*state.players.length);
  const left = (state.dealer+1)%state.players.length;

  // Deal 7 each
  for (let i=0;i<7;i++){
    for (const p of state.players) p.hand.push(state.deck.pop());
  }
  // Left of dealer gets 8
  state.players[left].hand.push(state.deck.pop());

  // start unwanted
  state.unwanted.push(state.deck.pop());

  beginTurn(left);
  state.screen = "game";
  requestRender();
  maybeBot();
}

function beginTurn(i){
  state.turn=i;
  state.phase="draw";
  state.selected.clear();
  state.peekIndex=0;
  state.warned30=false;
  state.warned15=false;
  state.didDraw=false;
  state.turnEndsAt = Date.now()+60000;
}

function isYourTurn(){ return state.turn===0; }
function currentPlayer(){ return state.players[state.turn]; }

function renderGame(){
  const me = state.players[0];

  // timer (display only; doesn't force full rerender constantly)
  const tLeft = Math.max(0, state.turnEndsAt - Date.now());
  const sec = Math.ceil(tLeft/1000);
  const danger = sec<=30 ? "danger" : "";

  const idx = Math.min(state.peekIndex, Math.max(0, state.unwanted.length-1));
  const peek = state.unwanted.length ? state.unwanted[state.unwanted.length-1-idx] : null;
  const viewingTop = idx===0;

  app.innerHTML = `
    <div class="safe">
      <div class="shell">
        <div class="title">Cousins</div>
        <div class="subtitle">Rummy Room</div>
        <div class="underline"></div>

        <div class="panel row">
          <div>
            <b>Practice</b>
            <span class="small">Bots: ${state.bots} • ${state.difficulty.toUpperCase()} • Dealer: ${state.players[state.dealer].name}</span>
          </div>
          <div class="timerBox ${danger}" id="timerText">Turn: ${sec}s</div>
        </div>

        <div class="panel gameArea">
          <div class="seatRow">
            ${state.players.slice(1).map(p=>`
              <div class="seatBox">
                <b>${p.name}</b> <span class="small">${p.id===state.turn ? "• TURN" : ""}</span>
                <div class="small">Cards left: ${p.hand.length}</div>
              </div>
            `).join("")}
          </div>

          <div class="centerRow">
            <div class="pileBox">
              <b>Deck</b>
              <div class="small">${state.deck.length} left</div>
              <div style="height:10px"></div>
              <button class="btn" id="drawBtn" ${(!isYourTurn() || state.phase!=="draw")?"disabled":""}>Draw</button>
            </div>

            <div class="pileBox">
              <b>Unwanted</b>
              <div class="small">${state.unwanted.length} cards</div>
              <div style="height:10px"></div>
              <div class="small">Peek: ${peek ? cardLabel(peek) : "—"} ${idx?`(deep +${idx})`:"(top)"}</div>
              <div style="height:10px"></div>
              <div class="btnRow">
                <button class="btn" id="prevBtn" ${(!isYourTurn() || state.phase!=="draw" || state.unwanted.length<2)?"disabled":""}>◀</button>
                <button class="btn" id="nextBtn" ${(!isYourTurn() || state.phase!=="draw" || state.unwanted.length<2)?"disabled":""}>▶</button>
              </div>
              <div style="height:10px"></div>
              <div class="btnRow">
                <button class="btn cyan" id="takeTopBtn" ${(!isYourTurn() || state.phase!=="draw" || !peek || !viewingTop)?"disabled":""}>Take Top</button>
                <button class="btn" id="takeAllBtn" ${(!isYourTurn() || state.phase!=="draw" || !peek)?"disabled":""}>Take All</button>
              </div>
              ${(!viewingTop && peek) ? `<div class="note" style="margin-top:8px;">To take a deeper card, you must Take All.</div>` : ``}
            </div>
          </div>

          <div class="seatBox">
            <b>Your melds</b>
            <div class="small">Select cards → Lay Meld (min 3, blocks invalid)</div>
            <div class="cardsLine">
              ${me.melds.length
                ? me.melds.map(m=>`<span class="mini">${m.map(cardLabel).join(" ")}</span>`).join("")
                : `<span class="small">None yet</span>`
              }
            </div>
          </div>

          <div class="seatBox">
            <div class="row">
              <div>
                <b>${isYourTurn() ? "Your turn" : currentPlayer().name + "'s turn"}</b>
                <div class="small">Phase: ${state.phase.toUpperCase()}</div>
              </div>
              <button class="btn" id="exitBtn">Exit</button>
            </div>

            <div style="height:10px"></div>
            <div class="hand" id="hand">
              ${me.hand.map(c=>`
                <div class="card ${isRed(c.s) ? "red" : "black"} ${state.selected.has(c.id)?"sel":""}" data-id="${c.id}">
                  <div class="corner tl"><div>${c.r}</div><div>${c.s}</div></div>
                  <div class="pip">${c.s}</div>
                  <div class="corner br"><div>${c.r}</div><div>${c.s}</div></div>
                </div>
              `).join("")}
            </div>

            <div style="height:10px"></div>
            <div class="btnRow">
              <button class="btn cyan" id="layBtn" ${(!isYourTurn() || state.phase==="draw")?"disabled":""}>Lay Meld</button>
              <button class="btn" id="discardBtn" ${(!isYourTurn() || state.phase!=="discard")?"disabled":""}>Discard (1)</button>
            </div>
            <div class="note" style="margin-top:8px;">You must Draw/Take before discarding.</div>
          </div>
        </div>
      </div>
    </div>
  `;

  // --- events ---
  document.getElementById("exitBtn").onclick=()=>location.href="index.html";

  document.getElementById("drawBtn")?.addEventListener("click", ()=>{
    if (!isYourTurn() || state.phase!=="draw") return;
    drawFromDeck(0);
    state.phase="discard";
    requestRender();
  });

  document.getElementById("prevBtn")?.addEventListener("click", ()=>{
    if (!isYourTurn() || state.phase!=="draw") return;
    state.peekIndex = Math.min(state.peekIndex+1, Math.max(0,state.unwanted.length-1));
    requestRender();
  });

  document.getElementById("nextBtn")?.addEventListener("click", ()=>{
    if (!isYourTurn() || state.phase!=="draw") return;
    state.peekIndex = Math.max(0, state.peekIndex-1);
    requestRender();
  });

  document.getElementById("takeTopBtn")?.addEventListener("click", ()=>{
    if (!isYourTurn() || state.phase!=="draw") return;
    if (state.peekIndex !== 0) return;
    takeTop(0);
    state.phase="discard";
    requestRender();
  });

  document.getElementById("takeAllBtn")?.addEventListener("click", ()=>{
    if (!isYourTurn() || state.phase!=="draw") return;
    takeAll(0);
    state.phase="discard";
    requestRender();
  });

  document.querySelectorAll(".card[data-id]").forEach(el=>{
    el.onclick=()=>{
      if (!isYourTurn()) return;
      if (state.phase==="draw") return;
      const id = el.dataset.id;
      if (state.selected.has(id)) state.selected.delete(id);
      else state.selected.add(id);
      requestRender();
    };
  });

  document.getElementById("layBtn")?.addEventListener("click", ()=>{
    if (!isYourTurn() || state.phase==="draw") return;
    layMeldHuman();
  });

  document.getElementById("discardBtn")?.addEventListener("click", ()=>{
    if (!isYourTurn() || state.phase!=="discard") return;
    discardOneHuman();
  });
}

function drawFromDeck(playerIndex){
  if (!state.deck.length){
    // reshuffle from unwanted except top? (simple: restart)
    state.deck = shuffle(makeDeck());
  }
  state.players[playerIndex].hand.push(state.deck.pop());
  state.didDraw = true;
}

function takeTop(playerIndex){
  const top = state.unwanted.pop();
  if (!top) return;
  state.players[playerIndex].hand.push(top);
  state.peekIndex = 0;
  state.didDraw = true;
}

function takeAll(playerIndex){
  if (!state.unwanted.length) return;
  while(state.unwanted.length){
    state.players[playerIndex].hand.push(state.unwanted.shift());
  }
  state.peekIndex = 0;
  state.didDraw = true;
}

function layMeldHuman(){
  const me = state.players[0];
  const cards = me.hand.filter(c=>state.selected.has(c.id));
  const v = validateMeld(cards);
  if (!v.ok){ alert(v.why); return; }
  if (v.kind==="set" && cards.length>4){ alert("Sets are max 4."); return; }

  me.melds.push(cards.slice());
  const remove = new Set(cards.map(c=>c.id));
  me.hand = me.hand.filter(c=>!remove.has(c.id));
  state.selected.clear();
  state.phase = "discard"; // still must discard
  requestRender();
}

function discardOneHuman(){
  const me = state.players[0];
  const cards = me.hand.filter(c=>state.selected.has(c.id));
  if (cards.length!==1){ alert("Select exactly 1 card to discard."); return; }
  const c = cards[0];
  me.hand = me.hand.filter(x=>x.id!==c.id);
  state.unwanted.push(c);
  state.selected.clear();

  // win check (practice restarts)
  if (me.hand.length===0){
    alert("You went out! Restarting practice hand.");
    state.screen="setup";
    requestRender();
    return;
  }

  endTurn();
}

function endTurn(){
  const next = (state.turn+1)%state.players.length;
  beginTurn(next);
  requestRender();
  maybeBot();
}

/** ---------------- Bots (simpler, stable) ---------------- */

function skill(){
  if (state.difficulty==="easy") return 0.45;
  if (state.difficulty==="mid") return 0.65;
  if (state.difficulty==="pro") return 0.82;
  return 0.90; // GOAT (still beatable)
}

function maybeBot(){
  const p = currentPlayer();
  if (!p.isBot) return;
  setTimeout(()=>botTurn(), 520);
}

function botTurn(){
  const i = state.turn;
  const p = state.players[i];
  if (!p || !p.isBot) return;

  // 1) Draw decision
  const s = skill();
  const top = state.unwanted[state.unwanted.length-1] || null;

  if (top && Math.random()<s && topHelps(p.hand, top)){
    p.hand.push(state.unwanted.pop());
  } else {
    if (state.deck.length) p.hand.push(state.deck.pop());
  }

  // 2) Try meld (0-2 times depending on difficulty)
  const tries = state.difficulty==="easy" ? 0 : (state.difficulty==="mid" ? 1 : 2);
  for (let t=0; t<tries; t++){
    const meld = bestMeld(p.hand);
    if (!meld) break;
    p.melds.push(meld);
    const rm = new Set(meld.map(c=>c.id));
    p.hand = p.hand.filter(c=>!rm.has(c.id));
  }

  // 3) Discard
  const disc = chooseDiscard(p.hand);
  p.hand = p.hand.filter(c=>c.id!==disc.id);
  state.unwanted.push(disc);

  // bot win check
  if (p.hand.length===0){
    alert(`${p.name} went out! Restarting practice hand.`);
    state.screen="setup";
    requestRender();
    return;
  }

  endTurn();
}

function topHelps(hand, card){
  const sameRank = hand.filter(c=>c.r===card.r).length;
  if (sameRank>=2) return true;
  const adj = hand.some(c=>c.s===card.s && Math.abs(rankNum(c.r)-rankNum(card.r))===1);
  return adj;
}

function bestMeld(hand){
  // sets
  const byRank = {};
  for (const c of hand){
    byRank[c.r] = byRank[c.r] || [];
    byRank[c.r].push(c);
  }
  for (const r in byRank){
    const g = byRank[r];
    if (g.length>=3) return g.slice(0, Math.min(4, g.length));
  }

  // runs (simple)
  for (const s of SUITS){
    const suitCards = hand.filter(c=>c.s===s).sort((a,b)=>rankNum(a.r)-rankNum(b.r));
    if (suitCards.length<3) continue;
    let best=[], cur=[suitCards[0]];
    for (let i=1;i<suitCards.length;i++){
      const prev = rankNum(suitCards[i-1].r);
      const now  = rankNum(suitCards[i].r);
      if (now===prev+1) cur.push(suitCards[i]);
      else { if (cur.length>best.length) best=cur; cur=[suitCards[i]]; }
    }
    if (cur.length>best.length) best=cur;
    if (best.length>=3) return best;
  }

  return null;
}

function chooseDiscard(hand){
  if (hand.length===1) return hand[0];
  const s = skill();
  if (state.difficulty==="easy" && Math.random()>(s)) return hand[Math.floor(Math.random()*hand.length)];

  // discard least-connected card
  let worst = hand[0];
  let worstScore = Infinity;
  for (const c of hand){
    let score=0;
    for (const h of hand){
      if (h.id===c.id) continue;
      if (h.r===c.r) score+=2;
      if (h.s===c.s && Math.abs(rankNum(h.r)-rankNum(c.r))===1) score+=1;
    }
    // add imperfection so it's beatable
    score += (1-s) * Math.random()*3;
    if (score < worstScore){
      worstScore = score;
      worst = c;
    }
  }
  return worst;
}

/** ---------------- Timer (NO constant full re-render) ---------------- */

setInterval(()=>{
  if (state.screen!=="game") return;

  const tLeft = Math.max(0, state.turnEndsAt - Date.now());
  const sec = Math.ceil(tLeft/1000);

  // update only the timer text (no full render)
  const timer = document.getElementById("timerText");
  if (timer){
    timer.textContent = `Turn: ${sec}s`;
    if (sec<=30) timer.classList.add("danger");
    else timer.classList.remove("danger");
  }

  if (!state.warned30 && sec<=30){ state.warned30=true; chime(); }
  if (!state.warned15 && sec<=15){ state.warned15=true; doubleChime(); }

  if (sec<=0){
    // timeout: draw from deck if not drawn, then discard random
    const p = currentPlayer();
    if (!p) return;

    if (state.phase==="draw"){
      if (state.deck.length) p.hand.push(state.deck.pop());
    }
    if (p.hand.length){
      const c = p.hand[Math.floor(Math.random()*p.hand.length)];
      p.hand = p.hand.filter(x=>x.id!==c.id);
      state.unwanted.push(c);
    }
    endTurn();
  }

  // render only if requested by actions
  if (state.uiNeedsRender) render();
}, 250);

// boot
render();