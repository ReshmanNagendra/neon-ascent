/**
 * player.js
 * Player class: physics state, input handling, rendering the neon moth,
 * fuel management, screen shake, and collision bounds.
 */

import { integrateVelocity, integratePosition, clamp } from './physics.js';
import { BASE_GRAVITY } from './physics.js';
import { playThrust } from './audio.js';

// Moth geometry constants (in pixels, drawn around center)
const BODY_W = 14;   // half-width
const BODY_H = 22;   // half-height
const WING_SPAN = 38; // from center to wingtip

export class Player {
  /**
   * @param {object} stats - computed from upgrades
   * @param {number} stats.launchVy   - initial upward velocity
   * @param {number} stats.maxFuel    - fuel in seconds
   * @param {number} stats.magnetRadius - spark pickup radius
   * @param {number} stats.gravityMult  - gravity multiplier
   * @param {number} canvasW
   */
  constructor(stats, canvasW) {
    // World position (Y increases upward)
    this.x = canvasW / 2;
    this.y = 0; // starts at world origin (bottom of chute)

    // Velocity
    this.vx = 0;
    this.vy = stats.launchVy; // initial launch pop

    // Upgrade-based stats
    this.gravityMult = stats.gravityMult;
    this.magnetRadius = stats.magnetRadius;
    this.maxFuel = stats.maxFuel;
    this.fuel = stats.maxFuel;

    // State
    this.isBoosting = false;
    this.isAlive = true;

    // Halo Rings logic
    this.attachedHalos = [];
    this.detachedHalos = [];
    if (stats.halo && stats.halo.count > 0) {
      for (let i = 0; i < stats.halo.count; i++) {
        this.attachedHalos.push({
          fuel: stats.halo.capacity,
          maxFuel: stats.halo.capacity,
          offsetY: 20 + i * 14 // spacing below moth
        });
      }
    }

    // Thrust power per second (was 620 — reduced so boost doesn't feel instant)
    this.BOOST_POWER = 380;
    // Horizontal steering force (was 320 — gentler so player can make fine adjustments)
    this.STEER_FORCE = 200;
    // Max horizontal speed (was 320)
    this.MAX_VX = 220;
    // Canvas width for clamping
    this.canvasW = canvasW;

    // Wing animation phase
    this._wingPhase = 0;

    // Screen shake state
    this._shakeTime = 0;
    this._shakeMag = 0;

    // Max altitude reached this run
    this.maxY = 0;

    // Invincibility frames after hit (seconds)
    this._invincible = 0;
  }

  // ---- Input-driven setters (called from main.js) ----

  /** Called when boost input is held */
  setBoost(boosting) {
    if (boosting && this.fuel > 0) {
      this.isBoosting = true;
    } else {
      this.isBoosting = false;
    }
  }

  /** Steer left (dx = -1) or right (dx = +1) or stop (0) */
  steer(dx) {
    this._steerDir = dx;
  }

  // ---- Collision bounds (AABB in world space) ----
  get bounds() {
    return {
      x: this.x - BODY_W,
      y: this.y - BODY_H,
      w: BODY_W * 2,
      h: BODY_H * 2,
    };
  }

  // ---- Hit reaction ----
  /** Called when colliding with a hazard. */
  onHazardHit() {
    if (this._invincible > 0) return false; // already invincible
    
    // Slow down instead of stopping completely
    this.vy *= 0.4;
    this.vx *= 0.4;
    
    // Deduct a fixed amount of fuel on hit (1.5 seconds worth)
    this.drainFuel(0.5);

    this._shakeTime = 0.35;
    this._shakeMag = 14;
    this._invincible = 1.2; // 1.2 seconds of invincibility
    return true;
  }

