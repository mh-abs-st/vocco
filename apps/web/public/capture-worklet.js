// AudioWorklet: takes the mic at the device's rate and sends 16 kHz mono Float32 chunks of 320 samples (20 ms)
// to the page. Plain script (no imports) so it loads the same in dev and in the build.

const OUT_RATE = 16000;
const CHUNK = 320;

class Capture16k extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / OUT_RATE; // input samples per output sample
    this.pos = 0; // fractional read position into `carry`
    this.carry = new Float32Array(0);
    this.out = new Float32Array(CHUNK);
    this.n = 0;
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    // Join what's left from the last block with this one.
    const buf = new Float32Array(this.carry.length + ch.length);
    buf.set(this.carry);
    buf.set(ch, this.carry.length);
    const r = this.ratio;
    let p = this.pos;
    while (p + r < buf.length) {
      // Average the input samples this output sample covers: a simple low-pass that avoids most aliasing.
      const a = Math.floor(p), b = Math.min(buf.length, Math.floor(p + r));
      let s = 0;
      for (let i = a; i < b; i++) s += buf[i];
      this.out[this.n++] = b > a ? s / (b - a) : buf[a];
      if (this.n === CHUNK) {
        this.port.postMessage(this.out.slice(0));
        this.n = 0;
      }
      p += r;
    }
    const keep = Math.floor(p);
    this.carry = buf.slice(keep);
    this.pos = p - keep;
    return true;
  }
}

registerProcessor('capture-16k', Capture16k);
