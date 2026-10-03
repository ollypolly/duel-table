// The fun sounds at a game against a friend (a laugh, a sad trombone…), made
// on the spot with Web Audio rather than shipped as files.
import type { Sound } from '../api/table'

let ctx: AudioContext | undefined
const audio = () => (ctx ??= new AudioContext())

// A note: osc's frequency (fixed, or from → to), shaped by a quick attack and a decay.
function note(at: number, length: number, freq: number | [number, number], { type = 'sawtooth' as OscillatorType, gain = 0.25, filter = 1800, vibrato = 0 } = {}) {
  const a = audio()
  const osc = a.createOscillator()
  osc.type = type
  const [from, to] = typeof freq === 'number' ? [freq, freq] : freq
  osc.frequency.setValueAtTime(from, at)
  osc.frequency.linearRampToValueAtTime(to, at + length)
  if (vibrato) {
    const lfo = a.createOscillator()
    const depth = a.createGain()
    lfo.frequency.value = 6
    depth.gain.value = vibrato
    lfo.connect(depth).connect(osc.frequency)
    lfo.start(at)
    lfo.stop(at + length)
  }
  const lp = a.createBiquadFilter()
  lp.frequency.value = filter
  const env = a.createGain()
  env.gain.setValueAtTime(0, at)
  env.gain.linearRampToValueAtTime(gain, at + 0.02)
  env.gain.setValueAtTime(gain, at + length * 0.7)
  env.gain.linearRampToValueAtTime(0, at + length)
  osc.connect(lp).connect(env).connect(a.destination)
  osc.start(at)
  osc.stop(at + length)
}

// A burst of noise through a band-pass filter (a clap, a drum, a breath).
function noise(at: number, length: number, { gain = 0.3, freq = 1500 as number | [number, number], q = 1 } = {}) {
  const a = audio()
  const buffer = a.createBuffer(1, Math.ceil(a.sampleRate * length), a.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  const src = a.createBufferSource()
  src.buffer = buffer
  const bp = a.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = q
  const [from, to] = typeof freq === 'number' ? [freq, freq] : freq
  bp.frequency.setValueAtTime(from, at)
  bp.frequency.linearRampToValueAtTime(to, at + length)
  const env = a.createGain()
  env.gain.setValueAtTime(gain, at)
  env.gain.exponentialRampToValueAtTime(0.001, at + length)
  src.connect(bp).connect(env).connect(a.destination)
  src.start(at)
}

const SOUNDS: Record<Sound, (t: number) => void> = {
  // Ha-ha-ha-ha-ha, each a little lower.
  laugh: (t) => {
    for (let i = 0; i < 5; i++) note(t + i * 0.16, 0.11, [420 - i * 25, 360 - i * 25], { filter: 1200, gain: 0.22 })
  },
  // Wah, wah, wah, waaah.
  trombone: (t) => {
    ;[233, 220, 208].forEach((f, i) => note(t + i * 0.45, 0.38, f, { filter: 900, gain: 0.3 }))
    note(t + 1.35, 1.2, [196, 185], { filter: 900, gain: 0.3, vibrato: 5 })
  },
  applause: (t) => {
    for (let i = 0; i < 60; i++) noise(t + Math.random() * 1.8, 0.05, { gain: 0.25 * (1 - i / 80), freq: 1200 + Math.random() * 1500, q: 0.8 })
  },
  // A roll that builds, then a cymbal.
  drumroll: (t) => {
    for (let i = 0; i < 40; i++) noise(t + i * 0.035, 0.05, { gain: 0.08 + (i / 40) * 0.25, freq: 250, q: 0.7 })
    noise(t + 1.45, 1, { gain: 0.35, freq: 6000, q: 0.5 })
  },
  gasp: (t) => noise(t, 0.5, { gain: 0.4, freq: [600, 2400], q: 2 }),
  ding: (t) => {
    note(t, 1.2, 1320, { type: 'sine', gain: 0.25, filter: 8000 })
    note(t, 0.8, 2640, { type: 'sine', gain: 0.08, filter: 8000 })
  },
}

export function playFun(sound: Sound) {
  const a = audio()
  // Browsers hold sound back until the page has been tapped; then it plays.
  void a.resume().catch(() => {})
  SOUNDS[sound](a.currentTime + 0.02)
}
