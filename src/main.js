/**
 * main.js
 * Entry point. Orchestrates all game states:
 *   MENU  → PLAYING  → SHOP (checkpoint, mid-run) → resume PLAYING
 *                    → SHOP (run-end)              → startGame() restart
 */

import { Engine } from './engine.js';
import { Player } from './player.js';
import { World } from './world.js';
import { ParticleSystem, FloatingTextSystem } from './particles.js';
import { loadSave, writeSave, getStat, refreshShopUI } from './upgrades.js';
import { initAudio, playSpark, playFuel, playHit, playClick, playBgm, stopBgm } from './audio.js';

// ================================================================
//  Game State Machine
// ================================================================
const STATE = {
  MENU:    'MENU',
  PLAYING: 'PLAYING',
  SHOP:    'SHOP',
};

let currentState = STATE.MENU;

// ================================================================
//  Persistent Save Data
// ================================================================
let save = loadSave();

// ================================================================
//  DOM References
// ================================================================
const menuOverlay  = document.getElementById('menuOverlay');
const shopOverlay  = document.getElementById('shopOverlay');
const menuPlayBtn  = document.getElementById('menuPlayBtn');
const launchBtn    = document.getElementById('launchBtn');
const summaryAltEl = document.getElementById('summaryAltitude');
const summaryBestEl= document.getElementById('summaryBestAltitude');
const summaryEarnEl= document.getElementById('summaryEarned');
const shopCurrEl   = document.getElementById('shopCurrencyDisplay');

// ================================================================
//  Core Game Objects (initialized on each run)
// ================================================================
let player   = null;
let world    = null;
let particles= null;
let floatText= null;

// Run-session state
let runSparks   = 0;    // sparks collected this run
let runMaxAlt   = 0;    // max altitude this run

// ================================================================
//  Input State
// ================================================================
const keys = { left: false, right: false, boost: false };
let touchBoost = false;

// ================================================================
//  Engine
// ================================================================
const engine = new Engine('gameCanvas', update, draw);

// Rebuild world on resize
engine.onResize((w, h) => {
  if (currentState === STATE.PLAYING && world) {
    world.canvasW = w;
    world.canvasH = h;
    if (player) player.canvasW = w;
  }
});

// ================================================================
//  Game State Transitions
// ================================================================

function startGame() {
  const W = engine.width;
  const H = engine.height;

  // Build player with upgrade-derived stats
  const stats = {
    launchVy:     getStat(save, 'launcher'),
    maxFuel:      getStat(save, 'fuel'),
    magnetRadius: getStat(save, 'magnet'),
    gravityMult:  getStat(save, 'aero'),
    halo:         getStat(save, 'halo'),
  };

  player    = new Player(stats, W);
  world     = new World(W, H);
  particles = new ParticleSystem();
  floatText = new FloatingTextSystem();
  runSparks = 0;
  runMaxAlt = 0;

  currentState = STATE.PLAYING;
  menuOverlay.classList.add('hidden');
  shopOverlay.classList.add('hidden');
  playBgm();
}

function endRun() {
  currentState = STATE.SHOP;
  stopBgm();

  // Altitude bonus: 1 spark per 10 meters
  const altBonus = Math.floor(runMaxAlt / 10);
  const totalEarned = runSparks + altBonus;

  save.sparks += totalEarned;
  if (runMaxAlt > (save.bestAltitude || 0)) {
    save.bestAltitude = Math.floor(runMaxAlt);
  }
  writeSave(save);

  // Update summary UI
  if (summaryBestEl) summaryBestEl.textContent = `${Math.floor(save.bestAltitude || 0).toLocaleString()}m`;
  if (summaryAltEl) summaryAltEl.textContent = `${Math.floor(runMaxAlt).toLocaleString()}m`;
  if (summaryEarnEl) summaryEarnEl.textContent = `+${totalEarned} (${runSparks} sparks + ${altBonus} alt bonus)`;
  if (shopCurrEl)    shopCurrEl.textContent = save.sparks.toLocaleString();

  // Button says LAUNCH (will call startGame on click)
  launchBtn.innerHTML = '<span class="btn-icon">▲</span> LAUNCH';

  // Render shop
  refreshShopUI(save, (updatedSave) => {
    save = updatedSave;
  });

  shopOverlay.classList.remove('hidden');
}

