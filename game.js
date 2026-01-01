// Simple long platformer with checkpoints, animals, procedural sound effects, and leaderboard
// Updated: finish timer + leaderboard (localStorage)

(() => {
  // Canvas setup
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const DEVICE_PIXEL_RATIO = Math.max(1, window.devicePixelRatio || 1);
  const VIEW_W = 960;
  const VIEW_H = 540;
  canvas.width = VIEW_W * DEVICE_PIXEL_RATIO;
  canvas.height = VIEW_H * DEVICE_PIXEL_RATIO;
  canvas.style.width = VIEW_W + "px";
  canvas.style.height = VIEW_H + "px";
  ctx.scale(DEVICE_PIXEL_RATIO, DEVICE_PIXEL_RATIO);

  // UI elements
  const statusEl = document.getElementById('status');
  const saveBtn = document.getElementById('saveBtn');
  const clearBtn = document.getElementById('clearBtn');
  const muteBtn = document.getElementById('muteBtn');
  const volumeEl = document.getElementById('volume');
  const leaderboardBtn = document.getElementById('leaderboardBtn');
  const clearLeaderboardBtn = document.getElementById('clearLeaderboardBtn');

  const finishModal = document.getElementById('finishModal');
  const finishTimeText = document.getElementById('finishTimeText');
  const finishNameInput = document.getElementById('finishName');
  const saveTimeBtn = document.getElementById('saveTimeBtn');
  const discardTimeBtn = document.getElementById('discardTimeBtn');

  const leaderboardModal = document.getElementById('leaderboardModal');
  const leaderboardList = document.getElementById('leaderboardList');
  const closeLeaderboardBtn = document.getElementById('closeLeaderboardBtn');

  // Input
  const keys = {};
  window.addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; });
  window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

  // Sound manager using Web Audio API (procedural SFX)
  class SoundManager {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.gain = 0.9;
      this.muted = false;
      this._initRequested = false;
      this._resumeOnInteraction();
    }
    _resumeOnInteraction() {
      if (this._initRequested) return;
      this._initRequested = true;
      const resume = async () => {
        try {
          if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.master = this.ctx.createGain();
            this.master.gain.value = this.gain;
            this.master.connect(this.ctx.destination);
          }
          if (this.ctx.state === 'suspended') await this.ctx.resume();
        } catch (e) {
          console.warn('Audio resume failed', e);
        } finally {
          window.removeEventListener('pointerdown', resume);
          window.removeEventListener('keydown', resume);
        }
      };
      window.addEventListener('pointerdown', resume, {passive:true});
      window.addEventListener('keydown', resume, {passive:true});
    }
    setMuted(v) {
      this.muted = !!v;
      this.master && (this.master.gain.value = this.muted ? 0 : this.gain);
    }
    setVolume(v) {
      this.gain = v;
      this.master && (this.master.gain.value = this.muted ? 0 : this.gain);
    }
    _beep({freq=440, type='sine', length=0.12, attack=0.01, decay=0.08, gain=0.6, detune=0}) {
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = detune;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + length + 0.02);
    }
    _noise({length=0.14, gain=0.6, attack=0.005}) {
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime;
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * length, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.8));
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
      src.connect(g);
      g.connect(this.master);
      src.start(t0);
      src.stop(t0 + length + 0.02);
    }

    playJump() {
      this._beep({freq:520, type:'sawtooth', length:0.12, attack:0.005, decay:0.1, gain:0.45});
    }
    playDoubleJump() {
      this._beep({freq:680, type:'sawtooth', length:0.14, attack:0.005, decay:0.12, gain:0.5});
    }
    playDash() {
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(700, t0);
      osc.frequency.exponentialRampToValueAtTime(180, t0 + 0.22);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.55, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.26);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + 0.28);
    }
    playCheckpoint() {
      this._beep({freq:760, type:'sine', length:0.22, attack:0.005, decay:0.18, gain:0.45});
      setTimeout(()=>this._beep({freq:960, type:'sine', length:0.16, attack:0.005, decay:0.12, gain:0.35}), 80);
    }
    playRescue() {
      this._beep({freq:980, type:'triangle', length:0.26, attack:0.01, decay:0.22, gain:0.45});
      setTimeout(()=>this._noise({length:0.18, gain:0.28}), 30);
    }
    playLand() {
      this._beep({freq:160, type:'sine', length:0.08, attack:0.005, decay:0.06, gain:0.35});
    }
    playDeath() {
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime;
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.5, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i/(data.length*0.5));
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.5, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.48);
      src.connect(g);
      g.connect(this.master);
      src.start(t0);
      src.stop(t0 + 0.52);

      const osc = this.ctx.createOscillator();
      const og = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(520, t0);
      osc.frequency.exponentialRampToValueAtTime(120, t0 + 0.5);
      og.gain.setValueAtTime(0.0001, t0);
      og.gain.linearRampToValueAtTime(0.6, t0 + 0.02);
      og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      osc.connect(og);
      og.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + 0.52);
    }
    playFinish() {
      this._beep({freq:1200, type:'sine', length:0.34, attack:0.01, decay:0.28, gain:0.6});
      setTimeout(()=>this._beep({freq:1600, type:'triangle', length:0.24, attack:0.01, decay:0.18, gain:0.45}), 110);
    }
  }

  const sound = new SoundManager();

  // Wire UI sound controls
  muteBtn.addEventListener('click', () => {
    sound.setMuted(!sound.muted);
    muteBtn.textContent = sound.muted ? '🔈' : '🔊';
  });
  volumeEl.addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    sound.setVolume(v);
  });

  saveBtn.addEventListener('click', () => game.saveProgress());
  clearBtn.addEventListener('click', () => { game.clearSave(); });

  leaderboardBtn.addEventListener('click', () => {
    renderLeaderboard();
    leaderboardModal.classList.remove('hidden');
  });
  closeLeaderboardBtn.addEventListener('click', () => {
    leaderboardModal.classList.add('hidden');
  });
  clearLeaderboardBtn.addEventListener('click', () => {
    if (confirm('Clear the leaderboard? This cannot be undone.')) {
      localStorage.removeItem('parkour.leaderboard');
      renderLeaderboard();
      alert('Leaderboard cleared.');
    }
  });

  // Finish modal actions
  saveTimeBtn.addEventListener('click', () => {
    const name = (finishNameInput.value || 'Anon').trim().slice(0, 24) || 'Anon';
    const t = game.finishTimeMs;
    if (typeof t === 'number') {
      saveLeaderboardEntry(name, t);
      finishModal.classList.add('hidden');
      renderLeaderboard();
      leaderboardModal.classList.remove('hidden');
    }
  });
  discardTimeBtn.addEventListener('click', () => {
    finishModal.classList.add('hidden');
    // allow player to continue browsing; we do not automatically restart or reset
  });

  // Utility functions
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rectIntersect(a,b){
    return !(a.x+a.w <= b.x || a.x >= b.x+b.w || a.y+a.h <= b.y || a.y >= b.y+b.h);
  }
  function formatTime(ms){
    if (ms == null || isNaN(ms)) return '0:00.000';
    const total = Math.floor(ms);
    const minutes = Math.floor(total / 60000);
    const seconds = Math.floor((total % 60000) / 1000);
    const msec = total % 1000;
    return `${minutes}:${String(seconds).padStart(2,'0')}.${String(msec).padStart(3,'0')}`;
  }

  // Leaderboard storage helpers
  const LEADERBOARD_KEY = 'parkour.leaderboard';
  function loadLeaderboard(){
    try {
      const raw = localStorage.getItem(LEADERBOARD_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr;
    } catch(e){ return []; }
  }
  function saveLeaderboard(arr){
    try {
      localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(arr));
    } catch(e){ console.warn('Failed to save leaderboard', e); }
  }
  function saveLeaderboardEntry(name, ms){
    const arr = loadLeaderboard();
    arr.push({name, timeMs: ms, date: (new Date()).toISOString()});
    arr.sort((a,b)=> a.timeMs - b.timeMs);
    const top = arr.slice(0, 50); // keep up to 50 historically
    saveLeaderboard(top);
  }
  function renderLeaderboard(){
    const arr = loadLeaderboard();
    leaderboardList.innerHTML = '';
    if (arr.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No entries yet — be the first!';
      leaderboardList.appendChild(li);
      return;
    }
    const top = arr.slice(0, 10);
    top.forEach((e,i)=>{
      const li = document.createElement('li');
      const rank = i+1;
      li.textContent = `${rank}. ${e.name} — ${formatTime(e.timeMs)} (${new Date(e.date).toLocaleDateString()})`;
      leaderboardList.appendChild(li);
    });
  }

  // Level definition (longer)
  const LEVEL_LENGTH = 22000; // extended
  const groundY = 420;
  let platforms = [];
  let movingPlatforms = [];
  let checkpoints = [];
  let animals = [];

  function makePlatform(x,y,w,h=20,type='static',opts={}){
    const p = {x,y,w,h,type, ...opts};
    if(type === 'moving') movingPlatforms.push(p);
    else platforms.push(p);
    return p;
  }

  // Create long ground
  makePlatform(-400, groundY, LEVEL_LENGTH + 800, 140);

  // Add dense parkour features
  (function buildParkour(){
    let x = 200;
    let section = 0;
    while (x < LEVEL_LENGTH - 400) {
      section++;
      const style = section % 6;
      if (style === 0) {
        for (let i=0;i<6;i++){
          makePlatform(x, groundY - 120 - i*44, 80, 16);
          x += 110;
        }
        animals.push({x: x-60, y: groundY - 260, w:18, h:16, saved:false, id:'a'+x});
      } else if (style === 1) {
        const mp = makePlatform(x, groundY - 120, 140, 16, 'moving', {
          vx: 80, range: 360, baseX: x, dir: 1
        });
        animals.push({x: x+24, y: groundY - 160, w:18, h:16, saved:false, id:'a'+x});
        x += 480;
      } else if (style === 2) {
        makePlatform(x, groundY - 260, 34, 260);
        makePlatform(x+180, groundY - 200, 34, 200);
        animals.push({x: x+88, y: groundY - 300, w:18, h:16, saved:false, id:'a'+x});
        x += 320;
      } else if (style === 3) {
        for(let i=0;i<5;i++){
          makePlatform(x, groundY - 30 - i*32, 100, 16);
          x+=130;
        }
        const mp2 = makePlatform(x, groundY - 200, 130, 16, 'moving', {vx:90, range:380, baseX:x, dir:-1});
        animals.push({x: x+30, y: groundY - 230, w:18, h:16, saved:false, id:'a'+x});
        x += 420;
      } else if (style === 4) {
        let stretch = 8 + Math.floor(Math.random()*6);
        for(let i=0;i<stretch;i++){
          if (Math.random() < 0.35) makePlatform(x, groundY - 20 - Math.random()*120, 64, 16);
          x += 120;
        }
        animals.push({x: x-100, y: groundY - 60, w:18, h:16, saved:false, id:'a'+x});
      } else {
        for (let i=0;i<4;i++){
          makePlatform(x, groundY - (i%2?140:40), 110, 16);
          x += 140;
        }
        animals.push({x: x-80, y: groundY - 160, w:18, h:16, saved:false, id:'a'+x});
        x += 60;
      }

      if (x > checkpoints.length * 1800 + 600) {
        checkpoints.push({x: x, y: groundY - 180 - (Math.random()*40), w:40, h:80, idx:checkpoints.length});
      }

      if (Math.random() < 0.28) {
        makePlatform(x+40, groundY - 240 - Math.random()*160, 100, 16);
      }

      x += 30 + Math.random()*140;
    }
  })();

  // Player template
  const player0 = {
    x: 60, y: groundY - 70, w:32, h:48,
    vx:0, vy:0,
    onGround:false,
    jumpCount:0,
    canDash:true,
    facing:1,
    alive:true,
    color:'#4cd1ff',
    wasOnGround:false
  };

  // Game state
  const game = {
    player: JSON.parse(JSON.stringify(player0)),
    cameraX: 0,
    camW: VIEW_W,
    camH: VIEW_H,
    animals: animals,
    checkpoints: checkpoints,
    checkpointIndex: 0,
    savedAnimalsSet: new Set(),
    lives: 3,
    gravity: 1800,
    lastTime: performance.now(),
    paused:false,

    // timer/leaderboard state
    timerStarted: false,
    startTime: null,
    finishTimeMs: null,
    finished: false,

    init(){
      this.loadProgress();
      this.respawnToCheckpoint(true);
      statusEl.textContent = `Animals saved: ${this.savedAnimalsSet.size} | Checkpoint: ${this.checkpointIndex}`;
      requestAnimationFrame(this.loop.bind(this));
    },

    loop(now){
      const dt = Math.min(0.032, (now - this.lastTime)/1000);
      this.lastTime = now;
      this.update(dt);
      this.render();
      requestAnimationFrame(this.loop.bind(this));
    },

    update(dt){
      if (this.finished) return; // freeze gameplay when finished

      this.handleInput(dt);
      this.applyPhysics(dt);
      this.updateMovingPlatforms(dt);
      this.checkAnimalPickup();
      this.checkCheckpoints();

      // start timer on first meaningful movement (player pushes or jumps)
      if (!this.timerStarted) {
        const p = this.player;
        const movingInput = (keys['arrowleft']||keys['a']||keys['arrowright']||keys['d']||keys[' ']||keys['w']||keys['arrowup']);
        if (movingInput || Math.abs(p.vx) > 1 || Math.abs(p.vy) > 1) {
          this.timerStarted = true;
          this.startTime = performance.now();
        }
      }

      // check finish (reaching the end)
      const finishX = LEVEL_LENGTH - 120;
      if (this.player.x + this.player.w >= finishX && !this.finished) {
        this.finished = true;
        this.finishTimeMs = (this.timerStarted && this.startTime) ? Math.max(0, performance.now() - this.startTime) : 0;
        sound.playFinish();
        this.onFinish();
        return;
      }

      // camera follow
      const px = this.player.x + this.player.w/2;
      const leftBound = this.cameraX + this.camW*0.35;
      const rightBound = this.cameraX + this.camW*0.6;
      if (px < leftBound) this.cameraX = px - this.camW*0.35;
      if (px > rightBound) this.cameraX = px - this.camW*0.6;
      this.cameraX = clamp(this.cameraX, -300, LEVEL_LENGTH - this.camW + 300);

      // death by falling
      if (this.player.y > VIEW_H + 300) {
        sound.playDeath();
        this.onDeath();
      }

      const elapsed = this.timerStarted ? (performance.now() - this.startTime) : 0;
      statusEl.textContent = `Animals saved: ${this.savedAnimalsSet.size} | Checkpoint: ${this.checkpointIndex} | Lives: ${this.lives} | Time: ${formatTime(elapsed)}`;
    },

    onFinish(){
      // show finish modal with time and allow saving to leaderboard
      finishTimeText.textContent = formatTime(this.finishTimeMs);
      finishNameInput.value = '';
      finishModal.classList.remove('hidden');
      // update status quickly
      statusEl.textContent = `Finished! Time: ${formatTime(this.finishTimeMs)} — save to leaderboard`;
    },

    handleInput(dt){
      const p = this.player;
      const accel = 2400;
      const maxSpeed = 420;
      const friction = p.onGround ? 0.85 : 0.995;

      let left = keys['arrowleft'] || keys['a'];
      let right = keys['arrowright'] || keys['d'];

      if (left === right) {
        p.vx *= friction;
      } else {
        if (left) { p.vx -= accel * dt; p.facing = -1; }
        if (right) { p.vx += accel * dt; p.facing = 1; }
      }
      p.vx = clamp(p.vx, -maxSpeed, maxSpeed);

      const jumpPressed = keys[' '] || keys['w'] || keys['arrowup'];
      if (jumpPressed && !this._jumpHeld) {
        if (p.onGround) {
          p.vy = -640; p.onGround = false; p.jumpCount = 1;
          sound.playJump();
        } else if (p.jumpCount === 1) {
          p.vy = -560; p.jumpCount = 2;
          sound.playDoubleJump();
        } else {
          const touchingLeftWall = this.isTouchingWall(-1);
          const touchingRightWall = this.isTouchingWall(1);
          if (touchingLeftWall || touchingRightWall) {
            p.vy = -520;
            p.vx = touchingLeftWall ? 480 : -480;
            p.jumpCount++;
            sound.playDoubleJump();
          }
        }
      }
      this._jumpHeld = jumpPressed;

      const dashPressed = keys['shift'];
      if (dashPressed && !this._dashHeld && p.canDash) {
        p.vx = 950 * p.facing;
        p.canDash = false;
        sound.playDash();
        setTimeout(()=>{ p.canDash = true; }, 450);
      }
      this._dashHeld = dashPressed;

      if (keys['r']) { this.respawnToCheckpoint(); }
      if (keys['c']) { this.clearSave(); }
    },

    isTouchingWall(dir){
      const p = this.player;
      const probe = {x:p.x + (dir==-1 ? -3 : p.w+3), y:p.y+4, w:3, h:p.h-8};
      for (const pl of platforms.concat(movingPlatforms)) {
        if (rectIntersect(probe, pl)) return true;
      }
      return false;
    },

    applyPhysics(dt){
      const p = this.player;
      p.vy += this.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      p.onGround = false;
      const allPlatforms = platforms.concat(movingPlatforms);
      for (const pl of allPlatforms) {
        if (rectIntersect(p, pl)) {
          const overlapX = Math.min(p.x + p.w - pl.x, pl.x + pl.w - p.x);
          const overlapY = Math.min(p.y + p.h - pl.y, pl.y + pl.h - p.y);
          if (overlapX < overlapY) {
            if (p.x < pl.x) {
              p.x -= overlapX;
              p.vx = Math.min(p.vx, 0);
            } else {
              p.x += overlapX;
              p.vx = Math.max(p.vx, 0);
            }
          } else {
            if (p.y < pl.y) {
              p.y -= overlapY;
              if (!p.onGround && p.vy >= 0) {
                sound.playLand();
              }
              p.vy = 0;
              p.onGround = true;
              p.jumpCount = 0;
              p.canDash = true;
            } else {
              p.y += overlapY;
              p.vy = 0;
            }
          }
        }
      }
      p.vx *= 0.999;
    },

    updateMovingPlatforms(dt){
      for (const mp of movingPlatforms) {
        mp.baseX = mp.baseX ?? mp.x;
        mp.dir = mp.dir ?? 1;
        mp.x += mp.vx * dt * mp.dir;
        if (Math.abs(mp.x - mp.baseX) > mp.range) {
          mp.dir *= -1;
          mp.x = mp.baseX + mp.range * mp.dir;
        }
      }
    },

    checkAnimalPickup(){
      for (const a of this.animals) {
        if (a.saved) continue;
        const ax = a.x, ay = a.y;
        const ar = {x:ax-8, y:ay-8, w:a.w, h:a.h};
        if (rectIntersect(this.player, ar)) {
          a.saved = true;
          this.savedAnimalsSet.add(a.id);
          sound.playRescue();
          this.saveProgress();
        }
      }
    },

    checkCheckpoints(){
      for (const cp of this.checkpoints) {
        const zone = {x:cp.x - 24, y:cp.y - 8, w:cp.w + 48, h:cp.h + 16};
        if (rectIntersect(this.player, zone)) {
          if (this.checkpointIndex < cp.idx) {
            this.checkpointIndex = cp.idx;
            sound.playCheckpoint();
            this.saveProgress();
            this.player.vy = -160;
          }
        }
      }
    },

    onDeath(){
      this.lives--;
      if (this.lives <= 0) {
        this.clearSave(true);
        this.lives = 3;
        for (const a of this.animals) a.saved = false;
      }
      this.respawnToCheckpoint();
    },

    respawnToCheckpoint(init=false){
      let cp = {x: 40, y: VIEW_H/2};
      if (this.checkpoints.length > 0) {
        const i = clamp(this.checkpointIndex, 0, this.checkpoints.length-1);
        cp = this.checkpoints[i];
      }
      this.player.x = cp.x;
      this.player.y = cp.y - 60;
      this.player.vx = 0; this.player.vy = 0;
      for (const a of this.animals) {
        a.saved = this.savedAnimalsSet.has(a.id);
      }
      this.cameraX = clamp(this.player.x - this.camW/3, 0, LEVEL_LENGTH - this.camW);
      // Reset timer if player chooses to respawn before starting timer
      if (!this.timerStarted) {
        this.startTime = null;
      }
    },

    saveProgress(){
      const state = {
        checkpointIndex: this.checkpointIndex,
        savedIds: Array.from(this.savedAnimalsSet)
      };
      try {
        localStorage.setItem('parkour.save', JSON.stringify(state));
      } catch(e) {
        console.warn('Save failed', e);
      }
      statusEl.style.opacity = 0.2;
      setTimeout(()=>statusEl.style.opacity=1, 180);
    },

    loadProgress(){
      try {
        const raw = localStorage.getItem('parkour.save');
        if (!raw) return;
        const st = JSON.parse(raw);
        if (st && typeof st === 'object') {
          this.checkpointIndex = st.checkpointIndex || 0;
          this.savedAnimalsSet = new Set(st.savedIds || []);
        }
      } catch(e) {
        console.warn('Failed to load save', e);
      }
    },

    clearSave(fullReset=false){
      localStorage.removeItem('parkour.save');
      this.checkpointIndex = 0;
      this.savedAnimalsSet.clear();
      for (const a of this.animals) a.saved = false;
      if (fullReset) {
        this.player = JSON.parse(JSON.stringify(player0));
      }
      this.timerStarted = false;
      this.startTime = null;
      this.finishTimeMs = null;
      this.finished = false;
      this.respawnToCheckpoint();
    },

    render(){
      ctx.clearRect(0,0,VIEW_W,VIEW_H);
      const grad = ctx.createLinearGradient(0,0,0,VIEW_H);
      grad.addColorStop(0,'#0b1020');
      grad.addColorStop(1,'#071827');
      ctx.fillStyle = grad;
      ctx.fillRect(0,0,VIEW_W,VIEW_H);

      this.drawBackground();

      ctx.save();
      ctx.translate(-this.cameraX, 0);

      ctx.fillStyle = '#6b4f3b';
      for (const pl of platforms) {
        ctx.fillStyle = '#6b4f3b';
        ctx.fillRect(pl.x, pl.y, pl.w, pl.h);
      }
      for (const pl of movingPlatforms) {
        ctx.fillStyle = '#8a6b4b';
        ctx.fillRect(pl.x, pl.y, pl.w, pl.h);
      }

      for (const cp of this.checkpoints) {
        const on = cp.idx <= this.checkpointIndex;
        ctx.fillStyle = on ? '#8eff8a' : '#4f6b5a';
        ctx.fillRect(cp.x, cp.y - 8, 6, cp.h + 16);
        ctx.fillStyle = on ? '#c6ffd1' : '#9aa9a2';
        ctx.fillRect(cp.x+6, cp.y - cp.h/2, 28, 14);
      }

      // finish marker (visual)
      ctx.fillStyle = '#ffd2d2';
      const finishX = LEVEL_LENGTH - 120;
      ctx.fillRect(finishX, groundY - 260, 8, 260);
      ctx.fillStyle = '#ff7a7a';
      ctx.fillRect(finishX+10, groundY - 200, 36, 16);

      for (const a of this.animals) {
        if (a.saved) continue;
        ctx.fillStyle = '#ffd24d';
        ctx.fillRect(a.x-8, a.y-8, a.w, a.h);
        ctx.fillStyle = '#8a5a12';
        ctx.fillRect(a.x-4, a.y-4, 4, 2);
        ctx.fillRect(a.x+2, a.y-4, 4, 2);
      }

      const p = this.player;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = '#043a46';
      ctx.fillRect(p.x + (p.facing>0?20:6), p.y + 14, 6, 4);

      ctx.restore();

      this.drawHUD();
    },

    drawBackground(){
      for (let i=0;i<6;i++){
        const t = i/6;
        const speed = 0.12 + t*0.2;
        const amp = 20 + i*8;
        ctx.fillStyle = `rgba(10,20,40,${0.12 + i*0.06})`;
        ctx.beginPath();
        for (let x= -200; x < VIEW_W + 600; x+=20) {
          const worldX = this.cameraX * speed + x;
          const y = 380 + Math.sin((worldX + i*300)/150) * amp + i*6;
          if (x===-200) ctx.moveTo(x,y);
          else ctx.lineTo(x,y);
        }
        ctx.lineTo(VIEW_W+600, VIEW_H);
        ctx.lineTo(-200, VIEW_H);
        ctx.closePath();
        ctx.fill();
      }
    },

    drawHUD(){
      ctx.save();
      ctx.resetTransform();
      ctx.fillStyle = '#e7eef8';
      ctx.font = '16px system-ui, Arial';
      const elapsed = this.timerStarted ? (performance.now() - this.startTime) : 0;
      ctx.fillText(`Animals: ${this.savedAnimalsSet.size} / ${this.animals.length}`, 18, 24);
      ctx.fillText(`Checkpoint: ${this.checkpointIndex}`, 18, 44);
      ctx.fillText(`Lives: ${this.lives}`, 18, 64);
      ctx.fillText(`Time: ${formatTime(this.finished ? this.finishTimeMs : elapsed)}`, 18, 88);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(12, 96, 260, 6);
      ctx.restore();
    }
  };

  // initialize
  game.init();

  // Expose for debugging
  window.GAME = game;
  window.SOUND = sound;

  // Render leaderboard on load (so it's ready)
  renderLeaderboard();

})();