  // ---- Update ----
  /**
   * @param {number} dt - seconds
   * @param {object} keys - { left, right, boost }
   */
  update(dt, keys) {
    if (!this.isAlive) return;

    // Update invincibility timer
    if (this._invincible > 0) this._invincible -= dt;

    // Update detached halos physics
    for (let i = this.detachedHalos.length - 1; i >= 0; i--) {
      const dh = this.detachedHalos[i];
      dh.vy -= BASE_GRAVITY * 1.5 * dt; // fall down
      dh.x += dh.vx * dt;
      dh.y += dh.vy * dt;
      dh.alpha -= dt * 0.5;
      if (dh.alpha <= 0 || dh.y < this.y - 1000) {
        this.detachedHalos.splice(i, 1);
      }
    }

    // Boost
    this.isBoosting = keys.boost && (this.fuel > 0 || this.attachedHalos.length > 0);
    if (this.isBoosting) {
      this.vy += this.BOOST_POWER * dt;

      // Drain fuel from attached halos first (bottom to top), then main fuel
      this.drainFuel(dt);
      this._wingPhase += dt * 18; // fast wing flap
    } else {
      this._wingPhase += dt * 5; // idle flap
    }

    // Steer
    const steerDir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (steerDir !== 0) {
      this.vx += steerDir * this.STEER_FORCE * dt;
      this.vx = clamp(this.vx, -this.MAX_VX, this.MAX_VX);
    }

    // Physics integration
    const gravity = BASE_GRAVITY * this.gravityMult;
    integrateVelocity(this, dt, gravity, this.isBoosting);
    integratePosition(this, dt);

    // Clamp to canvas horizontal bounds
    const margin = WING_SPAN;
    this.x = clamp(this.x, margin, this.canvasW - margin);
    if (this.x === margin || this.x === this.canvasW - margin) {
      this.vx *= -0.5; // bounce off walls
    }

    // Sound effect
    playThrust(this.isBoosting);

    // Track max altitude
    if (this.y > this.maxY) this.maxY = this.y;

    // Screen shake decay
    if (this._shakeTime > 0) {
      this._shakeTime -= dt;
      this._shakeMag *= 0.88;
    }
  }

  /** Returns current screen shake offset [dx, dy]. */
  getShake() {
    if (this._shakeTime <= 0) return [0, 0];
    return [
      (Math.random() - 0.5) * this._shakeMag * 2,
      (Math.random() - 0.5) * this._shakeMag * 2,
    ];
  }

  /** Drains fuel, detaching halos if they run out. */
  drainFuel(amount) {
    let remaining = amount;
    
    // Drain attached halos first, from bottom to top
    while (remaining > 0 && this.attachedHalos.length > 0) {
      const bottomHalo = this.attachedHalos[this.attachedHalos.length - 1];
      if (bottomHalo.fuel > remaining) {
        bottomHalo.fuel -= remaining;
        remaining = 0;
      } else {
        remaining -= bottomHalo.fuel;
        // Detach
        this.attachedHalos.pop();
        this.detachedHalos.push({
          x: this.x,
          y: this.y - bottomHalo.offsetY,
          vx: (Math.random() - 0.5) * 60,
          vy: this.vy * 0.3 - 30, // detaches with some momentum
          alpha: 1.0,
          width: 20,
        });
      }
    }
    
    // Drain main fuel if halos are exhausted
    if (remaining > 0) {
      this.fuel = Math.max(0, this.fuel - remaining);
    }
  }

  /** Refill main fuel, then fill halos if main is full */
  refillFuel(amount) {
    let remaining = amount;

    // Fill main tank first
    const mainNeeds = this.maxFuel - this.fuel;
    if (remaining > mainNeeds) {
      this.fuel = this.maxFuel;
      remaining -= mainNeeds;
    } else {
      this.fuel += remaining;
      return;
    }

    // Fill halos top to bottom
    for (const halo of this.attachedHalos) {
      const haloNeeds = halo.maxFuel - halo.fuel;
      if (remaining > haloNeeds) {
        halo.fuel = halo.maxFuel;
        remaining -= haloNeeds;
      } else {
        halo.fuel += remaining;
        return;
      }
    }
  }

