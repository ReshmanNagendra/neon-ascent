/**
 * particles.js
 * Lightweight particle emitter for thruster trails and explosions.
 * All rendering is done via CanvasRenderingContext2D.
 */

export class ParticleSystem {
  constructor() {
    /** @type {Particle[]} */
    this.particles = [];
  }

  /**
   * Emit thruster trail particles at a position.
   * @param {number} x - World X of the emission point.
   * @param {number} y - World Y.
   * @param {number} count
   */
  emitThrust(x, y, count = 3) {
    for (let i = 0; i < count; i++) {
      this.particles.push(new Particle({
        x,
        y,
        vx: (Math.random() - 0.5) * 60,
        vy: Math.random() * 80 + 40, // downwards (world Y increases downward)
        life: 0.4 + Math.random() * 0.3,
        maxLife: 0.4 + Math.random() * 0.3,
        radius: 2 + Math.random() * 3,
        color: Math.random() > 0.5 ? '#00ffff' : '#ff00ff',
        glow: true,
      }));
    }
  }

  /**
   * Emit explosion particles (on hazard hit).
   */
  emitExplosion(x, y, count = 18) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 160;
      this.particles.push(new Particle({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.5 + Math.random() * 0.4,
        maxLife: 0.5 + Math.random() * 0.4,
        radius: 2 + Math.random() * 4,
        color: Math.random() > 0.5 ? '#ff2244' : '#ffd700',
        glow: true,
      }));
    }
  }

  /**
   * Emit ambient background dust (idle, from world).
   */
  emitDust(x, y) {
    this.particles.push(new Particle({
      x,
      y,
      vx: (Math.random() - 0.5) * 20,
      vy: (Math.random() - 0.5) * 20,
      life: 1.2,
      maxLife: 1.2,
      radius: 1,
      color: 'rgba(0,255,255,0.3)',
      glow: false,
    }));
  }

  /**
   * Update all particles by delta time.
   * @param {number} dt - seconds
   */
  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.update(dt);
      if (p.isDead()) this.particles.splice(i, 1);
    }
  }

  /**
   * Draw all particles relative to the camera offset.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} camY - World Y of camera top edge.
   * @param {number} canvasH - Canvas pixel height.
   */
  draw(ctx, camY, canvasH) {
    for (const p of this.particles) {
      const screenY = canvasH - (p.y - camY);
      const alpha = p.life / p.maxLife;

      ctx.save();
      ctx.globalAlpha = alpha * 0.9;

      if (p.glow) {
        ctx.shadowColor = p.color;
        ctx.shadowBlur = p.radius * 3;
      }

      ctx.beginPath();
      ctx.arc(p.x, screenY, p.radius * alpha, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.restore();
    }
  }
}

/** Single particle instance. */
class Particle {
  constructor({ x, y, vx, vy, life, maxLife, radius, color, glow }) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.life = life;
    this.maxLife = maxLife;
    this.radius = radius;
    this.color = color;
    this.glow = glow;
  }

  update(dt) {
    // Note: world Y increases upward in our coord system
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
  }

  isDead() {
    return this.life <= 0;
  }
}

/* ---------------------------------------------------------------
   Floating Text (e.g. "+25 ◈" on spark pickup)
   --------------------------------------------------------------- */
export class FloatingTextSystem {
  constructor() {
    /** @type {FloatingText[]} */
    this.texts = [];
  }

  /**
   * @param {number} x - World X
   * @param {number} y - World Y
   * @param {string} text
   * @param {string} [color]
   */
  spawn(x, y, text, color = '#ffd700') {
    this.texts.push(new FloatingText(x, y, text, color));
  }

  update(dt) {
    for (let i = this.texts.length - 1; i >= 0; i--) {
      this.texts[i].update(dt);
      if (this.texts[i].isDead()) this.texts.splice(i, 1);
    }
  }

  draw(ctx, camY, canvasH) {
    for (const t of this.texts) {
      const screenY = canvasH - (t.y - camY);
      const alpha = t.life / t.maxLife;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `bold 16px 'Orbitron', monospace`;
      ctx.fillStyle = t.color;
      ctx.shadowColor = t.color;
      ctx.shadowBlur = 8;
      ctx.textAlign = 'center';
      ctx.fillText(t.text, t.x, screenY);
      ctx.restore();
    }
  }
}

class FloatingText {
  constructor(x, y, text, color) {
    this.x = x;
    this.y = y;
    this.text = text;
    this.color = color;
    this.life = 1.2;
    this.maxLife = 1.2;
    this.vy = 60; // float upward in world coords
  }

  update(dt) {
    this.y += this.vy * dt;
    this.life -= dt;
  }

  isDead() {
    return this.life <= 0;
  }
}
