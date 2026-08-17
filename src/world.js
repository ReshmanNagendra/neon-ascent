/**
 * world.js
 * Manages the camera, procedural world generation (hazards + sparks),
 * parallax backgrounds, and draws all world elements.
 */

import { aabbOverlap, circleAabbOverlap } from './physics.js';

// ---- Tuning constants ----
const CHUNK_HEIGHT        = 600;  // World units per generation chunk
const HAZARDS_PER_CHUNK   = 1;    // Max hazards per chunk
const SPARKS_PER_CHUNK    = 7;    // Max sparks per chunk
const FUEL_PER_CHUNK      = 2;    // Max fuel canisters per chunk
const SPARK_VALUE_BASE    = 5;    // Base spark value
const ZONE_CHANGE_ALT     = 1200; // Altitude where zone changes
const CLEAR_ZONE_HEIGHT   = 100;  // No hazards below this world-Y
const FUEL_START_HEIGHT   = 200;  // Fuel canisters don't appear below this altitude
const FUEL_RESTORE_AMOUNT = 10;  // Completely restores all fuel

export class World {
  /**
   * @param {number} canvasW
   * @param {number} canvasH
   */
  constructor(canvasW, canvasH) {
    this.canvasW = canvasW;
    this.canvasH = canvasH;

    // Camera tracks the world Y of the screen's CENTER
    this.camY = 0;     // world Y of the screen bottom
    this._camYTarget = 0;

    /** @type {Hazard[]} */
    this.hazards = [];

    /** @type {Spark[]} */
    this.sparks = [];

    /** @type {FuelCanister[]} */
    this.fuelCanisters = [];

    /** @type {ShieldPowerup[]} */
    this.shields = [];

    /** @type {BoostPowerup[]} */
    this.boosts = [];

    /** Highest chunk we've generated (measured in CHUNK_HEIGHT units) */
    this._generatedUpTo = 0;

    /** Current world/dimension level (1 = Normal, 2 = Alien, 3 = Void, 4 = Quantum) */
    this.currentWorld = 1;

    // Parallax star layers
    this._stars = this._generateStars(200);

    // Background pipe segments for cyberpunk chute walls
    this._pipes = this._generatePipes();

    // Screen shake offset applied to all rendering
    this._shakeX = 0;
    this._shakeY = 0;

    // Time accumulator for animations
    this._time = 0;

    // Pre-generate the first few chunks
    this._generateChunks(3);
  }

