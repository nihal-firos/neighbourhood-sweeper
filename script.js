(function(){
"use strict";

/* ---------------- Canvas / responsive sizing ---------------- */
const stage = document.getElementById('stage');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let W = 800, H = 600;

    let player = null, leaves = [], particles = [], debris = [];
    let neighbor = { active: false, x: -40, y: -40, path: [] };
    let dana = { active: false, x: -40, y: -40 };
    let wind = { dx: 1, active: false };
    let score = 0, totalSwept = 0, neighborVisits = 0, neighborVisitLimit = 0;
    let batchTotal = 0, threshold = 0;
    let comboCount = 0, comboTimer = 0;
    let shake = 0;
    let lastTime = 0;
    let debrisTimer = 0;
    let idleTimer = 0;
    let duel = { active: false }, weather = { type: 'sun', timer: 0 };
    let playTime = 0;
    let difficultyTier = 0;
    let garyTouches = 0;
    let jackpotSweeps = 0;
    let debrisSwept = 0;

    function rescaleEntities(newW, newH) {
        if (!W || !H || (newW === W && newH === H)) return;
        const sx = newW / W, sy = newH / H;
        leaves.forEach(lf => { lf.x *= sx; lf.y *= sy; });
        debris.forEach(d => { d.x *= sx; d.y *= sy; });
        particles.forEach(p => { p.x *= sx; p.y *= sy; });
        if (player) { player.x *= sx; player.y *= sy; }
        if (neighbor && neighbor.active) {
            neighbor.x *= sx; neighbor.y *= sy;
            neighbor.path.forEach(pt => { pt.x *= sx; pt.y *= sy; });
        }
        if (dana && dana.active) { dana.x *= sx; dana.y *= sy; }
    }

    function resize() {
        const rect = stage.getBoundingClientRect();
        const newW = Math.max(1, Math.round(rect.width));
        const newH = Math.max(1, Math.round(rect.height));
        rescaleEntities(newW, newH);
        W = canvas.width = newW;
        H = canvas.height = newH;
    }

    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 200));
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', resize);
    }
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
const STATE = { START:'start', PLAYING:'playing', DUEL:'duel', PAUSED:'paused', GAMEOVER:'gameover' };
let state = STATE.START;

    
    const HIGH_SCORE_KEY = 'sweep-duty-high-scores-v1';
    const ACHIEVEMENT_KEY = 'sweep-duty-achievements-v1';

const ACHIEVEMENTS = [
  { id:'ten-minute-shift', name:'Ten-Minute Shift', hint:'Sweep for 10 minutes straight.' },
  { id:'garys-personal-space', name:"Gary's Personal Space", hint:'Touch Gary 5 times.' },
  { id:'leaf-hoarder', name:'Leaf Hoarder', hint:'Let the yard reach 90% mess after sweeping.' },
  { id:'jackpot-janitor', name:'Jackpot Janitor', hint:'Land one JACKPOT SWEEP.' },
  { id:'lost-and-found', name:'Lost & Found', hint:'Sweep up 3 stray objects.' }
];

    const TREES = [
        { fx: 0.06, fy: 0.20, scale: 1.15 },
        { fx: 0.93, fy: 0.16, scale: 0.95 },
        { fx: 0.03, fy: 0.80, scale: 1.3 },
        { fx: 0.96, fy: 0.82, scale: 1.05 },
        { fx: 0.5, fy: 0.06, scale: 0.8 },
        { fx: 0.32, fy: 0.48, scale: 0.9 },
        { fx: 0.68, fy: 0.55, scale: 1.0 }
    ];

const LEAF_COLORS = ['#e08a2c','#c6531b','#f2b705','#8a3b12','#d9743a'];