// ================================================================
//  Update  (called every frame by Engine)
// ================================================================
function update(dt) {
  if (currentState !== STATE.PLAYING || !player) return;

  // Merge keyboard + touch boost
  const inputKeys = {
    left: keys.left,
    right: keys.right,
    boost: keys.boost || touchBoost,
  };

  player.update(dt, inputKeys);

  // Emit thruster particles when boosting
  if (player.isBoosting) {
    // Emit from bottom of moth
    particles.emitThrust(player.x, player.y - 22, 2);
  }

  const magnetRadius = getStat(save, 'magnet');

  world.update(
    dt,
    player,
    magnetRadius,
    // onSparkCollected
    (value, x, y) => {
      runSparks += value;
      floatText.spawn(x, y, `+${value} ◈`);
      playSpark();
    },
    // onHazardHit
    (p) => {
      p.onHazardHit();
      playHit();
    },
    // onFuelCollected — refill fuel and show floating text
    (amount, x, y) => {
      player.refillFuel(amount);
      floatText.spawn(x, y, `+⚡ FUEL`, '#00ff88');
      playFuel();
    },
    particles
  );

  particles.update(dt);
  floatText.update(dt);

  // Track max altitude
  const altitude = player.y; // world Y is altitude in world units
  if (altitude > runMaxAlt) runMaxAlt = altitude;

  // ---- Run-end condition ----
  // Player is out of fuel (and halos) AND has fallen below the camera's bottom edge.
  const fuelEmpty      = player.fuel <= 0 && player.attachedHalos.length === 0;
  const belowCameraFloor = player.y < world.camY - 30;
  if (fuelEmpty && belowCameraFloor) {
    endRun();
  }
}

// ================================================================
//  Draw  (called every frame by Engine)
// ================================================================
function draw(ctx, W, H) {
  if (currentState === STATE.MENU) {
    drawMenuBackground(ctx, W, H);
    return;
  }

  if (currentState === STATE.PLAYING && player && world) {
    const camY = world.camY;

    // World
    world.draw(ctx, player.y);

    // Particles
    particles.draw(ctx, camY, H);

    // Player
    const screenX = player.x;
    const screenY = world.worldToScreenY(player.y);
    player.draw(ctx, screenX, screenY);
    player.drawDetached(ctx, world.worldToScreenY.bind(world));

    // Floating text
    floatText.draw(ctx, camY, H);

    // HUD
    drawHUD(ctx, W, H);
  }

  if (currentState === STATE.SHOP) {
    // Draw a blurred background behind the shop overlay
    drawShopBackground(ctx, W, H);
  }
}

// ================================================================
//  HUD Drawing
// ================================================================
function drawHUD(ctx, W, H) {
  const altitude = Math.floor(player.y);
  const sparks   = runSparks;
  const PADDING  = 14;

  ctx.save();

  // Fuel bar
  const barW = 120;
  const barH = 8;
  player.drawFuelBar(ctx, PADDING, PADDING + 2, barW, barH);

  // Fuel label
  ctx.font = `9px 'Share Tech Mono', monospace`;
  ctx.fillStyle = 'rgba(0,255,255,0.6)';
  ctx.textAlign = 'left';
  ctx.shadowBlur = 0;
  ctx.fillText('FUEL', PADDING, PADDING + barH + 14);

  // Sparks count
  ctx.font = `bold 13px 'Orbitron', monospace`;
  ctx.fillStyle = '#ffd700';
  ctx.shadowColor = '#ffd700';
  ctx.shadowBlur = 6;
  ctx.fillText(`◈ ${sparks}`, PADDING, H - PADDING - 4);

  // Altitude & zone
  world.drawAltitudeHUD(ctx, altitude);

  ctx.restore();
}

