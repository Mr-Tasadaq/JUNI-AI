export const voiceStates = [
  "DISCONNECTED",
  "CONNECTING",
  "CONNECTED",
  "LISTENING",
  "PROCESSING",
  "SPEAKING",
  "INTERRUPTED",
  "RECONNECTING",
  "ERROR",
] as const;

export type VoiceState = (typeof voiceStates)[number];

const transitions: Record<VoiceState, readonly VoiceState[]> = {
  DISCONNECTED: ["CONNECTING"],
  CONNECTING: ["CONNECTED", "ERROR", "DISCONNECTED"],
  CONNECTED: ["LISTENING", "DISCONNECTED", "RECONNECTING"],
  LISTENING: ["PROCESSING", "INTERRUPTED", "DISCONNECTED", "ERROR"],
  PROCESSING: ["SPEAKING", "CONNECTED", "ERROR", "INTERRUPTED"],
  SPEAKING: ["INTERRUPTED", "CONNECTED", "DISCONNECTED", "ERROR"],
  INTERRUPTED: ["CONNECTED", "DISCONNECTED", "RECONNECTING"],
  RECONNECTING: ["CONNECTED", "ERROR", "DISCONNECTED"],
  ERROR: ["RECONNECTING", "CONNECTING", "DISCONNECTED"],
};

export function canTransition(from: VoiceState, to: VoiceState) {
  return transitions[from].includes(to);
}

export function voiceStateLabel(state: VoiceState) {
  return state[0] + state.slice(1).toLowerCase();
}
