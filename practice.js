// Practice vs Bots (local) — default easy, selectable 1–3 bots and Easy/Mid/Pro/GOAT
// Practice V1: draw/take unwanted + lay meld validation (sets/runs) + discard to end.
// Your special rule is included: you can peek unwanted; to take a deeper card you must Take All.

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

// Smooth subtle chimes (iPhone+Android) after first tap
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

// State
const state = {
  screen: "setup",
  bots: qs().bots,
  difficulty: ["easy","mid","pro","goat"].includes(qs().difficulty) ? qs().difficulty : "easy",
  deck: [],
  unwanted: [],
  players: [],
  dealer: 0,
  turn: 0,
  phase: "draw", // draw -> discard
  selected: new Set(),
  peekIndex: 0, // 0 = top
  turnEndsAt: 0,
  warned30: false,
  warned15: false,
  didDraw: false,
};

function label(c){ return `${c.r}${c.s}`; }
function botNames(n){ return ["Alice","Mike","John"].slice(0,n); }
function render(){
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
    el.onclick=()=>{ state.bots=Number(el.dataset.b); render(); };
  });
  document.querySelectorAll("[data-d]").forEach(el=>{
    el.onclick=()=>{ state.difficulty=el.dataset.d; render(); };
  });

  document.getElementById("startBtn").onclick=()=>{
    unlockAudio();
    startGame(name);
  };
  document.getElementById("backBtn").onclick=()=>{
    location.href = "index.html";
  };
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
  // Left of dealer gets 8 (your rule)
  state.players[left].hand.push(state.deck.pop());

  state.unwanted.push(state.deck.pop());
  beginTurn(left);
  state.screen="game";
  render();
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

