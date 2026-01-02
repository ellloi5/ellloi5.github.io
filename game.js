// Simple long platformer with grapple item
// Adds: item pickups (grapple), firing grapple with mouse, basic hook/pull/swing mechanics,
// plus inventory HUD and popup feedback. No accounts / no global leaderboard.

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
  const resetScoreBtn = document.getElementById('resetScoreBtn');

  saveBtn.addEventListener('click', () => game.saveProgress());
  clearBtn.addEventListener('click', () => { game.clearSave(); });

  // Input
  const keys = {};
  window.addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; });
  window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

  // Capture mouse for grapple firing
  let lastMouse = {x: 0, y: 0};
  canvas.addEventListener('mousemove', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    lastMouse.x = mx;
    lastMouse.y = my;
  });
  canvas.addEventListener('mousedown', (ev) => {
    // left click to fire
    if (ev.button === 0) {
      game.fireGrappleAtCanvas(lastMouse.x, lastMouse.y);
    } else if (ev.button === 2) {
      // right click to release
      game.releaseGrapple();
    }
  });
  // Prevent context menu on right click
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

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

    playJump() { this._beep({freq:520, type:'sawtooth', length:0.12, attack:0.005, decay:0.1, gain:0.45}); }
    playDoubleJump() { this._beep({freq:680, type:'sawtooth', length:0.14, attack:0.005, decay:0.12, gain:0.5}); }
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
    playLand() { this._beep({freq:160, type:'sine', length:0.08, attack:0.005, decay:0.06, gain:0.35}); }
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

    playGrappleFire() { this._beep({freq:820, type:'sawtooth', length:0.12, attack:0.001, decay:0.12, gain:0.35}); }
    playGrappleAttach() {
      this._beep({freq:1080, type:'sine', length:0.16, attack:0.005, decay:0.14, gain:0.45});
      setTimeout(()=>this._beep({freq:760, type:'sine', length:0.12, attack:0.005, decay:0.08, gain:0.35}), 90);
    }
    playGrappleRelease() { this._beep({freq:420, type:'triangle', length:0.12, attack:0.005, decay:0.12, gain:0.32}); }
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

  // Reset best score handler
  resetScoreBtn.addEventListener('click', () => {
    if (!confirm('Reset saved best score?')) return;
    localStorage.removeItem('parkour.bestScore');
    game.bestScore = 0;
    alert('Best score reset.');
  });

  // Utility functions
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rectIntersect(a,b){
    return !(a.x+a.w <= b.x || a.x >= b.x+b.w || a.y+a.h <= b.y || a.y >= b.y+b.h);
  }

  // Level definition (longer)
  const LEVEL_LENGTH = 22000; // extended
  const groundY = 420;
  let platforms = [];
  let movingPlatforms = [];
  let checkpoints = [];
  let animals = [];
  let items = []; // pickups (grapple etc.)

  function makePlatform(x,y,w,h=20,type='static',opts={}){
    const p = {x,y,w,h,type, ...opts};
    if(type === 'moving') movingPlatforms.push(p);
    else platforms.push(p);
    return p;
  }

  // Create long ground
  makePlatform(-400, groundY, LEVEL_LENGTH + 800, 140);

  // Add dense parkour features and item placements
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
        makePlatform(x, groundY - 120, 140, 16, 'moving', {
          vx: 80, range: 360, baseX: x, dir: 1
        });
        animals.push({x: x+24, y: groundY - 160, w:18, h:16, saved:false, id:'a'+x});
        // place grapple item occasionally
        if (Math.random() < 0.35) items.push({x: x+60, y: groundY - 160 - 28, w:18, h:18, type:'grapple', picked:false, id:'g'+x});
        x += 480;
      } else if (style === 2) {
        makePlatform(x, groundY - 260, 34, 260);
        makePlatform(x+180, groundY - 200, 34, 200);
        animals.push({x: x+88, y: groundY - 300, w:18, h:16, saved:false, id:'a'+x});
        if (Math.random() < 0.25) items.push({x: x+30, y: groundY - 260 - 26, w:18, h:18, type:'grapple', picked:false, id:'g'+x});
        x += 320;
      } else if (style === 3) {
        for(let i=0;i<5;i++){
          makePlatform(x, groundY - 30 - i*32, 100, 16);
          x+=130;
        }
        makePlatform(x, groundY - 200, 130, 16, 'moving', {vx:90, range:380, baseX:x, dir:-1});
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
    wasOnGround:false,
    hasGrapple:false // inventory flag
  };

  // Game state
  const game = {
    player: JSON.parse(JSON.stringify(player0)),
    cameraX: 0,
    camW: VIEW_W,
    camH: VIEW_H,
    animals: animals, // array of {x,y,w,h,saved,id}
    items: items,     // pickups
    checkpoints: checkpoints,
    checkpointIndex: 0,
    savedAnimalsSet: new Set(),
    lives: 3,
    gravity: 1800,
    lastTime: performance.now(),
    paused:false,
    // scoring
    score: 0,
    bestScore: 0,
    comboCount: 0,
    lastRescueTime: 0,
    comboWindowMs: 3000, // 3s to chain combo
    // popups
    popups: [], // each: {x,y,text,ttl,vx,vy,color,alpha}
    // grapple state
    grapple: {
      enabled: false,
      attached: false,
      attachX: 0,
      attachY: 0,
      length: 0,
      maxRange: 520,
      cooldownMs: 300,
      lastFire: 0
    },
    // finished/timer flags
    timerStarted: false,
    startTime: null,
    finishTimeMs: null,
    finished: false,

    init(){
      this.loadProgress();
      this.loadBestScore();
      this.respawnToCheckpoint(true);
      statusEl.textContent = `Animals saved: ${this.savedAnimalsSet.size} | Checkpoint: ${this.checkpointIndex}`;
      // wire release key 'e'
      window.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'e') this.releaseGrapple();
      });
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
      // update popups (time-based)
      for (let i = this.popups.length - 1; i >= 0; i--) {
        const p = this.popups[i];
        p.ttl -= dt * 1000;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy -= 50 * dt; // slight upward deceleration
        p.alpha = Math.max(0, p.ttl / p.maxTtl);
        if (p.ttl <= 0) this.popups.splice(i, 1);
      }

      if (this.finished) return; // freeze gameplay when finished

      // grapple behaviour when attached: apply constraint forces / swinging
      if (this.grapple.attached) {
        this.applyGrapplePhysics(dt);
      }

      // decay combo if expired
      if (this.comboCount > 0 && (performance.now() - this.lastRescueTime) > this.comboWindowMs) {
        this.comboCount = 0;
      }

      this.handleInput(dt);
      this.applyPhysics(dt);
      this.updateMovingPlatforms(dt);
      this.checkAnimalPickup();
      this.checkItemPickup();
      this.checkCheckpoints();

      // start timer on first meaningful movement
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
        sound.playCheckpoint();
        alert(`Finished! Time: ${this.formatTime(this.finishTimeMs)} — Score: ${this.score}`);
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
      statusEl.textContent = `Animals saved: ${this.savedAnimalsSet.size} | Checkpoint: ${this.checkpointIndex} | Lives: ${this.lives}`;
    },

    // GRAPPLE: convert canvas coords to world coords then fire
    fireGrappleAtCanvas(canvasX, canvasY) {
      // require that player has grapple item
      if (!this.player.hasGrapple) return;
      const now = performance.now();
      if (now - this.grapple.lastFire < this.grapple.cooldownMs) return;
      this.grapple.lastFire = now;
      // compute world coords
      const wx = canvasX + this.cameraX;
      const wy = canvasY;
      this.fireGrappleTowards(wx, wy);
    },

    fireGrappleTowards(targetX, targetY) {
      // play sound
      sound.playGrappleFire();
      // if already attached, do nothing (or re-seat)
      if (this.grapple.attached) return;
      const p = this.player;
      const sx = p.x + p.w/2;
      const sy = p.y + p.h/2;
      // clamp range to maxRange
      const dx = targetX - sx, dy = targetY - sy;
      const dist = Math.hypot(dx, dy);
      if (dist > this.grapple.maxRange) {
        // scale down target
        targetX = sx + dx * (this.grapple.maxRange / dist);
        targetY = sy + dy * (this.grapple.maxRange / dist);
      }
      // find intersection point with platforms by stepping along the segment
      const found = this.findHookPoint(sx, sy, targetX, targetY, 6);
      if (found) {
        this.grapple.attached = true;
        this.grapple.attachX = found.x;
        this.grapple.attachY = found.y;
        this.grapple.length = Math.hypot(found.x - sx, found.y - sy);
        sound.playGrappleAttach();
        this.spawnPopup('Hooked', found.x, found.y - 6, '#aaffff');
      } else {
        // miss: small popup near target
        this.spawnPopup('Miss', targetX, targetY, '#cccccc');
      }
    },

    // stepping raycast: returns first point inside a platform rect or null
    findHookPoint(sx, sy, tx, ty, step=6) {
      const total = Math.hypot(tx - sx, ty - sy);
      const steps = Math.max(4, Math.ceil(total / step));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = sx + (tx - sx) * t;
        const y = sy + (ty - sy) * t;
        // check against all platforms and movingPlatforms and platform-like items (so you can hook to items too)
        for (const pl of platforms.concat(movingPlatforms)) {
          if (x >= pl.x && x <= pl.x + pl.w && y >= pl.y && y <= pl.y + pl.h) {
            // clamp point to be on surface (we'll use the sampled point)
            return {x, y, platform: pl};
          }
        }
      }
      return null;
    },

    releaseGrapple() {
      if (!this.grapple.attached) return;
      this.grapple.attached = false;
      sound.playGrappleRelease();
      this.spawnPopup('Released', this.player.x + this.player.w/2, this.player.y - 8, '#ffb0b0');
    },

    // apply a spring pulling force towards attach point + allow swinging by left/right input
    applyGrapplePhysics(dt) {
      const p = this.player;
      const g = this.grapple;
      const px = p.x + p.w/2;
      const py = p.y + p.h/2;
      const dx = g.attachX - px;
      const dy = g.attachY - py;
      const dist = Math.hypot(dx, dy) || 0.0001;
      // spring force to maintain length (simple constraint)
      const stretch = dist - g.length;
      const k = 12.0; // spring stiffness
      const pullAx = (dx / dist) * (stretch * k);
      const pullAy = (dy / dist) * (stretch * k);
      // apply to velocity
      p.vx += pullAx * dt;
      p.vy += pullAy * dt;
      // allow player to "swing": left/right input adds tangential impulse
      const left = keys['arrowleft'] || keys['a'];
      const right = keys['arrowright'] || keys['d'];
      if (left !== right) {
        // tangent vector (perpendicular)
        const tx = -dy / dist;
        const ty = dx / dist;
        const swingStrength = 420; // tuning
        const dir = left ? -1 : 1;
        p.vx += tx * swingStrength * dir * dt;
        p.vy += ty * swingStrength * dir * dt;
      }
      // gentle damping to avoid runaway
      p.vx *= 0.9995;
      p.vy *= 0.9998;

      // Optional: if player gets very close, shorten the length to pull them in
      if (dist < 40) {
        g.length = Math.max(20, g.length - 220 * dt);
      }
    },

    spawnPopup(text, worldX, worldY, color = '#ffe28a') {
      const popup = {
        x: worldX,
        y: worldY,
        text: String(text),
        ttl: 1100, // ms
        maxTtl: 1100,
        vx: (Math.random() - 0.5) * 20,
        vy: -120 - Math.random() * 40,
        color,
        alpha: 1
      };
      this.popups.push(popup);
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

    formatTime(ms){
      if (ms == null || isNaN(ms)) return '0:00.000';
      const total = Math.floor(ms);
      const minutes = Math.floor(total / 60000);
      const seconds = Math.floor((total % 60000) / 1000);
      const msec = total % 1000;
      return `${minutes}:${String(seconds).padStart(2,'0')}.${String(msec).padStart(3,'0')}`;
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

      // if grapple attached, we keep physics but the grapple force was applied earlier
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
              if (!p.onGround && p.vy >= 0) sound.playLand();
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
          // scoring: base points and combo handling
          const base = 100;
          const now = performance.now();
          if (this.lastRescueTime && (now - this.lastRescueTime) <= this.comboWindowMs) {
            this.comboCount = Math.min(10, this.comboCount + 1);
          } else {
            this.comboCount = 1;
          }
          this.lastRescueTime = now;
          const multiplier = 1 + (this.comboCount - 1) * 0.25; // +25% per combo step
          const points = Math.round(base * multiplier);
          this.score += points;
          // save best
          if (this.score > this.bestScore) {
            this.bestScore = this.score;
            try { localStorage.setItem('parkour.bestScore', String(this.bestScore)); } catch(e){}
          }
          sound.playRescue();
          // spawn popup near animal (slightly above)
          this.spawnPopup(`+${points}`, a.x, a.y - 18, '#ffd24d');
          // subtle combo popup when >1
          if (this.comboCount > 1) {
            this.spawnPopup(`x${this.comboCount}`, a.x + 18, a.y - 36, '#ffb86b');
          }
          // auto-save when rescuing an animal
          this.saveProgress();
        }
      }
    },

    // item pickup handling
    checkItemPickup(){
      for (const it of this.items) {
        if (it.picked) continue;
        const ir = {x:it.x - it.w/2, y: it.y - it.h/2, w: it.w, h: it.h};
        if (rectIntersect(this.player, ir)) {
          it.picked = true;
          if (it.type === 'grapple') {
            this.player.hasGrapple = true;
            this.grapple.enabled = true;
            sound.playGrappleAttach();
            this.spawnPopup('Grapple', it.x, it.y - 12, '#aaffff');
          } else {
            this.spawnPopup('Picked', it.x, it.y - 12, '#aaffff');
          }
        }
      }
    },

    checkCheckpoints(){
      for (const cp of this.checkpoints) {
        const zone = {x:cp.x - 24, y:cp.y - 8, w:cp.w + 48, h:cp.h + 16};
        if (rectIntersect(this.player, zone)) {
          if (this.checkpointIndex < cp.idx) {
            this.checkpointIndex = cp.idx;
            // checkpoint bonus
            const bonus = 200;
            this.score += bonus;
            if (this.score > this.bestScore) {
              this.bestScore = this.score;
              try { localStorage.setItem('parkour.bestScore', String(this.bestScore)); } catch(e){}
            }
            sound.playCheckpoint();
            // spawn a checkpoint popup above the flag
            this.spawnPopup(`Checkpoint +${bonus}`, cp.x + cp.w/2, cp.y - cp.h - 8, '#8eff8a');
            this.saveProgress();
            this.player.vy = -160;
          }
        }
      }
    },

    onDeath(){
      this.lives--;
      // reset combo on death
      this.comboCount = 0;
      this.lastRescueTime = 0;
      // release grapple on death
      if (this.grapple.attached) this.releaseGrapple();
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
      for (const it of this.items) {
        // keep picked state persisted via save; items are not persisted currently except grapple ownership
        // we assume if player.hasGrapple true then grapples are already picked and items can be hidden
        if (it.type === 'grapple' && this.player.hasGrapple) it.picked = true;
      }
      this.cameraX = clamp(this.player.x - this.camW/3, 0, LEVEL_LENGTH - this.camW);
    },

    saveProgress(){
      const state = {
        checkpointIndex: this.checkpointIndex,
        savedIds: Array.from(this.savedAnimalsSet),
        score: this.score,
        hasGrapple: this.player.hasGrapple
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
          this.score = st.score || 0;
          this.player.hasGrapple = !!st.hasGrapple;
          if (this.player.hasGrapple) {
            // mark items of type grapple as picked
            for (const it of this.items) if (it.type === 'grapple') it.picked = true;
            this.grapple.enabled = true;
          }
        }
      } catch(e) {
        console.warn('Failed to load save', e);
      }
    },

    loadBestScore(){
      try {
        const raw = localStorage.getItem('parkour.bestScore');
        if (!raw) { this.bestScore = 0; return; }
        this.bestScore = parseInt(raw, 10) || 0;
      } catch(e) {
        this.bestScore = 0;
      }
    },

    clearSave(fullReset=false){
      localStorage.removeItem('parkour.save');
      this.checkpointIndex = 0;
      this.savedAnimalsSet.clear();
      for (const a of this.animals) a.saved = false;
      for (const it of this.items) it.picked = false;
      this.player.hasGrapple = false;
      this.grapple.attached = false;
      this.grapple.enabled = false;
      if (fullReset) {
        this.player = JSON.parse(JSON.stringify(player0));
        this.score = 0;
        this.comboCount = 0;
        this.lastRescueTime = 0;
      }
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

      // platforms
      ctx.fillStyle = '#6b4f3b';
      for (const pl of platforms) {
        ctx.fillStyle = '#6b4f3b';
        ctx.fillRect(pl.x, pl.y, pl.w, pl.h);
      }
      // moving platforms
      for (const pl of movingPlatforms) {
        ctx.fillStyle = '#8a6b4b';
        ctx.fillRect(pl.x, pl.y, pl.w, pl.h);
      }

      // checkpoints
      for (const cp of this.checkpoints) {
        const on = cp.idx <= this.checkpointIndex;
        ctx.fillStyle = on ? '#8eff8a' : '#4f6b5a';
        ctx.fillRect(cp.x, cp.y - 8, 6, cp.h + 16);
        ctx.fillStyle = on ? '#c6ffd1' : '#9aa9a2';
        ctx.fillRect(cp.x+6, cp.y - cp.h/2, 28, 14);
      }

      // finish marker
      ctx.fillStyle = '#ffd2d2';
      const finishX = LEVEL_LENGTH - 120;
      ctx.fillRect(finishX, groundY - 260, 8, 260);
      ctx.fillStyle = '#ff7a7a';
      ctx.fillRect(finishX+10, groundY - 200, 36, 16);

      // items (grapple pickups)
      for (const it of this.items) {
        if (it.picked) continue;
        ctx.save();
        // small icon rectangle
        ctx.fillStyle = (it.type === 'grapple') ? '#aaffff' : '#cfefff';
        ctx.fillRect(it.x - it.w/2, it.y - it.h/2, it.w, it.h);
        // tiny symbol
        ctx.fillStyle = '#043a46';
        ctx.font = '12px system-ui, Arial';
        ctx.textAlign = 'center';
        ctx.fillText(it.type === 'grapple' ? 'G' : '?', it.x, it.y + 4);
        ctx.restore();
      }

      // animals
      for (const a of this.animals) {
        if (a.saved) continue;
        ctx.fillStyle = '#ffd24d';
        ctx.fillRect(a.x-8, a.y-8, a.w, a.h);
        // simple face
        ctx.fillStyle = '#8a5a12';
        ctx.fillRect(a.x-4, a.y-4, 4, 2);
        ctx.fillRect(a.x+2, a.y-4, 4, 2);
      }

      // player
      const p = this.player;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = '#043a46';
      ctx.fillRect(p.x + (p.facing>0?20:6), p.y + 14, 6, 4);

      // draw grapple rope if attached
      if (this.grapple.attached) {
        ctx.strokeStyle = '#9fe6ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const px = p.x + p.w/2;
        const py = p.y + p.h/2;
        ctx.moveTo(px, py);
        ctx.lineTo(this.grapple.attachX, this.grapple.attachY);
        ctx.stroke();
        // small anchor marker
        ctx.fillStyle = '#aaffff';
        ctx.beginPath();
        ctx.arc(this.grapple.attachX, this.grapple.attachY, 4, 0, Math.PI*2);
        ctx.fill();
      }

      // draw popups in world space (so they move with camera)
      for (const pop of this.popups) {
        ctx.save();
        ctx.globalAlpha = pop.alpha;
        ctx.font = '18px system-ui, Arial';
        ctx.textAlign = 'center';
        // shadow/stroke for readability
        ctx.fillStyle = '#111213';
        ctx.fillText(pop.text, pop.x, pop.y + 2);
        ctx.fillStyle = pop.color;
        ctx.fillText(pop.text, pop.x, pop.y);
        ctx.restore();
      }

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
      ctx.fillText(`Animals: ${this.savedAnimalsSet.size} / ${this.animals.length}`, 18, 24);
      ctx.fillText(`Checkpoint: ${this.checkpointIndex}`, 18, 44);
      ctx.fillText(`Lives: ${this.lives}`, 18, 64);
      ctx.fillText(`Score: ${this.score}`, 18, 88);
      ctx.fillText(`Best: ${this.bestScore}`, 18, 108);
      if (this.comboCount > 0) {
        const remaining = Math.max(0, this.comboWindowMs - (performance.now() - this.lastRescueTime));
        ctx.fillText(`Combo x${this.comboCount} (${(remaining/1000).toFixed(2)}s)`, 18, 132);
      }
      // inventory display
      ctx.fillStyle = this.player.hasGrapple ? '#aaffff' : '#666';
      ctx.fillText(`Grapple: ${this.player.hasGrapple ? 'Ready' : 'None'}`, 18, 156);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(12, 164, 260, 6);
      ctx.restore();
    }
  };

  // initialize
  game.init();

  // Expose for debugging
  window.GAME = game;
  window.SOUND = sound;

})();