const GARY_DIALOGUE = [
  ["MORE LEAVES FOR YOU!", "My tree, my rules."],
  ["This yard needs CHARACTER.", "A tidy yard is a SUSPICIOUS yard."],
  ["Sweeping is a personality disorder.", "I raked these MYSELF, mostly."],
  ["You call that clean?!", "Autumn waits for no one!"],
  ["The leaves have accepted me as their mayor.", "I have a permit for this. It is written on a leaf."],
  ["I've started BREEDING the tree.", "The tree says you are doing a bad job."],
  ["I no longer sleep. I simply compost.", "This is not a yard. This is a LEAF FACTORY."]
];
const IDLE_TAUNTS = [
  "Gary, from somewhere nearby: ‘Working hard, I see.’",
  "Gary yells: ‘The leaves aren't going to ignore themselves!’",
  "A distant Gary voice: ‘Take your time. I have MORE leaves.’"
];
const DEBRIS_TYPES = [
  { type:'pizza', points:90, color:'#e08a2c', joke:'🍕 Pizza box swept. Still somehow warm.' },
  { type:'sock', points:70, color:'#f3ecd9', joke:'🧦 Not sure how this got here.' },
  { type:'tumbleweed', points:110, color:'#c8964b', joke:'🌾 The tumbleweed respects your commitment.' }
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
function difficultyFactor(){ return 1 + playTime / 180; }

    function spawnLeaf(x, y) {
        let lx = x, ly = y;
        if (lx === undefined || ly === undefined) {
            let tries = 0;
            do {
                lx = rand(40, W - 40);
                ly = rand(90, H - 40);
                tries++;
            } while (treeColliders().some(t => dist(lx, ly, t.x, t.y) < t.r + 14) && tries < 10);
        }
        return {
            x: lx, y: ly,
            r: rand(6, 10),
            rot: rand(0, Math.PI * 2),
            color: LEAF_COLORS[Math.floor(rand(0, LEAF_COLORS.length))],
            sway: rand(0, Math.PI * 2),
            age: 0,
            jackpot: false,
            sweepHits: 0,
            sweepCooldown: 0
        };
    }

    function treeColliders() {
        return TREES.map(t => ({
            x: t.fx * W,
            y: t.fy * H + 18 * t.scale,
            r: 20 * t.scale
        }));
    }

function resetGame(){
  player = { x: W/2, y: H/2, r: 16, speed: 230, facing: 0, moving:false, boostTimer:0, broomBlow:0, garyTouchCooldown:0 };
  leaves = [];
  particles = [];
  debris = [];
  debrisTimer = rand(10, 18);
  idleTimer = 0;
  playTime = 0;
  difficultyTier = 0;
  garyTouches = 0;
  jackpotSweeps = 0;
  debrisSwept = 0;
  score = 0; totalSwept = 0; neighborVisits = 0;
  neighborVisitLimit = Math.floor(rand(5,8));
  comboCount = 0; comboTimer = 0;
  neighbor = { active:false, x:-40, y:-40, targetIdx:0, path:[], dropTimer:0, line:'' };
  dana = { active:false, x:-40, y:-40, side:1, arguing:false, argumentTimer:0 };
  wind = { timer: rand(14, 22), active:false, duration:0, dx:1, gustLeaves:0 };
  weather = { type:'sun', timer: rand(16, 26) };
  duel = { active:false, time:0, playerScore:0, garyScore:0 };

  const initialCount = 42;
  for(let i=0;i<initialCount;i++) leaves.push(spawnLeaf());
  batchTotal = initialCount;
  threshold = rand(75, 90);

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

function getUnlockedAchievements(){
  try {
    const unlocked = JSON.parse(localStorage.getItem(ACHIEVEMENT_KEY) || '[]');
    return Array.isArray(unlocked) ? unlocked : [];
  } catch (_) { return []; }
}

function unlockAchievement(id){
  const unlocked = getUnlockedAchievements();
  if(unlocked.includes(id)) return;
  const achievement = ACHIEVEMENTS.find(item => item.id === id);
  if(!achievement) return;
  try { localStorage.setItem(ACHIEVEMENT_KEY, JSON.stringify([...unlocked, id])); } catch (_) { /* Storage may be unavailable. */ }
  showBanner(`🏅 BADGE UNLOCKED: ${achievement.name}`);
  playTone(880, 0.32, 'triangle', 0.18, 0, 1320);
}

function renderAchievements(){
  const el = document.getElementById('achievementsList');
  const unlocked = getUnlockedAchievements();
  el.innerHTML = ACHIEVEMENTS.map(achievement => {
    const earned = unlocked.includes(achievement.id);
    return `<span class="badge ${earned ? 'unlocked' : 'locked'}" title="${achievement.hint}">${earned ? '🏅 ' : '🔒 '}${achievement.name}</span>`;
  }).join('');
}

function checkAchievements(){
  if(playTime >= 600) unlockAchievement('ten-minute-shift');
  if(garyTouches >= 5) unlockAchievement('garys-personal-space');
  if(totalSwept >= 20 && batchTotal > 0 && leaves.length / batchTotal >= 0.9) unlockAchievement('leaf-hoarder');
  if(jackpotSweeps >= 1) unlockAchievement('jackpot-janitor');
  if(debrisSwept >= 3) unlockAchievement('lost-and-found');
}

/* ---------------- Input ---------------- */
const keys = {};
window.addEventListener('keydown', e=>{
  keys[e.key.toLowerCase()] = true;
  if(state === STATE.DUEL && (e.code === 'Space' || e.key === ' ')){
    e.preventDefault();
    mashDuel();
  }
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
    const moveSpeed = player.speed * (player.boostTimer > 0 ? 1.55 : 1);
    player.x += dx * moveSpeed * dt;
    player.y += dy * moveSpeed * dt;
  }
  player.boostTimer = Math.max(0, player.boostTimer - dt);
  player.garyTouchCooldown = Math.max(0, player.garyTouchCooldown - dt);
  if(!(wind.active && weather.type === 'rain' && player.moving)){
    player.broomBlow = Math.max(0, player.broomBlow - 50 * dt);
  }
  player.x = Math.max(20, Math.min(W-20, player.x));
  player.y = Math.max(70, Math.min(H-20, player.y));
  resolveTreeCollisions();
  if(neighbor.active && player.garyTouchCooldown <= 0 && dist(player.x, player.y, neighbor.x, neighbor.y) < player.r + 16){
    garyTouches++;
    player.garyTouchCooldown = 0.9;
    shake = 5;
    playTone(180, 0.1, 'square', 0.1, 0, 130);
  }
  if(player.moving){
    idleTimer = 0;
  } else {
    idleTimer += dt;
    if(idleTimer >= 8){
      showBanner(IDLE_TAUNTS[Math.floor(rand(0, IDLE_TAUNTS.length))]);
      playTone(230, 0.2, 'square', 0.1, 0, 180);
      idleTimer = rand(-5, -2);
    }
  }
}

    function resolveTreeCollisions() {
        treeColliders().forEach(tree => {
            const dx = player.x - tree.x;
            const dy = player.y - tree.y;
            const d = Math.hypot(dx, dy);
            const minDist = player.r + tree.r;
            if (d < minDist && d > 0.001) {
                const push = (minDist - d);
                player.x += (dx / d) * push;
                player.y += (dy / d) * push;
            }
        });
    }

function updateLeaves(dt){
  const sweepRadius = player.r + 20;
  let jackpotPop = null;
  for(let i=leaves.length-1;i>=0;i--){
    const lf = leaves[i];
    lf.sway += dt*2;
    lf.age += dt;
    lf.sweepCooldown = Math.max(0, lf.sweepCooldown - dt);
    if(dist(player.x,player.y,lf.x,lf.y) < sweepRadius && lf.sweepCooldown <= 0){
      if(weather.type === 'rain' && lf.sweepHits === 0){
        lf.sweepHits = 1;
        lf.sweepCooldown = 0.45;
        burstParticles(lf.x, lf.y, '#77a9c9', 5, 0.8);
        playSweep();
        continue;
      }
      if(!lf.jackpot){
        const pile = leaves.filter(candidate =>
          !candidate.jackpot && candidate.age >= 5 && dist(lf.x, lf.y, candidate.x, candidate.y) < 58
        );
        if(pile.length >= 5){
          pile.forEach(candidate => candidate.jackpot = true);
          jackpotPop = { x:lf.x, y:lf.y, count:pile.length };
        }
      }
      leaves.splice(i,1);
      totalSwept++;
      comboCount++;
      comboTimer = 0.7;
      const gained = (10 + comboCount*2) * (lf.jackpot ? 4 : 1);
      score += gained;
      playCollect(comboCount);
      burstParticles(lf.x, lf.y, lf.color, weather.type === 'sun' ? 12 : 6, weather.type === 'sun' ? 1.65 : 1);
      popCombo(lf.x, lf.y, gained, comboCount);
    }
  }
  if(jackpotPop){
    jackpotSweeps++;
    popCombo(jackpotPop.x, jackpotPop.y, 0, 0, `JACKPOT SWEEP x4! (${jackpotPop.count} leaves)`);
    shake = 8;
    playTone(880, 0.34, 'triangle', 0.2, 0, 1320);
  }
  if(comboTimer>0){ comboTimer -= dt; if(comboTimer<=0) comboCount=0; }
}

function burstParticles(x,y,color,count=6,force=1){
  for(let i=0;i<count;i++){
    particles.push({
      x,y, vx: rand(-90,90) * force, vy: rand(-110,-30) * force,
      life: rand(0.35,0.6), age:0, color
    });
  }
}

function updateWind(dt){
  wind.timer -= dt;
  if(!wind.active && wind.timer <= 0 && totalSwept >= 12){
    wind.active = true;
    wind.duration = rand(4, 8);
    wind.dx = Math.random() < 0.5 ? -1 : 1;
    const rainyGust = weather.type === 'rain';
    wind.gustLeaves = rainyGust ? 0 : Math.min(Math.floor(rand(5, 11)), Math.max(0, totalSwept));
    if(rainyGust){
      showBanner('💨 RAIN GUST! Keep hold of that broom.');
    } else {
      const pileX = Math.max(45, Math.min(W - 45, player.x - wind.dx * 85));
      const pileY = Math.max(95, Math.min(H - 45, player.y + rand(-45, 45)));
      for(let i=0; i<wind.gustLeaves; i++){
        leaves.push(spawnLeaf(pileX + rand(-30, 30), pileY + rand(-22, 22)));
        batchTotal++;
      }
      showBanner(`💨 WIND GUST! ${wind.gustLeaves} swept leaves are loose again.`);
    }
    playSweep();
    shake = 4;
  }
  if(!wind.active) return;
  wind.duration -= dt;
  if(weather.type === 'rain'){
    if(player.moving){
      player.x = Math.max(20, Math.min(W - 20, player.x + wind.dx * 92 * dt));
      player.broomBlow = Math.min(24, player.broomBlow + 38 * dt);
    }
  } else {
    leaves.forEach(lf => {
      lf.x = Math.max(18, Math.min(W - 18, lf.x + wind.dx * 58 * dt));
      lf.y += Math.sin(lf.sway * 2) * 9 * dt;
    });
  }
  if(wind.duration <= 0){
    wind.active = false;
    wind.timer = rand(16, 27);
  }
}

function updateWeather(dt){
  weather.timer -= dt;
  if(weather.timer > 0) return;
  weather.type = weather.type === 'rain' ? 'sun' : 'rain';
  weather.timer = rand(14, 24);
  if(weather.type === 'rain'){
    leaves.forEach(lf => { lf.sweepHits = 0; });
    showBanner('🌧️ RAIN! Soggy leaves need two sweeps.');
    playTone(280, 0.3, 'sine', 0.12, 0, 180);
  } else {
    showBanner('☀️ SUN! Crisp leaves burst beautifully.');
    playTone(620, 0.2, 'triangle', 0.14, 0, 900);
  }
}

function spawnDebris(){
  const template = DEBRIS_TYPES[Math.floor(rand(0, DEBRIS_TYPES.length))];
  const fromLeft = Math.random() < 0.5;
  debris.push({
    ...template,
    x: fromLeft ? -32 : W + 32,
    y: rand(110, H - 45),
    vx: fromLeft ? rand(48, 82) : rand(-82, -48),
    rot: rand(-0.4, 0.4),
    sway: rand(0, Math.PI * 2)
  });
}

function updateDebris(dt){
  debrisTimer -= dt;
  if(debrisTimer <= 0){
    spawnDebris();
    debrisTimer = rand(13, 24);
  }
  for(let i=debris.length-1;i>=0;i--){
    const item = debris[i];
    item.x += item.vx * dt;
    item.sway += dt * 3;
    item.y += Math.sin(item.sway) * 12 * dt;
    if(dist(player.x, player.y, item.x, item.y) < player.r + 18){
      score += item.points;
      debrisSwept++;
      burstParticles(item.x, item.y, item.color);
      popCombo(item.x, item.y, 0, 0, `+${item.points} BONUS!`);
      showBanner(item.joke);
      playTone(740, 0.25, 'triangle', 0.18, 0, 1080);
      debris.splice(i, 1);
      continue;
    }
    if(item.x < -50 || item.x > W + 50) debris.splice(i, 1);
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
function popCombo(x,y,gained,combo,message){
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / W, scaleY = rect.height / H;
  comboPopEl.style.left = (x*scaleX) + 'px';
  comboPopEl.style.top = (y*scaleY) + 'px';
  comboPopEl.textContent = message || (combo>1 ? `+${gained} x${combo}` : `+${gained}`);
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
  const spd = 160 * difficultyFactor();
  if(d < 6){
    neighbor.targetIdx++;
  } else {
    neighbor.x += (target.x-neighbor.x)/d * spd*dt;
    neighbor.y += (target.y-neighbor.y)/d * spd*dt;
  }
  neighbor.dropTimer -= dt;
  if(neighbor.dropTimer <= 0 && !dana.arguing){
    neighbor.dropTimer = 0.12 / difficultyFactor();
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
    if (d > 4) {
        const danaSpd = 200 * difficultyFactor(); // stays ~40px/s faster than Gary at any difficulty tier
        dana.x += (targetX - dana.x) / d * danaSpd * dt;
        dana.y += (targetY - dana.y) / d * danaSpd * dt;
    }
  if(neighbor.active && d < 65){
    dana.arguing = true;
    dana.argumentTimer = 2.7;
    showBanner('🗯️ Dana: “Gary, stop undoing their work!”');
    playTone(620, 0.18, 'square', 0.12, 0, 480);
  }
}

function endNeighborVisit(){
  neighbor.active = false;
  document.title = 'Sweep Duty';
  hideBanner();
}

function startRakeDuel(){
  state = STATE.DUEL;
  duel = { active:true, time:5, playerScore:0, garyScore:0, garyTimer:0.18 };
  document.getElementById('duelOverlay').classList.remove('hidden');
  updateDuelHUD();
  playNeighborHorn();
}

function mashDuel(){
  if(state !== STATE.DUEL) return;
  duel.playerScore++;
  playTone(520 + Math.min(duel.playerScore, 8) * 25, 0.06, 'square', 0.08, 0);
  updateDuelHUD();
}

function updateDuelHUD(){
  document.getElementById('duelTimer').textContent = Math.max(0, duel.time).toFixed(1);
  document.getElementById('duelPlayerScore').textContent = duel.playerScore;
  document.getElementById('duelGaryScore').textContent = duel.garyScore;
}

function updateDuel(dt){
  duel.time -= dt;
  duel.garyTimer -= dt;
  if(duel.garyTimer <= 0){
    duel.garyScore += Math.random() < 0.28 ? 2 : 1;
    duel.garyTimer = rand(0.12, 0.24);
  }
  updateDuelHUD();
  if(duel.time <= 0) finishRakeDuel();
}

function finishRakeDuel(){
  duel.active = false;
  document.getElementById('duelOverlay').classList.add('hidden');
  state = STATE.PLAYING;
  document.title = 'Sweep Duty';
  threshold = rand(75, 90);
  if(duel.playerScore >= duel.garyScore){
    player.boostTimer = 12;
    showBanner('🏆 YOU WIN! Turbo sweeping for 12 seconds.');
    playTone(760, 0.45, 'triangle', 0.2, 0, 1280);
  } else {
    const dumpCount = 14;
    for(let i=0;i<dumpCount;i++){
      leaves.push(spawnLeaf(player.x + rand(-58,58), player.y + rand(-48,48)));
      batchTotal++;
    }
    showBanner('🧹 GARY WINS! A fresh pile lands on your shoes.');
    shake = 10;
  }
  if(neighborVisits >= neighborVisitLimit) setTimeout(()=> triggerGameOver(), 1400);
}

function getGaryLine(visit){
  const stage = Math.min(GARY_DIALOGUE.length - 1, Math.floor((visit - 1) / 2));
  const lines = GARY_DIALOGUE[stage];
  return lines[Math.floor(rand(0, lines.length))];
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
  if(neighborVisits >= 3 && neighborVisits % 3 === 0){
    neighbor.active = false;
    threshold = 100;
    document.title = '🪮 Rake-off with Gary!';
    startRakeDuel();
    return;
  }
  const line = getGaryLine(neighborVisits);
  showBanner(`🍂 Gary is here to "help" — "${line}"`);
  document.title = '😱 Gary incoming!';
    if (neighborVisits >= 3 && neighborVisits < neighborVisitLimit) {
        dana.active = true;
        dana.arguing = false;
        dana.side = fromLeft ? 1 : -1;
        dana.x = dana.side > 0 ? -35 : W + 35;
        dana.y = H * 0.42;
    }
  threshold = rand(75, 90);
  document.title = 'Sweep Duty';

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

  const cleaned = Math.max(0, batchTotal - leaves.length);
  const pct = batchTotal>0 ? Math.min(100, Math.round((cleaned/batchTotal)*100)) : 0;
  const fill = document.getElementById('barFill');
  fill.style.width = pct + '%';
  const hue = Math.round(120 - (pct/100)*120);
  fill.style.background = `linear-gradient(90deg, hsl(${hue+20},60%,45%), hsl(${hue},70%,55%))`;
}

function checkThreshold(){
  const cleaned = Math.max(0, batchTotal - leaves.length);
  const pct = batchTotal>0 ? (cleaned/batchTotal)*100 : 0;
  if(pct >= threshold && !neighbor.active && state===STATE.PLAYING){
    triggerNeighborEvent();
  }
  if(leaves.length < 4){
    const refillCount = 10 + Math.floor(playTime / 45);
    for(let i=0;i<refillCount;i++){ leaves.push(spawnLeaf()); batchTotal++; }
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

    function drawTree(tree) {
        const x = tree.fx * W, y = tree.fy * H;
        const s = tree.scale;
        const sway = Math.sin(lastTime / 900 + tree.fx * 10) * 3;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(s, s);

        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(0, 46, 34, 10, 0, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = '#5b3b22';
        ctx.fillRect(-7, 0, 14, 44);

        ctx.translate(sway, 0);
        ctx.fillStyle = '#2d4a26';
        ctx.beginPath(); ctx.arc(0, -10, 30, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3c6130';
        ctx.beginPath(); ctx.arc(-14, -24, 22, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(16, -22, 24, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#4d7a3d';
        ctx.beginPath(); ctx.arc(0, -34, 20, 0, Math.PI * 2); ctx.fill();

        ctx.restore();
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
  const bx = -Math.cos(p.facing) * (p.r+14) + wind.dx * p.broomBlow;
  const by = -Math.sin(p.facing) * (p.r+14) - p.broomBlow * 0.22;
  ctx.save();
  ctx.translate(bx,by);
  ctx.rotate(p.facing + wind.dx * p.broomBlow * 0.012);
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
    ctx.beginPath(); ctx.arc(0, -2, p.r * 0.62, 0, Math.PI * 2); ctx.fill();

    const eyeOff = 3.5;
    const faceDir = Math.cos(p.facing) >= 0 ? 1 : -1; // which way they're generally facing
    const lean = p.moving ? faceDir : 0; // neutral face when standing still

    // eyebrows: leading brow lifts, trailing brow dips -- flips with direction
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-eyeOff - 2, -6 + lean * 1.2);
    ctx.lineTo(-eyeOff + 2, -6 - lean * 0.6);
    ctx.moveTo(eyeOff - 2, -6 - lean * 0.6);
    ctx.lineTo(eyeOff + 2, -6 + lean * 1.2);
    ctx.stroke();

    // eyes
    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath(); ctx.arc(-eyeOff, -3, 1.6, 0, Math.PI * 2); ctx.arc(eyeOff, -3, 1.6, 0, Math.PI * 2); ctx.fill();

    // mouth: subtle smirk that shifts toward the direction of travel
    ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(lean * 1.4, -1, 4, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();

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

function drawWeather(){
  if(weather.type === 'rain'){
    ctx.save();
    ctx.strokeStyle = 'rgba(155, 205, 230, .38)';
    ctx.lineWidth = 1.5;
    for(let i=0;i<46;i++){
      const x = (i * 71 + lastTime * 0.16) % (W + 30) - 15;
      const y = (i * 43 + lastTime * 0.28) % H;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 5, y + 13); ctx.stroke();
    }
    ctx.restore();
  } else {
    ctx.save();
    ctx.fillStyle = 'rgba(242, 183, 5, .08)';
    ctx.beginPath(); ctx.arc(W - 50, 55, 46, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

function drawDebris(item){
  ctx.save();
  ctx.translate(item.x, item.y);
  ctx.rotate(item.rot + Math.sin(item.sway) * 0.15);
  if(item.type === 'pizza'){
    ctx.fillStyle = '#c6531b';
    ctx.fillRect(-14, -10, 28, 20);
    ctx.fillStyle = '#f2b705';
    ctx.fillRect(-10, -6, 20, 12);
    ctx.fillStyle = '#8a3b12';
    ctx.beginPath(); ctx.arc(-4, 0, 2.5, 0, Math.PI * 2); ctx.arc(6, 2, 2.5, 0, Math.PI * 2); ctx.fill();
  } else if(item.type === 'sock'){
    ctx.fillStyle = '#f3ecd9';
    ctx.beginPath();
    ctx.moveTo(-7,-13); ctx.lineTo(5,-13); ctx.lineTo(6,2); ctx.quadraticCurveTo(16,4,11,12);
    ctx.lineTo(-7,12); ctx.quadraticCurveTo(-11,6,-5,2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#c9c2ae'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-6,-6); ctx.lineTo(5,-6); ctx.stroke();
  } else {
    ctx.strokeStyle = '#c8964b'; ctx.lineWidth = 2;
    for(let i=0;i<5;i++){
      ctx.beginPath(); ctx.arc(0,0, 6 + i * 2.2, i, Math.PI * 1.5 + i); ctx.stroke();
    }
  }
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
  drawWeather();
  TREES.forEach(drawTree);
  leaves.forEach(drawLeaf);
  debris.forEach(drawDebris);
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
    playTime += dt;
    const nextTier = Math.floor(playTime / 60);
    if(nextTier > difficultyTier){
      difficultyTier = nextTier;
      showBanner(`⚠️ The yard is escalating. Difficulty ${difficultyTier + 1}.`);
      playTone(300 + difficultyTier * 45, 0.25, 'sawtooth', 0.12, 0, 220);
    }
    updatePlayer(dt);
    updateLeaves(dt);
    updateParticles(dt);
    updateDebris(dt);
    updateWind(dt);
    updateWeather(dt);
    updateNeighbor(dt);
    updateDana(dt);
    checkThreshold();
    updateHUD();
  } else if(state===STATE.DUEL){
    updateDuel(dt);
  }
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ---------------- Flow control ---------------- */
function triggerGameOver(){
  state = STATE.GAMEOVER;
  document.title = 'Sweep Duty — Gary wins';
  stopMusic();
  playGameOver();
  dana.active = false;
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
document.getElementById('duelMashBtn').addEventListener('click', mashDuel);

resetGame();
renderHighScores('startHighScores');
})();