  // ---- Stars / Parallax ----
  _generateStars(count) {
    const stars = [];
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * this.canvasW,
        y: Math.random() * 10000, // world Y
        size: Math.random() * 1.8 + 0.3,
        speed: 0.05 + Math.random() * 0.25, // parallax factor
        color: Math.random() > 0.5 ? '#00ffff' : (Math.random() > 0.5 ? '#ff00ff' : '#ffffff'),
        phase: Math.random() * Math.PI * 2,
      });
    }
    return stars;
  }

  _generatePipes() {
    const pipes = [];
    const segH = 80;
    const totalSegs = 300; // enough for very high runs
    for (let i = 0; i < totalSegs; i++) {
      // Left wall segment
      pipes.push({
        side: 'left',
        worldY: i * segH,
        h: segH,
        hasLight: Math.random() > 0.7,
        lightColor: Math.random() > 0.5 ? '#00ffff' : '#ff00ff',
      });
      // Right wall segment
      pipes.push({
        side: 'right',
        worldY: i * segH,
        h: segH,
        hasLight: Math.random() > 0.7,
        lightColor: Math.random() > 0.5 ? '#ff00ff' : '#00ffff',
      });
    }
    return pipes;
  }

  // ---- Chunk Generation ----
  /**
   * Ensure world is generated up to `chunksAhead` chunks above camY.
   */
  ensureGenerated(camTopY, playerFuelRatio = 1.0) {
    const neededChunk = Math.floor(camTopY / CHUNK_HEIGHT) + 3;
    while (this._generatedUpTo < neededChunk) {
      this._generateChunks(1, this._generatedUpTo, playerFuelRatio);
      this._generatedUpTo++;
    }
  }

  _generateChunks(count, startChunk = 0, playerFuelRatio = 1.0) {
    for (let c = startChunk; c < startChunk + count; c++) {
      const baseY = c * CHUNK_HEIGHT;

      // Skip hazard spawning entirely for the clear launch zone.
      // The first ~100m gives the player time to orient before obstacles appear.
      if (baseY < CLEAR_ZONE_HEIGHT) {
        // Still spawn sparks in the clear zone so the player has something to collect
        const numSparks = Math.floor(SPARKS_PER_CHUNK * 0.5);
        for (let i = 0; i < numSparks; i++) {
          const margin = 60;
          const x = margin + Math.random() * (this.canvasW - margin * 2);
          // Keep sparks above the clear-zone floor
          const y = CLEAR_ZONE_HEIGHT + 20 + Math.random() * (CHUNK_HEIGHT - 40);
          this.sparks.push(new Spark(x, y, SPARK_VALUE_BASE));
        }
        continue;
      }

      // Difficulty ramps gradually from 0 → 1 between 100m and 12 000m.
      // Using a slower exponent keeps early-game light and late-game punishing.
      let difficulty = Math.min(1.0, Math.pow((baseY - CLEAR_ZONE_HEIGHT) / 12000, 0.7));
      
      // World scaling: Each new world increases base difficulty
      const worldScale = this.currentWorld - 1; // 0 for world 1, 1 for world 2, etc.
      difficulty = Math.min(1.5, difficulty + worldScale * 0.3); // Cap max difficulty at 1.5

      // Hazard count: significantly reduced. Max 1 per chunk, scaling with difficulty.
      const maxHazards = 1 + Math.floor(worldScale / 2); // Can have more hazards in higher worlds
      const numHazards = Math.random() < (0.4 + difficulty * 0.6) ? maxHazards : 0;
      const numSparks  = Math.floor(SPARKS_PER_CHUNK * (0.5 + Math.min(1.0, difficulty) * 0.5));

      // Spawn hazards — ensure a clear corridor on at least one side so the
      // player always has a way through (never a full-width wall).
      const corridorSide = Math.random() > 0.5 ? 'left' : 'right'; // side of the gap
      for (let i = 0; i < numHazards; i++) {
        const margin = 70;
        // Width grows with difficulty but never exceeds 55% of canvas
        const maxW = Math.min(this.canvasW * 0.55, 40 + difficulty * 80);
        const w = 30 + Math.random() * (maxW - 30);
        const h = 18 + Math.random() * 18;

        // Bias placement away from the corridor side so there's always a gap
        let x;
        if (corridorSide === 'left') {
          // Gap is on the left — place hazards toward the right
          x = (this.canvasW * 0.35) + Math.random() * (this.canvasW * 0.65 - w - margin);
        } else {
          x = margin + Math.random() * (this.canvasW * 0.65 - w - margin);
        }
        x = Math.max(margin, Math.min(x, this.canvasW - margin - w));

        const y = baseY + 80 + Math.random() * (CHUNK_HEIGHT - 160);
        this.hazards.push(new Hazard(x, y, w, h));
      }

      // Spawn sparks
      for (let i = 0; i < numSparks; i++) {
        const margin = 60;
        const x = margin + Math.random() * (this.canvasW - margin * 2);
        const y = baseY + 40 + Math.random() * (CHUNK_HEIGHT - 80);
        const value = SPARK_VALUE_BASE + Math.floor(baseY / 1000) * 5;
        this.sparks.push(new Spark(x, y, value));
      }

      // Spawn fuel canisters — adaptive to player's current fuel level
      if (baseY >= FUEL_START_HEIGHT) {
        // Base chance is low if full, high if starving
        let fuelChance = 0.2; // default
        
        // Boost chance based on altitude (up to +0.3 at 100k)
        const altitudeBonus = Math.min(0.3, baseY / 100000);
        fuelChance += altitudeBonus;

        // Massive adjustment based on current fuel levels
        if (playerFuelRatio < 0.3) {
          fuelChance += 0.6; // High desperation -> high spawn rate (up to 100%)
        } else if (playerFuelRatio > 0.8) {
          fuelChance -= 0.3; // Very full -> rarely spawn
        }

        fuelChance = Math.max(0, Math.min(1.0, fuelChance));

        // Chance for a double fuel spawn if fuel is extremely low
        const doubleChance = (playerFuelRatio < 0.15) ? 0.5 : (playerFuelRatio < 0.4 ? 0.2 : 0);
        const numFuel = Math.random() < fuelChance ? (Math.random() < doubleChance ? 2 : 1) : 0;
        
        for (let i = 0; i < numFuel; i++) {
          const margin = 80;
          const x = margin + Math.random() * (this.canvasW - margin * 2);
          const bandH = CHUNK_HEIGHT / (numFuel || 1);
          const y = baseY + bandH * i + bandH * 0.2 + Math.random() * bandH * 0.6;
          this.fuelCanisters.push(new FuelCanister(x, y));
        }
      }

      // Spawn Powerups (Shield and Boost) starting from 25,000m
      if (baseY >= 25000) {
        if (Math.random() < 0.05) { // 5% chance per chunk
          const margin = 80;
          const x = margin + Math.random() * (this.canvasW - margin * 2);
          const y = baseY + Math.random() * CHUNK_HEIGHT;
          this.shields.push(new ShieldPowerup(x, y));
        }
        if (Math.random() < 0.05) { // 5% chance per chunk
          const margin = 80;
          const x = margin + Math.random() * (this.canvasW - margin * 2);
          const y = baseY + Math.random() * CHUNK_HEIGHT;
          this.boosts.push(new BoostPowerup(x, y));
        }
      }
    }
  }

  // ---- Camera ----
  /**
   * Smoothly follow the player's Y, keeping them in the lower-third of screen.
   * @param {number} playerY - player world Y
   * @param {number} dt
   */
  updateCamera(playerY, dt) {
    // Keep player at ~35% from bottom of screen when ascending
    const targetCamY = playerY - this.canvasH * 0.35;
    // Clamp so we never go below ground
    const clamped = Math.max(0, targetCamY);

    // Only scroll UP — never follow the player downward.
    // This locks the camera at the player's peak, creating the
    // natural game-over boundary at the camera's bottom edge.
    if (clamped > this._camYTarget) {
      this._camYTarget = clamped;
    }

    // Smooth follow (only applied when target is above current camY)
    this.camY += (this._camYTarget - this.camY) * Math.min(1, dt * 8);
  }

  /** Convert world Y to screen Y (canvas Y, where 0 is top). */
  worldToScreenY(worldY) {
    return this.canvasH - (worldY - this.camY);
  }

  // ---- Update ----
  /**
   * @param {number} dt
   * @param {object} player
   * @param {number} magnetRadius
   * @param {Function} onSparkCollected  - callback(value, x, y)
   * @param {Function} onHazardHit       - callback(player)
   * @param {Function} onFuelCollected   - callback(amount, x, y)
   * @param {Function} onShieldCollected - callback(x, y)
   * @param {Function} onBoostCollected  - callback(x, y)
   * @param {ParticleSystem} particles
   */
  update(dt, player, magnetRadius, onSparkCollected, onHazardHit, onFuelCollected, onShieldCollected, onBoostCollected, particles) {
    this._time += dt;

    // Ensure world is generated ahead of the player
    const playerFuelRatio = player.maxFuel > 0 ? player.fuel / player.maxFuel : 1.0;
    this.ensureGenerated(player.y + this.canvasH, playerFuelRatio);

    // Camera
    this.updateCamera(player.y, dt);

    // Apply shake from player
    const [sx, sy] = player.getShake();
    this._shakeX = sx;
    this._shakeY = sy;

    // Remove items far below camera (cleanup)
    const cullY = this.camY - this.canvasH;
    this.hazards       = this.hazards.filter(h => h.y + h.h > cullY);
    this.sparks        = this.sparks.filter(s => s.y > cullY);
    this.fuelCanisters = this.fuelCanisters.filter(f => f.y > cullY);
    this.shields       = this.shields.filter(s => s.y > cullY);
    this.boosts        = this.boosts.filter(b => b.y > cullY);

    // Update hazards (movement)
    for (const h of this.hazards) {
      h.update(dt, this.canvasW);
    }

    // Update sparks (magnet pull)
    for (const spark of this.sparks) {
      if (spark.collected) continue;
      spark.update(dt, player, magnetRadius, this.canvasW);
    }

    // Collision: sparks
    const playerCenter = { x: player.x, y: player.y };
    for (const spark of this.sparks) {
      if (spark.collected) continue;
      // Use magnet radius for pickup detection
      const dx = playerCenter.x - spark.x;
      const dy = playerCenter.y - spark.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < magnetRadius * 0.55) {
        spark.collected = true;
        particles.emitDust(spark.x, spark.y);
        onSparkCollected(spark.value, spark.x, spark.y);
      }
    }

    // Collision: hazards
    if (player._invincible <= 0) {
      for (const hazard of this.hazards) {
        if (aabbOverlap(player.bounds, hazard.bounds)) {
          const hit = onHazardHit(player);
          if (hit) {
            particles.emitExplosion(player.x, player.y);
            break; // only process one hit per frame
          }
        }
      }
    }

    // Collision: fuel canisters
    for (const can of this.fuelCanisters) {
      if (can.collected) continue;
      const dx = player.x - can.x;
      const dy = player.y - can.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Greatly increased pickup radius (was can.radius + 18, now can.radius + 50)
      if (dist < can.radius + 50) {
        can.collected = true;
        particles.emitThrust(can.x, can.y, 8); // cyan burst on pickup
        onFuelCollected(FUEL_RESTORE_AMOUNT, can.x, can.y);
      }
    }

    // Collision: shields
    for (const shield of this.shields) {
      if (shield.collected) continue;
      const dx = player.x - shield.x;
      const dy = player.y - shield.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < shield.radius + 30) {
        shield.collected = true;
        particles.emitThrust(shield.x, shield.y, 8); // burst on pickup
        onShieldCollected(shield.x, shield.y);
      }
    }

    // Collision: boosts
    for (const boost of this.boosts) {
      if (boost.collected) continue;
      const dx = player.x - boost.x;
      const dy = player.y - boost.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < boost.radius + 30) {
        boost.collected = true;
        particles.emitExplosion(boost.x, boost.y); // big burst
        onBoostCollected(boost.x, boost.y);
      }
    }

  } // end update()

  // ---- Draw ----
  /**
   * Draw all world elements.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} altitude - player altitude in meters
   */
  draw(ctx, altitude) {
    ctx.save();
    ctx.translate(this._shakeX, this._shakeY);

    this._drawBackground(ctx, altitude);
    this._drawParallaxStars(ctx);
    this._drawWalls(ctx);
    this._drawHazards(ctx);
    this._drawFuelCanisters(ctx);
    this._drawPowerups(ctx);
    this._drawSparks(ctx);

    ctx.restore();
  }

  _drawPowerups(ctx) {
    const t = this._time;
    // Draw Shields
    for (const shield of this.shields) {
      if (shield.collected) continue;
      const screenY = this.worldToScreenY(shield.y);
      if (screenY > this.canvasH + 30 || screenY < -30) continue;

      const pulse = 0.7 + 0.3 * Math.sin(t * 3.5 + shield.x * 0.03);
      const r = shield.radius;

      ctx.save();
      ctx.shadowColor = '#00aaff';
      ctx.shadowBlur = 16 * pulse;

      // Outer ring
      ctx.strokeStyle = `rgba(0, 170, 255, ${0.8 * pulse})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(shield.x, screenY, r, 0, Math.PI * 2);
      ctx.stroke();

      // Inner fill
      ctx.fillStyle = `rgba(0, 170, 255, ${0.2 * pulse})`;
      ctx.fill();

      // Icon
      ctx.font = `bold ${Math.floor(r * 1.2)}px sans-serif`;
      ctx.fillStyle = `rgba(0, 170, 255, ${0.9 * pulse + 0.1})`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🛡️', shield.x, screenY + 2);

      ctx.restore();
    }

    // Draw Boosts
    for (const boost of this.boosts) {
      if (boost.collected) continue;
      const screenY = this.worldToScreenY(boost.y);
      if (screenY > this.canvasH + 30 || screenY < -30) continue;

      const pulse = 0.7 + 0.3 * Math.sin(t * 5 + boost.x * 0.03);
      const r = boost.radius;

      ctx.save();
      ctx.shadowColor = '#ff5500';
      ctx.shadowBlur = 20 * pulse;

      // Outer ring
      ctx.strokeStyle = `rgba(255, 85, 0, ${0.9 * pulse})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(boost.x, screenY, r, 0, Math.PI * 2);
      ctx.stroke();

      // Inner fill
      ctx.fillStyle = `rgba(255, 85, 0, ${0.3 * pulse})`;
      ctx.fill();

      // Icon
      ctx.font = `bold ${Math.floor(r * 1.2)}px sans-serif`;
      ctx.fillStyle = `rgba(255, 200, 0, ${0.9 * pulse + 0.1})`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🚀', boost.x, screenY + 2);

      ctx.restore();
    }
  }

  _drawBackground(ctx, altitude) {
    const { canvasW: W, canvasH: H } = this;
    const t = this._time;

    // Background gradient by World & Zone
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    let zoneColor = 'rgba(0,0,0,0)';

    if (this.currentWorld === 1) {
      // World 1: Normal Ascent
      const zone = Math.min(3, Math.floor(altitude / ZONE_CHANGE_ALT));
      if (zone === 0) {
        grad.addColorStop(0, '#050820');
        grad.addColorStop(1, '#0a0415');
      } else if (zone === 1) {
        grad.addColorStop(0, '#030b1a');
        grad.addColorStop(1, '#050820');
      } else if (zone === 2) {
        grad.addColorStop(0, '#000510');
        grad.addColorStop(1, '#030b1a');
      } else {
        grad.addColorStop(0, '#000003');
        grad.addColorStop(1, '#000510');
      }
      zoneColor = zone < 2 ? 'rgba(0,100,255,0.04)' : 'rgba(100,0,180,0.04)';
    } else if (this.currentWorld === 2) {
      // World 2: Alien Dimension (Green/Purple)
      grad.addColorStop(0, '#0a1505');
      grad.addColorStop(1, '#110214');
      zoneColor = 'rgba(50,255,50,0.05)';
    } else if (this.currentWorld === 3) {
      // World 3: The Void (Pitch Black / Red)
      grad.addColorStop(0, '#000000');
      grad.addColorStop(1, '#0f0000');
      zoneColor = 'rgba(255,0,0,0.03)';
    } else {
      // World 4: Quantum Realm (Bright/Blue)
      grad.addColorStop(0, '#021020');
      grad.addColorStop(1, '#052040');
      zoneColor = 'rgba(0,255,255,0.06)';
    }

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Ambient zone glow
    ctx.fillStyle = zoneColor;
    ctx.fillRect(0, 0, W, H);

    // Slow moving diagonal scanline stripes
    const stripeAlpha = 0.025;
    ctx.fillStyle = `rgba(0,255,255,${stripeAlpha})`;
    const stripeW = 3;
    const stripeGap = 40;
    const offset = (t * 8) % stripeGap;
    for (let sx = -H + offset; sx < W + H; sx += stripeGap) {
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx + H, H);
      ctx.lineTo(sx + H + stripeW, H);
      ctx.lineTo(sx + stripeW, 0);
      ctx.closePath();
      ctx.fill();
    }
  }

  _drawParallaxStars(ctx) {
    const t = this._time;
    for (const star of this._stars) {
      const screenY = this.canvasH - ((star.y - this.camY * star.speed) % this.canvasH);
      const twinkle = 0.5 + 0.5 * Math.sin(t * 2 + star.phase);
      ctx.save();
      ctx.globalAlpha = 0.4 * twinkle;
      ctx.fillStyle = star.color;
      ctx.shadowColor = star.color;
      ctx.shadowBlur = star.size * 2;
      ctx.beginPath();
      ctx.arc(star.x, screenY, star.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  _drawWalls(ctx) {
    const { canvasW: W, canvasH: H } = this;
    const WALL_W = 28;
    const t = this._time;

    for (const pipe of this._pipes) {
      const screenY = this.worldToScreenY(pipe.worldY + pipe.h);
      if (screenY > H + 20 || screenY < -pipe.h - 20) continue; // cull off-screen

      const x = pipe.side === 'left' ? 0 : W - WALL_W;

      // Wall body
      ctx.fillStyle = '#0a0a18';
      ctx.fillRect(x, screenY, WALL_W, pipe.h + 2);

      // Inner edge glow line
      const edgeX = pipe.side === 'left' ? x + WALL_W - 1 : x;
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(edgeX, screenY);
      ctx.lineTo(edgeX, screenY + pipe.h);
      ctx.stroke();

      // Ambient vent light
      if (pipe.hasLight) {
        const lightY = screenY + pipe.h / 2;
        const lightAlpha = 0.25 + 0.15 * Math.sin(t * 2.5 + pipe.worldY);
        ctx.save();
        ctx.globalAlpha = lightAlpha;
        ctx.fillStyle = pipe.lightColor;
        ctx.shadowColor = pipe.lightColor;
        ctx.shadowBlur = 14;
        const lw = 10;
        const lh = 5;
        const lx = pipe.side === 'left' ? x + WALL_W - lw - 2 : x + 2;
        ctx.fillRect(lx, lightY - lh / 2, lw, lh);
        ctx.restore();
      }
    }
  }

  _drawHazards(ctx) {
    const t = this._time;
    for (const hazard of this.hazards) {
      const screenY = this.worldToScreenY(hazard.y + hazard.h);
      if (screenY > this.canvasH + 50 || screenY < -hazard.h - 50) continue;

      const pulse = 0.7 + 0.3 * Math.sin(t * 3 + hazard.x);

      ctx.save();
      ctx.shadowColor = '#ff2244';
      ctx.shadowBlur = 12 * pulse;

      // Block fill
      ctx.fillStyle = 'rgba(40, 0, 10, 0.8)';
      ctx.fillRect(hazard.x, screenY, hazard.w, hazard.h);

      // Neon border
      ctx.strokeStyle = `rgba(255, 34, 68, ${0.7 * pulse + 0.3})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(hazard.x + 0.75, screenY + 0.75, hazard.w - 1.5, hazard.h - 1.5);

      // Corner crosses
      const cs = 5;
      ctx.strokeStyle = '#ff2244';
      ctx.lineWidth = 1;
      [[hazard.x + 4, screenY + 4], [hazard.x + hazard.w - 4, screenY + hazard.h - 4]].forEach(([cx, cy]) => {
        ctx.beginPath();
        ctx.moveTo(cx - cs, cy); ctx.lineTo(cx + cs, cy);
        ctx.moveTo(cx, cy - cs); ctx.lineTo(cx, cy + cs);
        ctx.stroke();
      });

      // Interior scan line
      const scanFrac = ((t * 0.7) % 1);
      const scanY = screenY + scanFrac * hazard.h;
      const scanGrad = ctx.createLinearGradient(hazard.x, scanY, hazard.x + hazard.w, scanY);
      scanGrad.addColorStop(0, 'rgba(255,34,68,0)');
      scanGrad.addColorStop(0.5, `rgba(255,34,68,${0.4 * pulse})`);
      scanGrad.addColorStop(1, 'rgba(255,34,68,0)');
      ctx.fillStyle = scanGrad;
      ctx.fillRect(hazard.x, scanY - 1, hazard.w, 2);

      ctx.restore();
    }
  }

  _drawSparks(ctx) {
    const t = this._time;
    for (const spark of this.sparks) {
      if (spark.collected) continue;
      const screenY = this.worldToScreenY(spark.y);
      if (screenY > this.canvasH + 20 || screenY < -20) continue;

      const pulse = 0.6 + 0.4 * Math.sin(t * 4 + spark.x * 0.05);
      const r = spark.radius * pulse;

      ctx.save();
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = 14 * pulse;

      // Outer glow ring
      ctx.strokeStyle = `rgba(255, 215, 0, ${0.4 * pulse})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(spark.x, screenY, r + 5, 0, Math.PI * 2);
      ctx.stroke();

      // Core circle
      const sparkGrad = ctx.createRadialGradient(spark.x, screenY, 0, spark.x, screenY, r);
      sparkGrad.addColorStop(0, '#ffffff');
      sparkGrad.addColorStop(0.4, '#ffd700');
      sparkGrad.addColorStop(1, 'rgba(255,150,0,0)');
      ctx.fillStyle = sparkGrad;
      ctx.beginPath();
      ctx.arc(spark.x, screenY, r, 0, Math.PI * 2);
      ctx.fill();

      // Value label
      if (spark.value > SPARK_VALUE_BASE) {
        ctx.globalAlpha = 0.7;
        ctx.font = `bold 9px 'Orbitron', monospace`;
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(`${spark.value}`, spark.x, screenY + r + 12);
      }

      ctx.restore();
    }
  }

  _drawFuelCanisters(ctx) {

    const t = this._time;
    for (const can of this.fuelCanisters) {
      if (can.collected) continue;
      const screenY = this.worldToScreenY(can.y);
      if (screenY > this.canvasH + 30 || screenY < -30) continue;

      const pulse = 0.7 + 0.3 * Math.sin(t * 3.5 + can.x * 0.03);
      const r = can.radius;

      ctx.save();
      ctx.shadowColor = '#00ff88';
      ctx.shadowBlur = 16 * pulse;

      // Outer pulsing ring
      ctx.strokeStyle = `rgba(0, 255, 136, ${0.35 * pulse})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(can.x, screenY, r + 7, 0, Math.PI * 2);
      ctx.stroke();

      // Canister body (rounded rectangle approximated with arc)
      const bw = r * 1.2, bh = r * 1.7;
      ctx.strokeStyle = `rgba(0, 255, 136, ${0.85 * pulse + 0.15})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(can.x - bw / 2, screenY - bh / 2, bw, bh, 3);
      ctx.stroke();

      // Fill with subtle gradient
      const grad = ctx.createLinearGradient(can.x - bw / 2, screenY, can.x + bw / 2, screenY);
      grad.addColorStop(0, 'rgba(0,255,136,0.08)');
      grad.addColorStop(0.5, 'rgba(0,255,136,0.18)');
      grad.addColorStop(1, 'rgba(0,255,136,0.08)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(can.x - bw / 2, screenY - bh / 2, bw, bh, 3);
      ctx.fill();

      // Cap on top
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(can.x - bw * 0.35, screenY - bh / 2 - 5, bw * 0.7, 5, 2);
      ctx.stroke();

      // Lightning bolt icon inside
      ctx.shadowBlur = 8;
      ctx.font = `bold ${Math.floor(r * 0.9)}px monospace`;
      ctx.fillStyle = `rgba(0,255,136,${0.8 * pulse + 0.2})`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚡', can.x, screenY + 1);
      ctx.textBaseline = 'alphabetic';

      ctx.restore();
    }
  }

  // ---- HUD helpers ----

  /**
   * Draw altitude meter and zone label.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} altitude - in meters
   */
  drawAltitudeHUD(ctx, altitude) {
    const zone = Math.min(3, Math.floor(altitude / ZONE_CHANGE_ALT));
    const zoneNames = ['DISPOSAL CHUTE', 'NEON DISTRICT', 'UPPER ATMOSPHERE', 'DEEP SPACE'];
    const zoneColors = ['#00ffff', '#ff00ff', '#88aaff', '#ffffff'];

    ctx.save();

    // Altitude text (bigger, bolder)
    ctx.font = `bold 22px 'Orbitron', monospace`;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 10;
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.floor(altitude).toLocaleString()}m`, this.canvasW - 14, 28);

    // Zone name
    ctx.font = `bold 11px 'Share Tech Mono', monospace`;
    ctx.fillStyle = zoneColors[zone];
    ctx.shadowColor = zoneColors[zone];
    ctx.shadowBlur = 8;
    ctx.fillText(zoneNames[zone], this.canvasW - 14, 44);

    ctx.restore();
  }
}

// ---- Entity classes ----

class Hazard {
  constructor(x, y, w, h) {
    this.x = x; // world X (left edge)
    this.y = y; // world Y (bottom edge, since Y increases upward)
    this.w = w;
    this.h = h;
    // Slow drifting speed (15 to 35 px/sec)
    this.vx = (Math.random() < 0.5 ? -1 : 1) * (15 + Math.random() * 20);
  }

  update(dt, canvasW) {
    this.x += this.vx * dt;
    // Bounce off walls (with margin)
    const margin = 40;
    if (this.x < margin) {
      this.x = margin;
      this.vx *= -1;
    } else if (this.x + this.w > canvasW - margin) {
      this.x = canvasW - margin - this.w;
      this.vx *= -1;
    }
  }

  get bounds() {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }
}

class Spark {
  constructor(x, y, value) {
    this.x = x;
    this.y = y;
    this.value = value;
    this.radius = 6 + Math.floor(value / 10);
    this.collected = false;
    // For magnet pull
    this._pulled = false;
  }

  /**
   * Magnetic pull toward player if within magnet radius.
   */
  update(dt, player, magnetRadius, canvasW) {
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < magnetRadius) {
      // Attract toward player
      const speed = 300 * (1 - dist / magnetRadius) + 80;
      this.x += (dx / dist) * speed * dt;
      this.y += (dy / dist) * speed * dt;
      this._pulled = true;
    }
  }
}

class FuelCanister {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 40; // visual + collision radius (doubled size)
    this.collected = false;
  }
}

class ShieldPowerup {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 24;
    this.collected = false;
  }
}

class BoostPowerup {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 24;
    this.collected = false;
  }
}
