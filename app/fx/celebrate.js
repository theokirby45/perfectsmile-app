// The reveal moment: confetti + a chime.
//
// Both libraries load on demand rather than at page load — neither is needed
// until a result actually lands, and Tone in particular is not small.

const COLORS = ['#072AC8', '#5CE1FF', '#FFFFFF', '#B8F4FF', '#3D5BFF'];

let confettiPromise = null;
let tonePromise = null;
let synth = null;
let kick = null;
let tick = null;
let audioUnlocked = false;
let soundOn = true;

export function setSoundEnabled(on) { soundOn = on; }
export function isSoundEnabled() { return soundOn; }

function loadConfetti() {
  confettiPromise ||= import('canvas-confetti').then(m => m.default);
  return confettiPromise;
}

function loadTone() {
  tonePromise ||= import('tone');
  return tonePromise;
}

/**
 * Web Audio will not start without a user gesture, so this must be called from
 * a real click — the submit handler — long before the chime is due.
 */
export async function unlockAudio() {
  if (audioUnlocked || !soundOn) return;
  try {
    const Tone = await loadTone();
    await Tone.start();
    synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.004, decay: 0.28, sustain: 0.08, release: 0.9 },
    }).toDestination();
    synth.volume.value = -14;

    // Per-beat percussion: a low thump plus a short noise tick.
    kick = new Tone.MembraneSynth({
      pitchDecay: 0.03,
      octaves: 4,
      envelope: { attack: 0.001, decay: 0.28, sustain: 0 },
    }).toDestination();
    kick.volume.value = -16;

    tick = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.09, sustain: 0 },
    }).toDestination();
    tick.volume.value = -30;

    audioUnlocked = true;
  } catch (err) {
    console.warn('[fx] audio unavailable:', err?.message || err);
  }
}

/** One hit per beat, pitched up as the sequence escalates. */
export async function beat(n) {
  if (!soundOn || !audioUnlocked || !kick) return;
  try {
    const Tone = await loadTone();
    const t = Tone.now();
    const notes = ['C2', 'E2', 'G2', 'C3'];
    kick.triggerAttackRelease(notes[Math.min(n, notes.length - 1)], '8n', t);
    tick?.triggerAttackRelease('32n', t);
  } catch (err) {
    console.warn('[fx] beat failed:', err?.message || err);
  }
}

/** Bright major arpeggio — sparkle, not fanfare. */
export async function chime() {
  if (!soundOn || !audioUnlocked || !synth) return;
  try {
    const Tone = await loadTone();
    const t = Tone.now();
    // Low hit under the arpeggio so the reveal lands rather than tinkles.
    kick?.triggerAttackRelease('C2', '4n', t);
    synth.triggerAttackRelease('C6', '16n', t);
    synth.triggerAttackRelease('E6', '16n', t + 0.07);
    synth.triggerAttackRelease('G6', '8n', t + 0.14);
  } catch (err) {
    console.warn('[fx] chime failed:', err?.message || err);
  }
}

/**
 * Confetti burst originating from `el`. Fires on the library's own full-screen
 * canvas rather than inside the card, which clips it.
 */
export async function celebrate(el) {
  try {
    const confetti = await loadConfetti();
    let origin = { x: 0.5, y: 0.55 };
    if (el?.getBoundingClientRect) {
      const r = el.getBoundingClientRect();
      if (r.width) {
        origin = {
          x: (r.left + r.width / 2) / window.innerWidth,
          y: (r.top + r.height * 0.45) / window.innerHeight,
        };
      }
    }
    confetti({
      particleCount: 70,
      spread: 78,
      startVelocity: 32,
      ticks: 160,
      scalar: 0.9,
      origin,
      colors: COLORS,
      disableForReducedMotion: true,
    });
  } catch (err) {
    console.warn('[fx] confetti failed:', err?.message || err);
  }
}
