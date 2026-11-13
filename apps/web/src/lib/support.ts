// Can this browser run a session? Returns a message to show, or null when everything needed is there.

export function supportProblem(): string | null {
  if (typeof window === 'undefined') return null;
  // Browsers only allow the microphone on https (and on localhost while developing).
  if (!window.isSecureContext) return 'Vocco needs a secure (https) address to use your microphone. Open it with https:// and try again.';
  if (!navigator.mediaDevices?.getUserMedia) return 'This browser can’t share your microphone with Vocco. Use a recent Chrome, Edge, Safari or Firefox.';
  if (typeof AudioWorkletNode === 'undefined' || typeof AudioContext === 'undefined') return 'This browser is too old for Vocco. Update it, or use a recent Chrome, Edge, Safari or Firefox.';
  if (typeof WebSocket === 'undefined') return 'This browser can’t keep a live connection to Vocco. Use a recent Chrome, Edge, Safari or Firefox.';
  return null;
}
