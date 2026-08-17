/**
 * physics.js
 * Pure physics utilities: gravity, velocity integration, AABB collision.
 * No rendering — just math.
 */

// --------------- Constants (overridden by upgrades) ----------------

/** Base world gravity in world-units per second². Positive = downward. */
export const BASE_GRAVITY = 240;    // was 380 — slower fall gives more reaction time

/** Air drag coefficient applied to horizontal velocity each frame. */
export const HORIZONTAL_DRAG = 5.0; // tighter steering friction

/** Air drag coefficient for vertical velocity when NOT boosting. */
export const VERTICAL_DRAG = 0.25; // was 0.35 — glides down instead of dropping

/**
 * Integrate velocity with gravity and drag.
 * Our coordinate system: +Y = UP (world space).
 *
 * @param {{ vx: number, vy: number }} body
 * @param {number} dt - seconds
 * @param {number} gravity - downward acceleration (positive value)
 * @param {boolean} isBoosting - if true, only partial drag applied
 */
export function integrateVelocity(body, dt, gravity, isBoosting = false) {
  // Apply gravity (pulls vy downward)
  body.vy -= gravity * dt;

  // Horizontal drag
  body.vx -= body.vx * HORIZONTAL_DRAG * dt;

  // Vertical drag when falling (not boosting)
  if (!isBoosting && body.vy < 0) {
    body.vy -= body.vy * VERTICAL_DRAG * dt; // this reduces the magnitude
  }
}

/**
 * Integrate position from velocity.
 *
 * @param {{ x: number, y: number, vx: number, vy: number }} body
 * @param {number} dt - seconds
 */
export function integratePosition(body, dt) {
  body.x += body.vx * dt;
  body.y += body.vy * dt;
}

/**
 * AABB Collision check.
 * Returns true if two axis-aligned rects overlap.
 *
 * @param {{ x: number, y: number, w: number, h: number }} a
 * @param {{ x: number, y: number, w: number, h: number }} b
 */
export function aabbOverlap(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/**
 * Circle vs AABB check (used for spark magnet pickup range).
 *
 * @param {{ x: number, y: number }} circle - center
 * @param {number} radius
 * @param {{ x: number, y: number, w: number, h: number }} rect
 */
export function circleAabbOverlap(circle, radius, rect) {
  const nearestX = Math.max(rect.x, Math.min(circle.x, rect.x + rect.w));
  const nearestY = Math.max(rect.y, Math.min(circle.y, rect.y + rect.h));
  const dx = circle.x - nearestX;
  const dy = circle.y - nearestY;
  return dx * dx + dy * dy < radius * radius;
}

/**
 * Clamp a value between min and max.
 */
export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Linear interpolation.
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}
