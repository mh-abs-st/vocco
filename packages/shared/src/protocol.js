// Messages on the /session WebSocket between the browser and the server.
//
// Browser → server
//   { type: 'start', language: 'en', sampleRate: 16000 }   first message; the server opens speech-to-text
//   <binary>                                              16-bit little-endian mono PCM at `sampleRate`. The browser
//                                                         sends audio only after 'ready': word times count from the
//                                                         first chunk after it (the browser adds its own offset).
//   { type: 'stop' }                                      end of speech; the server flushes and closes
//
// Server → browser
//   { type: 'ready', maxMinutes }                         speech-to-text is listening
//   { type: 'words', final, text, words: Word[] }         words heard (interim ones are replaced by the final)
//   { type: 'utterance_end' }                             a pause long enough to end an utterance
//   { type: 'limit', reason, message }                    the session stopped (time limit, too many sessions)
//   { type: 'error', message, reason? }                   something failed; the socket closes after it
//                                                         (reason 'upstream': speech-to-text dropped mid-session)
//   { type: 'closed', seconds }                           all done; `seconds` of audio were heard

export const SAMPLE_RATE = 16000;
export const LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'en-US', label: 'English (US)' },
  { id: 'en-GB', label: 'English (UK)' },
];