function renderGame(){
  const me = state.players[0];
  const tLeft = Math.max(0, state.turnEndsAt - Date.now());
  const sec = Math.ceil(tLeft/1000);
  const danger = sec<=30 ? "danger" : "";

  const idx = Math.min(state.peekIndex, Math.max(0, state.unwanted.length-1));
  const peek = state.unwanted.length ? state.unwanted[state.unwanted.length-1-idx] : null;
  const takeTopDisabled = idx!==0;

  app.innerHTML = `
    <div class="safe">
      <div class="shell">
        <div class="title">Cousins</div>
        <div class="subtitle">Rummy Room</div>
        <div class="underline"></div>

        <div class="panel row">
          <div><b>Practice</b> <span class="small">Bots: ${state.bots} • ${state.difficulty.toUpperCase()}</span></div>
          <div class="timerBox ${danger}">Turn: ${sec}s</div>
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
              <div class="small">Peek: ${peek ? label(peek) : "—"} ${idx?`(deep +${idx})`:"(top)"}</div>
              <div style="height:10px"></div>
              <div class="btnRow">
                <button class="btn" id="prevBtn" ${(!isYourTurn() || state.phase!=="draw")?"disabled":""}>◀</button>
                <button class="btn" id="nextBtn" ${(!isYourTurn() || state.phase!=="draw")?"disabled":""}>▶</button>
              </div>
              <div style="height:10px"></div>
              <div class="btnRow">
                <button class="btn cyan" id="takeTopBtn" ${(!isYourTurn() || state.phase!=="draw" || takeTopDisabled || !peek)?"disabled":""}>Take Top</button>
                <button class="btn" id="takeAllBtn" ${(!isYourTurn() || state.phase!=="draw" || !peek)?"disabled":""}>Take All</button>
              </div>
              ${(!takeTopDisabled && peek) ? "" : `<div class="note" style="margin-top:8px;">To take a deeper card, you must Take All.</div>`}
            </div>
          </div>

          <div class="seatBox">
            <b>Your melds</b>
            <div class="small">Select cards → Lay Meld (min 3, blocks invalid)</div>
            <div class="cardsLine">
              ${me.melds.length ? me.melds.map(m=>`<span class="mini">${m.map(label).join(" ")}</span>`).join("") : `<span class="small">None yet</span>`}
            </div>
          </div>

          <div class="seatBox">
            <div class="row">
              <div><b>${isYourTurn() ? "Your turn" : state.players[state.turn].name + "'s turn"}</b>
                <div class="small">Phase: ${state.phase.toUpperCase()}</div>
              </div>
              <button class="btn" id="exitBtn">Exit</button>
            </div>

            <div style="height:10px"></div>
            <div class="hand" id="hand">
              ${me.hand.map(c=>`
                <div class="card ${state.selected.has(c.id)?"sel":""}" data-id="${c.id}">
                  <div>${c.r}</div>
                  <div style="font-size:22px;font-weight:900;">${c.s}</div>
                </div>
              `).join("")}
            </div>

            <div style="height:10px"></div>
            <div class="btnRow">
              <button class="btn cyan" id="layBtn" ${(!isYourTurn() || state.phase==="draw")?"disabled":""}>Lay Meld</button>
              <button class="btn" id="discardBtn" ${(!isYourTurn() || state.phase!=="discard")?"disabled":""}>Discard (1)</button>
            </div>
            <div class="note" style="margin-top:8px;">You must draw/take before discarding.</div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("exitBtn").onclick=()=>location.href="index.html";

  document.getElementById("drawBtn")?.addEventListener("click", ()=>drawFromDeck());
  document.getElementById("prevBtn")?.addEventListener("click", ()=>{
    if (state.peekIndex < state.unwanted.length-1) state.peekIndex++;
    render();
  });
  document.getElementById("nextBtn")?.addEventListener("click", ()=>{
    if (state.peekIndex > 0) state.peekIndex--;
    render();
  });

  document.getElementById("takeTopBtn")?.addEventListener("click", ()=>takeTop());
  document.getElementById("takeAllBtn")?.addEventListener("click", ()=>takeAll());

  document.querySelectorAll(".card[data-id]").forEach(el=>{
    el.onclick=()=>{
      if (!isYourTurn()) return;
      if (state.phase==="draw") return;
      const id=el.dataset.id;
      if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
      render();
    };
  });

  document.getElementById("layBtn")?.addEventListener("click", ()=>layMeld());
  document.getElementById("discardBtn")?.addEventListener("click", ()=>discardOne());
}

function drawFromDeck(){
  if (!isYourTurn() || state.phase!=="draw") return;
  const me = state.players[0];
  if (!state.deck.length) return;
  me.hand.push(state.deck.pop());
  state.didDraw=true;
  state.phase="discard";
  render();
}
function takeTop(){
  if (!isYourTurn() || state.phase!=="draw") return;
  const me = state.players[0];
  if (!state.unwanted.length) return;
  me.hand.push(state.unwanted.pop());
  state.didDraw=true;
  state.phase="discard";
  state.peekIndex=0;
  render();
}
function takeAll(){
  if (!isYourTurn() || state.phase!=="draw") return;
  const me = state.players[0];
  if (!state.unwanted.length) return;
  while(state.unwanted.length) me.hand.push(state.unwanted.shift());
  state.didDraw=true;
  state.phase="discard";
  state.peekIndex=0;
  render();
}

function layMeld(){
  if (!isYourTurn() || state.phase==="draw") return;
  const me = state.players[0];
  const cards = me.hand.filter(c=>state.selected.has(c.id));
  const v = validateMeld(cards);
  if (!v.ok) { alert(v.why); return; }
  if (v.kind==="set" && cards.length>4){ alert("Sets are max 4."); return; }
  me.melds.push(cards.slice());
  const remove = new Set(cards.map(c=>c.id));
  me.hand = me.hand.filter(c=>!remove.has(c.id));
  state.selected.clear();
  render();
}

function discardOne(){
  if (!isYourTurn() || state.phase!=="discard") return;
  const me = state.players[0];
  const cards = me.hand.filter(c=>state.selected.has(c.id));
  if (cards.length!==1){ alert("Select exactly 1 card to discard."); return; }
  const c = cards[0];
  me.hand = me.hand.filter(x=>x.id!==c.id);
  state.unwanted.push(c);
  state.selected.clear();
  endTurn();
}

function endTurn(){
  const next = (state.turn+1)%state.players.length;
  beginTurn(next);
  render();
  maybeBot();
}

function maybeBot(){
  const p = state.players[state.turn];
  if (!p || !p.isBot) return;
  setTimeout(()=>botAct(p), 450);
}

function botAct(p){
  const d = state.difficulty;
  const skill = d==="easy"?0.35 : d==="mid"?0.60 : d==="pro"?0.78 : 0.88;

  // draw choice
  if (Math.random() < skill && state.unwanted.length){
    const top = state.unwanted[state.unwanted.length-1];
    const helps = p.hand.some(h=>h.r===top.r) || p.hand.some(h=>h.s===top.s && Math.abs(rankNum(h.r)-rankNum(top.r))===1);
    if (helps && Math.random()<skill) p.hand.push(state.unwanted.pop());
    else p.hand.push(state.deck.pop());
  } else {
    p.hand.push(state.deck.pop());
  }

  // try lay meld sometimes
  if (Math.random() < skill){
    tryBotMeld(p, skill);
  }

  // discard
  const discard = pickDiscard(p, skill);
  p.hand = p.hand.filter(c=>c.id!==discard.id);
  state.unwanted.push(discard);

  const next = (state.turn+1)%state.players.length;
  beginTurn(next);
  render();
  maybeBot();
}

function tryBotMeld(p, skill){
  const byRank = {};
  for (const c of p.hand){
    byRank[c.r] = byRank[c.r] || [];
    byRank[c.r].push(c);
  }
  for (const r in byRank){
    const group = byRank[r];
    if (group.length>=3 && Math.random()<skill){
      const meld = group.slice(0, Math.min(4, group.length));
      p.melds.push(meld);
      const rm = new Set(meld.map(c=>c.id));
      p.hand = p.hand.filter(c=>!rm.has(c.id));
      return;
    }
  }

  for (const s of SUITS){
    const suitCards = p.hand.filter(c=>c.s===s).sort((a,b)=>rankNum(a.r)-rankNum(b.r));
    let best=[];
    let cur=[suitCards[0]];
    for (let i=1;i<suitCards.length;i++){
      if (rankNum(suitCards[i].r)===rankNum(suitCards[i-1].r)+1) cur.push(suitCards[i]);
      else { if (cur.length>best.length) best=cur; cur=[suitCards[i]]; }
    }
    if (cur.length>best.length) best=cur;
    if (best.length>=3 && Math.random()<skill){
      p.melds.push(best);
      const rm = new Set(best.map(c=>c.id));
      p.hand = p.hand.filter(c=>!rm.has(c.id));
      return;
    }
  }
}

function pickDiscard(p, skill){
  if (skill < 0.5){
    return p.hand[Math.floor(Math.random()*p.hand.length)];
  }
  let best = null, bestScore = -1;
  for (const c of p.hand){
    let score=0;
    for (const h of p.hand){
      if (h.id===c.id) continue;
      if (h.r===c.r) score+=2;
      if (h.s===c.s && Math.abs(rankNum(h.r)-rankNum(c.r))===1) score+=1;
    }
    const discardValue = 10 - score + (Math.random()*(1-skill));
    if (discardValue > bestScore){ bestScore=discardValue; best=c; }
  }
  return best || p.hand[0];
}

// Timer + auto-timeout
setInterval(()=>{
  if (state.screen!=="game") return;
  const sec = Math.ceil(Math.max(0, state.turnEndsAt-Date.now())/1000);

  if (!state.warned30 && sec<=30){ state.warned30=true; chime(); }
  if (!state.warned15 && sec<=15){ state.warned15=true; doubleChime(); }

  if (sec<=0){
    const p = state.players[state.turn];
    if (!p) return;

    if (!state.didDraw){
      if (state.deck.length) p.hand.push(state.deck.pop());
    }
    if (p.hand.length){
      const c = p.hand[Math.floor(Math.random()*p.hand.length)];
      p.hand = p.hand.filter(x=>x.id!==c.id);
      state.unwanted.push(c);
    }
    const next = (state.turn+1)%state.players.length;
    beginTurn(next);
    render();
    maybeBot();
  } else {
    render();
  }
}, 450);

render();