// ================================================================
//  Menu background (animated canvas, shown while menu overlay is up)
// ================================================================
let _menuTime = 0;
function drawMenuBackground(ctx, W, H) {
  _menuTime += 0.016;
  const t = _menuTime;

  // Dark background
  ctx.fillStyle = '#05060f';
  ctx.fillRect(0, 0, W, H);

  // Animated grid
  ctx.strokeStyle = 'rgba(0,255,255,0.06)';
  ctx.lineWidth = 1;
  const gSize = 50;
  const offX = (t * 8) % gSize;
  const offY = (t * 12) % gSize;
  for (let x = -gSize + offX; x < W + gSize; x += gSize) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = -gSize + offY; y < H + gSize; y += gSize) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Central moth silhouette (decorative, large)
  ctx.save();
  ctx.translate(W / 2, H / 2 + 30);
  const scale = 3.5;
  ctx.scale(scale, scale);
  const wingFlap = Math.sin(t * 3) * 14;
  ctx.shadowColor = '#00ffff';
  ctx.shadowBlur = 30;
  ctx.strokeStyle = 'rgba(0,255,255,0.18)';
  ctx.lineWidth = 1 / scale;

  // Left wing silhouette
  ctx.beginPath();
  ctx.moveTo(-4, -4);
  ctx.bezierCurveTo(-38, -14 - wingFlap, -30, 6 - wingFlap / 2, -8, 10);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-6, 6);
  ctx.bezierCurveTo(-27, 12 - wingFlap * 0.6, -24, 20 - wingFlap * 0.4, -4, 20);
  ctx.stroke();

  // Right wing
  ctx.beginPath();
  ctx.moveTo(4, -4);
  ctx.bezierCurveTo(38, -14 - wingFlap, 30, 6 - wingFlap / 2, 8, 10);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(6, 6);
  ctx.bezierCurveTo(27, 12 - wingFlap * 0.6, 24, 20 - wingFlap * 0.4, 4, 20);
  ctx.stroke();

  ctx.restore();
}

function drawShopBackground(ctx, W, H) {
  ctx.fillStyle = 'rgba(5,6,15,0.5)';
  ctx.fillRect(0, 0, W, H);
}

// ================================================================
//  Input Handling
// ================================================================

// Keyboard
window.addEventListener('keydown', (e) => {
  if (e.code === 'ArrowLeft')  keys.left  = true;
  if (e.code === 'ArrowRight') keys.right = true;
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    keys.boost = true;
    e.preventDefault(); // prevent page scroll

    // Start game if on menu or shop
    if (currentState === STATE.MENU || currentState === STATE.SHOP) {
      initAudio();
      playClick();
      shopOverlay.classList.add('hidden');
      startGame();
    }
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'ArrowLeft')  keys.left  = false;
  if (e.code === 'ArrowRight') keys.right = false;
  if (e.code === 'Space' || e.code === 'ArrowUp') keys.boost = false;
});

// Touch / Mouse boost
document.getElementById('gameCanvas').addEventListener('mousedown', () => {
  touchBoost = true;
});
document.getElementById('gameCanvas').addEventListener('mouseup', () => {
  touchBoost = false;
});
document.getElementById('gameCanvas').addEventListener('touchstart', (e) => {
  touchBoost = true;
  e.preventDefault();
}, { passive: false });
document.getElementById('gameCanvas').addEventListener('touchend', () => {
  touchBoost = false;
});

// ================================================================
//  UI Button Wiring
// ================================================================

menuPlayBtn.addEventListener('click', () => {
  initAudio();
  playClick();
  startGame();
});

launchBtn.addEventListener('click', () => {
  initAudio();
  playClick();
  shopOverlay.classList.add('hidden');
  startGame();
});

// ================================================================
//  Initial Setup
// ================================================================

// Populate shop currency display on load
if (shopCurrEl) shopCurrEl.textContent = save.sparks.toLocaleString();

// Start the engine loop immediately (always rendering menu BG)
engine.start();

// Show menu
menuOverlay.classList.remove('hidden');
shopOverlay.classList.add('hidden');
