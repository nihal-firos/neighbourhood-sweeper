(function(){
"use strict";

/* ---------------- Canvas / responsive sizing ---------------- */
const stage = document.getElementById('stage');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let W = 800, H = 600;

function resize(){
  const rect = stage.getBoundingClientRect();
  W = canvas.width = Math.round(rect.width);
  H = canvas.height = Math.round(rect.height);
}
window.addEventListener('resize', resize);
resize();

/* ---------------- Audio (fully procedural, no external files) ---------------- */
let actx = null, masterGain = null, musicMuted = false;
let musicTimer = null;
let noiseBuffer = null;

function initAudio(){
  if(actx) return;
  actx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = actx.createGain();
  masterGain.gain.value = 0.35;
  masterGain.connect(actx.destination);

  const len = actx.sampleRate * 0.3;
  noiseBuffer = actx.createBuffer(1, len, actx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for(let i=0;i<len;i++){ data[i] = (Math.random()*2-1) * (1 - i/len); }
}

function playTone(freq, dur, type, gainVal, delay, glideTo){
  if(!actx || musicMuted) return;
  const t0 = actx.currentTime + (delay||0);
  const osc = actx.createOscillator();
  const g = actx.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if(glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gainVal || 0.25, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(masterGain);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

function playSweep(){
  if(!actx || musicMuted) return;
  const t0 = actx.currentTime;
  const src = actx.createBufferSource();
  src.buffer = noiseBuffer;
  const g = actx.createGain();
  const filt = actx.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.value = 1800 + Math.random()*600;
  g.gain.setValueAtTime(0.18, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
  src.connect(filt); filt.connect(g); g.connect(masterGain);
  src.start(t0); src.stop(t0+0.2);
}

function playCollect(comboLevel){
  const base = 520 + Math.min(comboLevel,10) * 40;
  playTone(base, 0.12, 'triangle', 0.22, 0);
  playTone(base*1.5, 0.1, 'sine', 0.12, 0.03);
}

function playNeighborHorn(){
  playTone(420, 0.35, 'sawtooth', 0.25, 0, 220);
  playTone(340, 0.4, 'square', 0.15, 0.15, 160);
}

function playGameOver(){
  const notes = [392, 349, 293, 220];
  notes.forEach((f,i)=> playTone(f, 0.5, 'sawtooth', 0.2, i*0.28, f*0.9));
}

const melody = [523.25, 587.33, 659.25, 587.33, 523.25, 440.0, 523.25, 659.25];
const bass   = [130.81, 0, 174.61, 0];
let musicStep = 0;
function musicTick(){
  if(musicMuted){ return; }
  const note = melody[musicStep % melody.length];
  playTone(note, 0.28, 'triangle', 0.09, 0);
  const b = bass[Math.floor(musicStep/2) % bass.length];
  if(b) playTone(b, 0.5, 'sine', 0.14, 0);
  musicStep++;
}
function startMusic(){
  if(musicTimer) return;
  musicStep = 0;
  musicTick();
  musicTimer = setInterval(musicTick, 320);
}
function stopMusic(){
  if(musicTimer){ clearInterval(musicTimer); musicTimer = null; }
}

document.getElementById('muteBtn').addEventListener('click', ()=>{
  musicMuted = !musicMuted;
  document.getElementById('muteBtn').textContent = musicMuted ? '🔇' : '🔊';
  if(masterGain) masterGain.gain.value = musicMuted ? 0 : 0.35;
});

/* ---------------- Game state ---------------- */
const STATE = { START:'start', PLAYING:'playing', PAUSED:'paused', GAMEOVER:'gameover' };
let state = STATE.START;

let player, leaves, particles, neighbor, dana, wind;
let score, totalSwept, neighborVisits, neighborVisitLimit;
let batchTotal, threshold;
let comboCount, comboTimer;
let shake = 0;
let lastTime = 0;
const HIGH_SCORE_KEY = 'sweep-duty-high-scores-v1';

const LEAF_COLORS = ['#e08a2c','#c6531b','#f2b705','#8a3b12','#d9743a'];

const NEIGHBOR_LINES = [
  "MORE LEAVES FOR YOU!",
  "This yard needs CHARACTER.",
  "Sweeping is a personality disorder.",
  "My tree, my rules.",
  "You call that clean?!",
  "Autumn waits for no one!",
  "I raked these MYSELF, mostly.",
  "A tidy yard is a SUSPICIOUS yard."
];

const ENDINGS = [
  "Gary's wife has filed a restraining order against your broom.",
  "You achieved perfect leaf-based inner peace. Unfortunately, peace doesn't pay rent.",
  "The HOA has named you 'Sweeper Emeritus' and confiscated your broom for excessive enthusiasm.",
  "You swept so hard you swept yourself into another dimension. Send help. Also send a broom.",
  "Gary has run out of leaves to throw. He is now just standing there, judging you silently.",
  "Your broom has filed for early retirement, citing 'the sheer audacity of Gary.'"
];

function rand(a,b){ return a + Math.random()*(b-a); }
function dist(x1,y1,x2,y2){ return Math.hypot(x1-x2, y1-y2); }

function spawnLeaf(x,y){
  return {
    x: x ?? rand(40, W-40),
    y: y ?? rand(90, H-40),
    r: rand(6,10),
    rot: rand(0, Math.PI*2),
    color: LEAF_COLORS[Math.floor(rand(0,LEAF_COLORS.length))],
    sway: rand(0, Math.PI*2)
  };
}

function resetGame(){
  player = { x: W/2, y: H/2, r: 16, speed: 230, facing: 0, moving:false };
  leaves = [];
  particles = [];
  score = 0; totalSwept = 0; neighborVisits = 0;
  neighborVisitLimit = Math.floor(rand(6,10));
  comboCount = 0; comboTimer = 0;
  neighbor = { active:false, x:-40, y:-40, targetIdx:0, path:[], dropTimer:0, line:'' };
  dana = { active:false, x:-40, y:-40, side:1, arguing:false, argumentTimer:0 };
  wind = { timer: rand(14, 22), active:false, duration:0, dx:1, gustLeaves:0 };

  const initialCount = 42;
  for(let i=0;i<initialCount;i++) leaves.push(spawnLeaf());
  batchTotal = initialCount;
  threshold = rand(75,99);

  updateHUD();
}

function getHighScores(){
  try {
    const scores = JSON.parse(localStorage.getItem(HIGH_SCORE_KEY) || '[]');
    return Array.isArray(scores) ? scores.filter(Number.isFinite).sort((a,b)=>b-a).slice(0, 5) : [];
  } catch (_) { return []; }
}

function saveHighScore(value){
  const before = getHighScores();
  const scores = [...before, value].sort((a,b)=>b-a).slice(0, 5);
  try { localStorage.setItem(HIGH_SCORE_KEY, JSON.stringify(scores)); } catch (_) { /* Storage may be unavailable. */ }
  return !before.length || value > before[0];
}

function renderHighScores(elementId){
  const el = document.getElementById(elementId);
  const scores = getHighScores();
  el.innerHTML = scores.length
    ? `<strong>LOCAL BESTS</strong><br>${scores.map((value, index)=>`${index + 1}. ${value.toLocaleString()}`).join(' &nbsp; ')}`
    : '<strong>LOCAL BESTS</strong><br>First shift on the books.';
}

/* ---------------- Input ---------------- */
const keys = {};
window.addEventListener('keydown', e=>{
  keys[e.key.toLowerCase()] = true;
  if(e.key === 'Escape'){
    e.preventDefault();
    if(state === STATE.PLAYING) pauseGame();
    else if(state === STATE.PAUSED) resumeGame();
  }
});
window.addEventListener('keyup', e=>{
  keys[e.key.toLowerCase()] = false;
});

let touchTarget = null;
canvas.addEventListener('touchstart', handleTouch, {passive:true});
canvas.addEventListener('touchmove', handleTouch, {passive:true});
canvas.addEventListener('touchend', ()=> touchTarget = null);
function handleTouch(e){
  const rect = canvas.getBoundingClientRect();
  const t = e.touches[0];
  touchTarget = { x:(t.clientX-rect.left)*(W/rect.width), y:(t.clientY-rect.top)*(H/rect.height) };
}

/* ---------------- Update ---------------- */
function updatePlayer(dt){
  let dx=0, dy=0;
  if(keys['w']||keys['arrowup']) dy -= 1;
  if(keys['s']||keys['arrowdown']) dy += 1;
  if(keys['a']||keys['arrowleft']) dx -= 1;
  if(keys['d']||keys['arrowright']) dx += 1;

  if(touchTarget){
    const ddx = touchTarget.x - player.x, ddy = touchTarget.y - player.y;
    const d = Math.hypot(ddx,ddy);
    if(d > 6){ dx = ddx/d; dy = ddy/d; } else { dx=0; dy=0; }
  }

  const len = Math.hypot(dx,dy);
  player.moving = len > 0.01;
  if(player.moving){
    dx/=len; dy/=len;
    player.facing = Math.atan2(dy,dx);
    player.x += dx * player.speed * dt;
    player.y += dy * player.speed * dt;
  }
  player.x = Math.max(20, Math.min(W-20, player.x));
  player.y = Math.max(70, Math.min(H-20, player.y));
}

function updateLeaves(dt){
  const sweepRadius = player.r + 20;
  for(let i=leaves.length-1;i>=0;i--){
    const lf = leaves[i];
    lf.sway += dt*2;
    if(dist(player.x,player.y,lf.x,lf.y) < sweepRadius){
      leaves.splice(i,1);
      totalSwept++;
      comboCount++;
      comboTimer = 0.7;
      const gained = 10 + comboCount*2;
      score += gained;
      playCollect(comboCount);
      burstParticles(lf.x, lf.y, lf.color);
      popCombo(lf.x, lf.y, gained, comboCount);
    }
  }
  if(comboTimer>0){ comboTimer -= dt; if(comboTimer<=0) comboCount=0; }
}

function burstParticles(x,y,color){
  for(let i=0;i<6;i++){
    particles.push({
      x,y, vx: rand(-90,90), vy: rand(-110,-30),
      life: rand(0.35,0.6), age:0, color
    });
  }
}

function updateWind(dt){
  wind.timer -= dt;
  if(!wind.active && wind.timer <= 0 && totalSwept >= 12){
    wind.active = true;
    wind.duration = 2.4;
    wind.dx = Math.random() < 0.5 ? -1 : 1;
    wind.gustLeaves = Math.min(Math.floor(rand(5, 11)), Math.max(0, totalSwept));
    const pileX = Math.max(45, Math.min(W - 45, player.x - wind.dx * 85));
    const pileY = Math.max(95, Math.min(H - 45, player.y + rand(-45, 45)));
    for(let i=0; i<wind.gustLeaves; i++){
      leaves.push(spawnLeaf(pileX + rand(-30, 30), pileY + rand(-22, 22)));
      batchTotal++;
    }
    playSweep();
    shake = 4;
    showBanner(`💨 WIND GUST! ${wind.gustLeaves} swept leaves are loose again.`);
  }
  if(!wind.active) return;
  wind.duration -= dt;
  leaves.forEach(lf => {
    lf.x = Math.max(18, Math.min(W - 18, lf.x + wind.dx * 58 * dt));
    lf.y += Math.sin(lf.sway * 2) * 9 * dt;
  });
  if(wind.duration <= 0){
    wind.active = false;
    wind.timer = rand(16, 27);
  }
}

function updateParticles(dt){
  for(let i=particles.length-1;i>=0;i--){
    const p = particles[i];
    p.age += dt;
    if(p.age > p.life){ particles.splice(i,1); continue; }
    p.vy += 220*dt;
    p.x += p.vx*dt; p.y += p.vy*dt;
  }
}

const comboPopEl = document.getElementById('comboPop');
let comboPopTimer = 0;
function popCombo(x,y,gained,combo){
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / W, scaleY = rect.height / H;
  comboPopEl.style.left = (x*scaleX) + 'px';
  comboPopEl.style.top = (y*scaleY) + 'px';
  comboPopEl.textContent = combo>1 ? `+${gained} x${combo}` : `+${gained}`;
  comboPopEl.style.opacity = '1';
  comboPopEl.style.transform = 'translate(-50%,-10px)';
  comboPopTimer = 0.001;
  requestAnimationFrame(()=>{
    comboPopEl.style.transform = 'translate(-50%,-40px)';
    comboPopEl.style.opacity = '0';
  });
}

function updateNeighbor(dt){
  if(!neighbor.active) return;
  const path = neighbor.path;
  const target = path[neighbor.targetIdx];
  if(!target){ endNeighborVisit(); return; }
  const d = dist(neighbor.x, neighbor.y, target.x, target.y);
  const spd = 160;
  if(d < 6){
    neighbor.targetIdx++;
  } else {
    neighbor.x += (target.x-neighbor.x)/d * spd*dt;
    neighbor.y += (target.y-neighbor.y)/d * spd*dt;
  }
  neighbor.dropTimer -= dt;
  if(neighbor.dropTimer <= 0 && !dana.arguing){
    neighbor.dropTimer = 0.12;
    const nl = spawnLeaf(neighbor.x + rand(-14,14), neighbor.y + rand(-8,20));
    leaves.push(nl);
    batchTotal++;
  }
}

function updateDana(dt){
  if(!dana.active) return;
  if(dana.arguing){
    dana.argumentTimer -= dt;
    if(dana.argumentTimer <= 0){
      dana.active = false;
      dana.arguing = false;
    }
    return;
  }
  const targetX = neighbor.active ? neighbor.x - dana.side * 42 : (dana.side > 0 ? W + 35 : -35);
  const targetY = neighbor.active ? neighbor.y + 10 : H * 0.42;
  const d = dist(dana.x, dana.y, targetX, targetY);
  if(d > 4){
    dana.x += (targetX - dana.x) / d * 185 * dt;
    dana.y += (targetY - dana.y) / d * 185 * dt;
  }
  if(neighbor.active && d < 50){
    dana.arguing = true;
    dana.argumentTimer = 2.7;
    showBanner('🗯️ Dana: “Gary, stop undoing their work!”');
    playTone(620, 0.18, 'square', 0.12, 0, 480);
  }
}

function endNeighborVisit(){
  neighbor.active = false;
  hideBanner();
}

function triggerNeighborEvent(){
  neighbor.active = true;
  neighbor.targetIdx = 0;
  const fromLeft = Math.random() < 0.5;
  neighbor.x = fromLeft ? -30 : W+30;
  neighbor.y = 100;
  neighbor.path = [
    {x: fromLeft ? W*0.25 : W*0.75, y: 130},
    {x: fromLeft ? W*0.55 : W*0.45, y: H*0.55},
    {x: fromLeft ? W*0.8 : W*0.2, y: H*0.75},
    {x: fromLeft ? W+30 : -30, y: H*0.6}
  ];
  neighbor.dropTimer = 0;
  neighborVisits++;
  playNeighborHorn();
  shake = 10;
  const line = NEIGHBOR_LINES[Math.floor(rand(0,NEIGHBOR_LINES.length))];
  showBanner(`🍂 Gary is here to "help" — "${line}"`);
  if(neighborVisits >= 5){
    dana.active = true;
    dana.arguing = false;
    dana.side = fromLeft ? 1 : -1;
    dana.x = dana.side > 0 ? -35 : W + 35;
    dana.y = H * 0.42;
  }
  threshold = rand(75,99);

  if(neighborVisits >= neighborVisitLimit){
    setTimeout(()=> triggerGameOver(), 1400);
  }
}

const bannerEl = document.getElementById('neighborBanner');
let bannerTimeout = null;
function showBanner(text){
  bannerEl.textContent = text;
  bannerEl.classList.add('show');
  clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(hideBanner, 2600);
}
function hideBanner(){ bannerEl.classList.remove('show'); }

function updateHUD(){
  document.getElementById('scoreNum').textContent = score;
  document.getElementById('sweptNum').textContent = totalSwept;
  const visitsEl = document.getElementById('visits');
  visitsEl.textContent = '🧹'.repeat(Math.min(neighborVisits,8)) + (neighborVisits>8 ? '+' : '');

  const cleaned = Math.max(0, batchTotal - leaves.length);
  const pct = batchTotal>0 ? Math.min(100, Math.round((cleaned/batchTotal)*100)) : 0;
  const fill = document.getElementById('barFill');
  fill.style.width = pct + '%';
  const hue = Math.round(120 - (pct/100)*120);
  fill.style.background = `linear-gradient(90deg, hsl(${hue+20},60%,45%), hsl(${hue},70%,55%))`;
  document.getElementById('barLabel').textContent = pct + '% clean · threshold ' + Math.round(threshold) + '%';
}

function checkThreshold(){
  const cleaned = Math.max(0, batchTotal - leaves.length);
  const pct = batchTotal>0 ? (cleaned/batchTotal)*100 : 0;
  if(pct >= threshold && !neighbor.active && state===STATE.PLAYING){
    triggerNeighborEvent();
  }
  if(leaves.length < 4){
    for(let i=0;i<10;i++){ leaves.push(spawnLeaf()); batchTotal++; }
  }
}

/* ---------------- Render ---------------- */
function drawTurf(){
  ctx.fillStyle = '#33452f';
  ctx.fillRect(0,0,W,H);
  const stripeW = 46;
  for(let x=-stripeW; x<W; x+=stripeW*2){
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(x,0,stripeW,H);
  }
}

function drawLeaf(lf){
  ctx.save();
  ctx.translate(lf.x, lf.y + Math.sin(lf.sway)*1.5);
  ctx.rotate(lf.rot + Math.sin(lf.sway*0.5)*0.15);
  ctx.fillStyle = lf.color;
  ctx.beginPath();
  ctx.ellipse(0,0, lf.r, lf.r*0.65, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-lf.r*0.8,0); ctx.lineTo(lf.r*0.8,0);
  ctx.stroke();
  ctx.restore();
}

function drawPlayer(){
  const p = player;
  ctx.save();
  ctx.translate(p.x, p.y);

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, p.r*0.9, p.r*0.9, p.r*0.35, 0,0,Math.PI*2); ctx.fill();

  // broom (trails behind facing direction)
  const bx = -Math.cos(p.facing) * (p.r+14);
  const by = -Math.sin(p.facing) * (p.r+14);
  ctx.save();
  ctx.translate(bx,by);
  ctx.rotate(p.facing);
  ctx.fillStyle = '#8a5a2b';
  ctx.fillRect(-2, -3, 16, 4);
  ctx.fillStyle = '#e3c25c';
  ctx.beginPath();
  ctx.moveTo(14,-8); ctx.lineTo(26,0); ctx.lineTo(14,8); ctx.lineTo(10,0);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  // body
  ctx.fillStyle = '#3f7bb0';
  ctx.beginPath(); ctx.arc(0,0,p.r,0,Math.PI*2); ctx.fill();
  // face
  ctx.fillStyle = '#f3ecd9';
  ctx.beginPath(); ctx.arc(0,-2,p.r*0.62,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = '#2a2a2a';
  const eyeOff = 3.5;
  ctx.beginPath(); ctx.arc(-eyeOff,-3,1.6,0,Math.PI*2); ctx.arc(eyeOff,-3,1.6,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth=1.4;
  ctx.beginPath(); ctx.arc(0,-1,4,0.15*Math.PI,0.85*Math.PI); ctx.stroke();

  ctx.restore();
}

function drawNeighbor(){
  if(!neighbor.active) return;
  ctx.save();
  ctx.translate(neighbor.x, neighbor.y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0,16,14,5,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = '#b3432f';
  ctx.beginPath(); ctx.arc(0,0,15,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = '#f3ecd9';
  ctx.beginPath(); ctx.arc(0,-2,9,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = '#2a2a2a';
  ctx.beginPath(); ctx.arc(-3,-3,1.6,0,Math.PI*2); ctx.arc(3,-3,1.6,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='#2a2a2a'; ctx.lineWidth=1.4;
  ctx.beginPath(); ctx.arc(0,-4,4,0.15*Math.PI,0.85*Math.PI, true); ctx.stroke();
  ctx.restore();
}

function drawDana(){
  if(!dana.active) return;
  ctx.save();
  ctx.translate(dana.x, dana.y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0,16,14,5,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = '#7b5ba7';
  ctx.beginPath(); ctx.arc(0,0,15,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = '#f3ecd9';
  ctx.beginPath(); ctx.arc(0,-2,9,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = '#4a2c22';
  ctx.beginPath(); ctx.arc(0,-8,10,Math.PI,0); ctx.fill();
  ctx.fillStyle = '#2a2a2a';
  ctx.beginPath(); ctx.arc(-3,-3,1.6,0,Math.PI*2); ctx.arc(3,-3,1.6,0,Math.PI*2); ctx.fill();
  if(dana.arguing){
    ctx.fillStyle = '#f3ecd9';
    ctx.fillRect(-13,-39,26,16);
    ctx.fillStyle = '#7b5ba7';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('?!', -7, -27);
  }
  ctx.restore();
}

function drawWind(){
  if(!wind.active) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(243,236,217,0.3)';
  ctx.lineWidth = 2;
  for(let i=0;i<5;i++){
    const y = 95 + i * ((H - 130) / 5) + Math.sin(lastTime / 170 + i) * 14;
    const start = wind.dx > 0 ? 10 : W - 10;
    ctx.beginPath();
    ctx.moveTo(start, y);
    ctx.quadraticCurveTo(start + wind.dx * 70, y - 12, start + wind.dx * 150, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawParticles(){
  particles.forEach(p=>{
    const a = 1 - p.age/p.life;
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.max(0,a);
    ctx.beginPath();
    ctx.ellipse(p.x,p.y,3,2,0,0,Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });
}

function render(){
  ctx.save();
  if(shake>0){
    ctx.translate(rand(-shake,shake), rand(-shake,shake));
    shake = Math.max(0, shake-0.5);
  }
  drawTurf();
  leaves.forEach(drawLeaf);
  drawParticles();
  drawWind();
  drawPlayer();
  drawNeighbor();
  drawDana();
  ctx.restore();
}

/* ---------------- Loop ---------------- */
function loop(t){
  const dt = Math.min(0.033, (t-lastTime)/1000 || 0);
  lastTime = t;

  if(state===STATE.PLAYING){
    updatePlayer(dt);
    updateLeaves(dt);
    updateParticles(dt);
    updateWind(dt);
    updateNeighbor(dt);
    updateDana(dt);
    checkThreshold();
    updateHUD();
  }
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ---------------- Flow control ---------------- */
function triggerGameOver(){
  state = STATE.GAMEOVER;
  stopMusic();
  playGameOver();
  document.getElementById('goMsg').textContent = ENDINGS[Math.floor(rand(0,ENDINGS.length))];
  document.getElementById('goScore').textContent = score;
  document.getElementById('goSwept').textContent = totalSwept;
  document.getElementById('goVisits').textContent = neighborVisits;
  const isNewBest = saveHighScore(score);
  document.getElementById('newBest').textContent = isNewBest ? 'NEW LOCAL BEST!' : '';
  renderHighScores('gameOverHighScores');
  document.getElementById('pauseScreen').classList.add('hidden');
  document.getElementById('gameOverOverlay').classList.remove('hidden');
}

function pauseGame(){
  if(state !== STATE.PLAYING) return;
  state = STATE.PAUSED;
  stopMusic();
  document.getElementById('pauseScreen').classList.remove('hidden');
}

function resumeGame(){
  if(state !== STATE.PAUSED) return;
  state = STATE.PLAYING;
  document.getElementById('pauseScreen').classList.add('hidden');
  if(!musicMuted) startMusic();
}

function showMainMenu(){
  stopMusic();
  state = STATE.START;
  resetGame();
  document.getElementById('pauseScreen').classList.add('hidden');
  document.getElementById('gameOverOverlay').classList.add('hidden');
  document.getElementById('menuScreen').classList.remove('hidden');
  renderHighScores('startHighScores');
}

document.getElementById('startBtn').addEventListener('click', ()=>{
  initAudio();
  if(actx.state === 'suspended') actx.resume();
  resetGame();
  state = STATE.PLAYING;
  document.getElementById('menuScreen').classList.add('hidden');
  document.getElementById('pauseScreen').classList.add('hidden');
  document.getElementById('gameOverOverlay').classList.add('hidden');
  renderHighScores('startHighScores');
  startMusic();
});

document.getElementById('retryBtn').addEventListener('click', ()=>{
  resetGame();
  state = STATE.PLAYING;
  document.getElementById('gameOverOverlay').classList.add('hidden');
  document.getElementById('pauseScreen').classList.add('hidden');
  startMusic();
});

document.getElementById('pauseBtn').addEventListener('click', pauseGame);
document.getElementById('resumeBtn').addEventListener('click', resumeGame);
document.getElementById('menuBtn').addEventListener('click', showMainMenu);

resetGame();
renderHighScores('startHighScores');
})();