  // ---- Rendering ----
  /**
   * Draw the moth at its world position, projected to screen.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} screenX - already converted screen X
   * @param {number} screenY - already converted screen Y
   */
  draw(ctx, screenX, screenY) {
    const t = this._wingPhase;
    const wingFlap = Math.sin(t) * 10; // wing flap amplitude
    const isBlink = this._invincible > 0 && Math.floor(this._invincible * 10) % 2 === 0;
    if (isBlink) return; // blink when invincible

    ctx.save();
    ctx.translate(screenX, screenY);

    // Glow base
    ctx.shadowBlur = 18;

    // ---- Body ----
    ctx.shadowColor = '#00ffff';
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Sleek oval body
    ctx.ellipse(0, 0, BODY_W - 2, BODY_H, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Body inner highlight
    ctx.strokeStyle = 'rgba(0,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, -4, BODY_W - 6, BODY_H - 8, 0, 0, Math.PI * 2);
    ctx.stroke();

    // ---- Wings ----
    // Left wing
    ctx.shadowColor = '#ff00ff';
    ctx.strokeStyle = '#ff00ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    // Upper wing
    ctx.moveTo(-4, -4);
    ctx.bezierCurveTo(
      -WING_SPAN, -14 - wingFlap,
      -WING_SPAN + 8, 6 - wingFlap / 2,
      -8, 10
    );
    ctx.stroke();

    // Lower wing
    ctx.beginPath();
    ctx.moveTo(-6, 6);
    ctx.bezierCurveTo(
      -WING_SPAN * 0.7, 12 - wingFlap * 0.6,
      -WING_SPAN * 0.6, 20 - wingFlap * 0.4,
      -4, 20
    );
    ctx.stroke();

    // Right wing (mirror)
    ctx.beginPath();
    ctx.moveTo(4, -4);
    ctx.bezierCurveTo(
      WING_SPAN, -14 - wingFlap,
      WING_SPAN - 8, 6 - wingFlap / 2,
      8, 10
    );
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(6, 6);
    ctx.bezierCurveTo(
      WING_SPAN * 0.7, 12 - wingFlap * 0.6,
      WING_SPAN * 0.6, 20 - wingFlap * 0.4,
      4, 20
    );
    ctx.stroke();

    // ---- Wing fill glow ----
    const wingGrad = ctx.createLinearGradient(-WING_SPAN, 0, WING_SPAN, 0);
    wingGrad.addColorStop(0, 'rgba(255,0,255,0.06)');
    wingGrad.addColorStop(0.5, 'rgba(0,255,255,0.04)');
    wingGrad.addColorStop(1, 'rgba(255,0,255,0.06)');
    ctx.fillStyle = wingGrad;

    // Fill left wing shape
    ctx.beginPath();
    ctx.moveTo(-4, -4);
    ctx.bezierCurveTo(-WING_SPAN, -14 - wingFlap, -WING_SPAN + 8, 6 - wingFlap / 2, -8, 10);
    ctx.lineTo(-6, 6);
    ctx.bezierCurveTo(-WING_SPAN * 0.6, 20 - wingFlap * 0.4, -WING_SPAN * 0.7, 12 - wingFlap * 0.6, -6, 6);
    ctx.closePath();
    ctx.fill();

    // ---- Antennae ----
    ctx.shadowColor = '#00ffff';
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 1;
    // Left antenna
    ctx.beginPath();
    ctx.moveTo(-5, -BODY_H + 2);
    ctx.quadraticCurveTo(-16, -BODY_H - 12, -20, -BODY_H - 18);
    ctx.stroke();
    // Tip dot
    ctx.beginPath();
    ctx.arc(-20, -BODY_H - 18, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#00ffff';
    ctx.shadowBlur = 10;
    ctx.fill();

    // Right antenna
    ctx.shadowBlur = 18;
    ctx.strokeStyle = '#00ffff';
    ctx.beginPath();
    ctx.moveTo(5, -BODY_H + 2);
    ctx.quadraticCurveTo(16, -BODY_H - 12, 20, -BODY_H - 18);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(20, -BODY_H - 18, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#00ffff';
    ctx.fill();

    // ---- Eyes ----
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-5, -8, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(5, -8, 2, 0, Math.PI * 2);
    ctx.fill();

    // ---- Boost flame (thruster) ----
    if (this.isBoosting) {
      const flameLen = 18 + Math.random() * 12;
      const flameGrad = ctx.createLinearGradient(0, BODY_H, 0, BODY_H + flameLen);
      flameGrad.addColorStop(0, 'rgba(255,255,255,0.9)');
      flameGrad.addColorStop(0.3, 'rgba(0,255,255,0.8)');
      flameGrad.addColorStop(1, 'rgba(255,0,255,0)');
      ctx.shadowColor = '#00ffff';
      ctx.shadowBlur = 20;
      ctx.strokeStyle = flameGrad;
      ctx.lineWidth = 5 + Math.random() * 3;
      ctx.beginPath();
      ctx.moveTo(0, BODY_H);
      ctx.lineTo((Math.random() - 0.5) * 6, BODY_H + flameLen);
      ctx.stroke();
    }

    // ---- Halos (Attached) ----
    for (const halo of this.attachedHalos) {
      const fillRatio = halo.fuel / halo.maxFuel;
      ctx.strokeStyle = `rgba(0, 255, 136, ${0.4 + 0.6 * fillRatio})`;
      ctx.shadowColor = '#00ff88';
      ctx.shadowBlur = 8;
      ctx.lineWidth = 2;
      ctx.beginPath();
      // Draw a flattened ellipse to look like a ring seen from an angle
      ctx.ellipse(0, halo.offsetY, 18, 6, 0, 0, Math.PI * 2);
      ctx.stroke();
      
      // Draw a solid bar inside representing fuel level
      ctx.fillStyle = '#00ff88';
      const fillW = 16 * fillRatio;
      ctx.fillRect(-fillW / 2, halo.offsetY - 2, fillW, 4);
    }

    ctx.restore();
  }

  /** Draw detached halos falling away */
  drawDetached(ctx, worldToScreenY) {
    for (const dh of this.detachedHalos) {
      const screenY = worldToScreenY(dh.y);
      ctx.save();
      ctx.translate(dh.x, screenY);
      ctx.strokeStyle = `rgba(255, 68, 68, ${dh.alpha})`;
      ctx.shadowColor = `rgba(255, 68, 68, ${dh.alpha})`;
      ctx.shadowBlur = 10;
      ctx.lineWidth = 2;
      ctx.beginPath();
      // Tilt it randomly as it falls
      ctx.rotate(dh.alpha * 5); 
      ctx.ellipse(0, 0, dh.width, 6, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---- Fuel Bar (HUD) ----
  /**
   * Draw fuel bar on the HUD.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - screen X of the bar left edge
   * @param {number} y - screen Y of the bar top edge
   * @param {number} w - bar width
   * @param {number} h - bar height
   */
  drawFuelBar(ctx, x, y, w, h) {
    const ratio = this.maxFuel > 0 ? this.fuel / this.maxFuel : 0;
    const fuelColor = ratio > 0.35 ? '#00ffff' : ratio > 0.15 ? '#ffd700' : '#ff2244';

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
    ctx.fill();

    // Fill
    if (ratio > 0) {
      ctx.shadowColor = fuelColor;
      ctx.shadowBlur = 8;
      ctx.fillStyle = fuelColor;
      ctx.beginPath();
      ctx.roundRect(x, y, w * ratio, h, h / 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
    ctx.stroke();
  }
}
