/**
 * engine.js
 * Manages the canvas element, pixel ratio scaling, delta time calculation,
 * and the main requestAnimationFrame render loop.
 */

export class Engine {
  /**
   * @param {string} canvasId - ID of the <canvas> element
   * @param {Function} updateFn - (dt: number) => void
   * @param {Function} drawFn   - (ctx: CanvasRenderingContext2D, W: number, H: number) => void
   */
  constructor(canvasId, updateFn, drawFn) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) throw new Error(`Canvas #${canvasId} not found`);

    /** @type {CanvasRenderingContext2D} */
    this.ctx = this.canvas.getContext('2d');

    this._updateFn = updateFn;
    this._drawFn = drawFn;

    this._lastTime = null;
    this._rafId = null;
    this._running = false;

    // Device pixel ratio for crisp rendering on HiDPI/Retina screens
    this.dpr = window.devicePixelRatio || 1;

    // Logical (CSS) dimensions
    this.width = 0;
    this.height = 0;

    // Bind
    this._loop = this._loop.bind(this);
    this._onResize = this._onResize.bind(this);

    window.addEventListener('resize', this._onResize);
    this._onResize();
  }

  // ---- Resize ----
  _onResize() {
    const W = window.innerWidth;
    const H = window.innerHeight;

    this.width = W;
    this.height = H;

    // Physical pixels
    this.canvas.width  = W * this.dpr;
    this.canvas.height = H * this.dpr;

    // CSS size
    this.canvas.style.width  = `${W}px`;
    this.canvas.style.height = `${H}px`;

    // Scale context to account for DPR
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Notify any registered resize listeners
    if (this._onResizeCb) this._onResizeCb(W, H);
  }

  /**
   * Register a callback invoked when the canvas is resized.
   * @param {Function} cb - (w, h) => void
   */
  onResize(cb) {
    this._onResizeCb = cb;
  }

  // ---- Loop ----
  start() {
    if (this._running) return;
    this._running = true;
    this._lastTime = null;
    this._rafId = requestAnimationFrame(this._loop);
  }

  stop() {
    this._running = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _loop(timestamp) {
    if (!this._running) return;

    // Delta time calculation with a max cap (to avoid physics explosions on tab switch)
    if (this._lastTime === null) this._lastTime = timestamp;
    const rawDt = (timestamp - this._lastTime) / 1000;
    this._lastTime = timestamp;
    const dt = Math.min(rawDt, 0.05); // cap at 50ms (~20 fps minimum)

    // Update
    this._updateFn(dt);

    // Clear
    this.ctx.clearRect(0, 0, this.width, this.height);

    // Draw
    this._drawFn(this.ctx, this.width, this.height);

    this._rafId = requestAnimationFrame(this._loop);
  }

  // ---- Helpers ----
  /** Clear the canvas with a solid fill. */
  clear(color = '#000') {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }
}
