/**
 * upgrades.js
 * Manages upgrade definitions, costs, localStorage persistence, and Shop HTML injection.
 */

import { playBuy, playClick } from './audio.js';

// ---- Upgrade Definitions ----
// Each upgrade has a key, name, icon, description, max level, and cost/stat formulas.

export const UPGRADE_DEFS = [
  {
    key: 'launcher',
    name: 'Launcher',
    icon: '🚀',
    desc: 'Increases initial launch velocity.',
    maxLevel: 10,
    // Level 0→1: 100, L1→2: 200, L2→3: 400 ... doubles every 2 levels
    cost: (level) => Math.floor(100 * Math.pow(2.0, level)),
    // Launch velocity tuned to slower-paced game (was 380 + 90n)
    stat: (level) => 260 + level * 60,
  },
  {
    key: 'fuel',
    name: 'Fuel Tanks',
    icon: '⛽',
    desc: 'Increases max boost fuel capacity.',
    maxLevel: 10,
    cost: (level) => Math.floor(120 * Math.pow(2.1, level)),
    stat: (level) => (1.5 + level * 0.45) * 3,
  },
  {
    key: 'magnet',
    name: 'Magnet',
    icon: '🧲',
    desc: 'Increases spark pickup radius.',
    maxLevel: 8,
    cost: (level) => Math.floor(80 * Math.pow(2.15, level)),
    stat: (level) => 24 + level * 18,
  },
  {
    key: 'aero',
    name: 'Aerodynamics',
    icon: '🌀',
    desc: 'Reduces gravity pull on the moth.',
    maxLevel: 8,
    cost: (level) => Math.floor(160 * Math.pow(2.2, level)),
    stat: (level) => Math.max(0.4, 1.0 - level * 0.075),
  },
  {
    key: 'halo',
    name: 'Halo Rings',
    icon: '⭕',
    desc: 'Detachable external fuel tanks.',
    maxLevel: 6,
    // High base cost, steep scaling
    cost: (level) => Math.floor(500 * Math.pow(2.5, level)),
    stat: (level) => ({
      count: Math.min(4, level),
      capacity: level === 0 ? 0 : (level <= 4 ? 1.5 : (level === 5 ? 2.0 : 2.5)),
    }),
  },
];

// ---- Default Save State ----
const DEFAULT_SAVE = {
  sparks: 0,
  levels: {
    launcher: 0,
    fuel: 0,
    magnet: 0,
    aero: 0,
    halo: 0,
  },
  bestAltitude: 0,
};

// Bump this key whenever upgrade costs/balance change significantly,
// so old cheap saves don't carry over into the rebalanced economy.
const SAVE_KEY = 'neonAscent_v2';

// ---- Save / Load ----

/** Load save from localStorage, returning defaults if none exists. */
export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Merge with defaults to handle new keys added in updates
      return {
        ...DEFAULT_SAVE,
        ...parsed,
        levels: { ...DEFAULT_SAVE.levels, ...(parsed.levels || {}) },
      };
    }
  } catch (e) {
    console.warn('[Neon Ascent] Save data corrupted, resetting.', e);
  }
  return structuredClone(DEFAULT_SAVE);
}

/** Write save state to localStorage. */
export function writeSave(save) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(save));
}

/** Wipe all progress (for debug / reset). */
export function resetSave() {
  localStorage.removeItem(SAVE_KEY);
  return structuredClone(DEFAULT_SAVE);
}

// ---- Computed Stat Helpers ----

/**
 * Get the effective stat value for an upgrade key, given the current save.
 * @param {typeof DEFAULT_SAVE} save
 * @param {'launcher'|'fuel'|'magnet'|'aero'} key
 */
export function getStat(save, key) {
  const def = UPGRADE_DEFS.find((d) => d.key === key);
  if (!def) return 0;
  return def.stat(save.levels[key]);
}

// ---- Shop UI ----

