/**
 * audio.js
 * Procedural Web Audio API sound engine.
 * No external assets required.
 */

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let isInitialized = false;

// Global master gain to control overall volume
const masterGain = audioCtx.createGain();
masterGain.gain.value = 0.3; // 30% volume
masterGain.connect(audioCtx.destination);

// ---------------------------------------------------------
//  Background Music
// ---------------------------------------------------------

export function playBgm() {
  const bgm = document.getElementById('bgm');
  if (bgm) {
    bgm.volume = 0.15; // Lower volume for background music
    bgm.play().catch(err => console.warn('BGM autoplay blocked:', err));
  }
}

export function stopBgm() {
  const bgm = document.getElementById('bgm');
  if (bgm) {
    bgm.pause();
    bgm.currentTime = 0;
  }
}

/**
 * Browsers block audio until the first user interaction.
 * Call this on the first button click to wake up the audio context.
 */
export function initAudio() {
  if (isInitialized) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  isInitialized = true;

  playBgm();
}

// ---------------------------------------------------------
//  Thruster Engine (Electronic fluttering buzz)
// ---------------------------------------------------------
let thrustOsc = null;
let thrustGain = null;
let modGain = null;
let lfoOsc = null;
let isThrusting = false;

function createThrustNodes() {
  // Gain for envelope (fade in/out)
  thrustGain = audioCtx.createGain();
  thrustGain.gain.value = 0; // Starts silent
  
  // Gain for LFO modulation (flapping effect)
  modGain = audioCtx.createGain();
  modGain.gain.value = 0.5; // Base level

  thrustGain.connect(modGain);
  modGain.connect(masterGain);

  // Main tone (mechanical hum)
  thrustOsc = audioCtx.createOscillator();
  thrustOsc.type = 'triangle';
  thrustOsc.frequency.value = 70;
  thrustOsc.connect(thrustGain);
  thrustOsc.start();

  // Fast LFO to simulate mechanical wings (18 Hz)
  lfoOsc = audioCtx.createOscillator();
  lfoOsc.type = 'sine';
  lfoOsc.frequency.value = 18;
  
  const lfoDepth = audioCtx.createGain();
  lfoDepth.gain.value = 0.5; // modulate by +/- 0.5
  lfoOsc.connect(lfoDepth);
  lfoDepth.connect(modGain.gain);
  
  lfoOsc.start();
}

export function playThrust(boosting) {
  if (!isInitialized) return;

  if (boosting && !isThrusting) {
    if (!thrustOsc) createThrustNodes();
    // Fade in
    thrustGain.gain.setTargetAtTime(0.4, audioCtx.currentTime, 0.05);
    isThrusting = true;
  } else if (!boosting && isThrusting) {
    // Fade out quickly
    thrustGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
    isThrusting = false;
  }
}

// ---------------------------------------------------------
//  One-Shot Sound Effects
// ---------------------------------------------------------

/** High-pitched "ding" for collecting sparks */
export function playSpark() {
  if (!isInitialized) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(1200, t); // High pitch
  osc.frequency.exponentialRampToValueAtTime(1800, t + 0.1);

  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.3, t + 0.02); // Quick attack
  gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3); // Fade out

  osc.connect(gain);
  gain.connect(masterGain);

  osc.start(t);
  osc.stop(t + 0.3);
}

/** Ascending arpeggio for collecting fuel */
export function playFuel() {
  if (!isInitialized) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(300, t);
  osc.frequency.exponentialRampToValueAtTime(800, t + 0.2);

  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.4, t + 0.05);
  gain.gain.linearRampToValueAtTime(0, t + 0.3);

  osc.connect(gain);
  gain.connect(masterGain);

  osc.start(t);
  osc.stop(t + 0.3);
}

/** Low, harsh crash for hitting hazards */
export function playHit() {
  if (!isInitialized) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = 'square'; // Harsh tone
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.3); // Pitch drop

  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.5, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.01, t + 0.4);

  osc.connect(gain);
  gain.connect(masterGain);

  osc.start(t);
  osc.stop(t + 0.4);
}

/** Short UI blip for clicking buttons */
export function playClick() {
  if (!isInitialized) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, t);
  osc.frequency.exponentialRampToValueAtTime(300, t + 0.1);

  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.2, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);

  osc.connect(gain);
  gain.connect(masterGain);

  osc.start(t);
  osc.stop(t + 0.1);
}

/** Positive confirmation tone (two ascending notes) for buying an upgrade */
export function playBuy() {
  if (!isInitialized) return;
  const t = audioCtx.currentTime;
  
  // Note 1
  const osc1 = audioCtx.createOscillator();
  const gain1 = audioCtx.createGain();
  osc1.type = 'square';
  osc1.frequency.setValueAtTime(440, t); // A4
  gain1.gain.setValueAtTime(0, t);
  gain1.gain.linearRampToValueAtTime(0.15, t + 0.02);
  gain1.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
  osc1.connect(gain1);
  gain1.connect(masterGain);
  osc1.start(t);
  osc1.stop(t + 0.15);

  // Note 2
  const osc2 = audioCtx.createOscillator();
  const gain2 = audioCtx.createGain();
  osc2.type = 'square';
  osc2.frequency.setValueAtTime(659.25, t + 0.15); // E5 (Perfect 5th up)
  gain2.gain.setValueAtTime(0, t + 0.15);
  gain2.gain.linearRampToValueAtTime(0.15, t + 0.17);
  gain2.gain.exponentialRampToValueAtTime(0.01, t + 0.4);
  osc2.connect(gain2);
  gain2.connect(masterGain);
  osc2.start(t + 0.15);
  osc2.stop(t + 0.4);
}