/**
 * Render (or re-render) the upgrade cards into #upgradeGrid.
 * Attaches buy-button event listeners.
 *
 * @param {typeof DEFAULT_SAVE} save
 * @param {Function} onBuy - callback(key) called when an upgrade is purchased
 */
export function renderShop(save, onBuy) {
  const grid = document.getElementById('upgradeGrid');
  if (!grid) return;

  grid.innerHTML = '';

  for (const def of UPGRADE_DEFS) {
    const level = save.levels[def.key];
    const isMaxed = level >= def.maxLevel;
    const cost = isMaxed ? null : def.cost(level);
    const canAfford = !isMaxed && save.sparks >= cost;

    const card = document.createElement('div');
    card.className = 'upgrade-card';
    card.id = `upgrade-card-${def.key}`;

    // Pip bar (max 8 pips, but only show def.maxLevel)
    const maxPips = def.maxLevel;
    const pips = Array.from({ length: maxPips }, (_, i) =>
      `<div class="level-pip${i < level ? ' filled' : ''}"></div>`
    ).join('');

    // Button state
    let btnClass = 'upgrade-buy-btn';
    let btnText = '';
    let btnDisabled = false;

    if (isMaxed) {
      btnClass += ' maxed';
      btnText = '★ MAXED';
      btnDisabled = true;
    } else if (!canAfford) {
      btnClass += ' cant-afford';
      btnText = `◈ ${cost} — NOT ENOUGH`;
      btnDisabled = false; // still clickable, will flash
    } else {
      btnText = `◈ ${cost} — BUY`;
    }

    card.innerHTML = `
      <div class="upgrade-card-header">
        <div class="upgrade-icon">${def.icon}</div>
        <div class="upgrade-info">
          <div class="upgrade-name">${def.name.toUpperCase()}</div>
          <div class="upgrade-desc">${def.desc}</div>
        </div>
      </div>
      <div class="upgrade-level-bar">
        <div class="level-pips">${pips}</div>
        <div class="level-text">LVL ${level}/${def.maxLevel}</div>
      </div>
      <button
        class="${btnClass}"
        id="buy-btn-${def.key}"
        ${btnDisabled ? 'disabled' : ''}
        data-key="${def.key}"
      >${btnText}</button>
    `;

    grid.appendChild(card);
  }

  // Attach click listeners after DOM insertion
  for (const def of UPGRADE_DEFS) {
    const btn = document.getElementById(`buy-btn-${def.key}`);
    if (!btn || btn.disabled) continue;

    btn.addEventListener('click', () => {
      const currentLevel = save.levels[def.key];
      const isMax = currentLevel >= def.maxLevel;
      if (isMax) return;

      const price = def.cost(currentLevel);

      if (save.sparks >= price) {
        save.sparks -= price;
        save.levels[def.key]++;
        writeSave(save);
        
        playBuy();

        // Re-render the full shop immediately so pips, costs, and
        // currency all update in sync. onBuy notifies main.js afterward.
        const currEl = document.getElementById('shopCurrencyDisplay');
        if (currEl) currEl.textContent = save.sparks.toLocaleString();
        renderShop(save, onBuy);

        onBuy(save);
      } else {
        playClick(); // play failure blip
        // Flash red on cannot afford
        btn.style.animation = 'none';
        btn.style.background = 'rgba(255,34,68,0.25)';
        btn.style.borderColor = '#ff2244';
        setTimeout(() => {
          btn.style.background = '';
          btn.style.borderColor = '';
        }, 300);
      }
    });
  }
}

/**
 * Update just the currency display and re-render cards (lightweight refresh).
 * @param {typeof DEFAULT_SAVE} save
 * @param {Function} onBuy
 */
export function refreshShopUI(save, onBuy) {
  const el = document.getElementById('shopCurrencyDisplay');
  if (el) el.textContent = save.sparks.toLocaleString();
  renderShop(save, onBuy);
}
