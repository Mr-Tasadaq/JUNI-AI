import { describe, expect, it } from "vitest";
import { canTransition, voiceStateLabel } from "./voiceState";

describe("voice state machine", () => {
  it("allows the safe microphone lifecycle", () => {
    expect(canTransition("DISCONNECTED", "CONNECTING")).toBe(true);
    expect(canTransition("CONNECTING", "CONNECTED")).toBe(true);
    expect(canTransition("CONNECTED", "LISTENING")).toBe(true);
    expect(canTransition("LISTENING", "PROCESSING")).toBe(true);
    expect(canTransition("SPEAKING", "INTERRUPTED")).toBe(true);
    expect(canTransition("ERROR", "RECONNECTING")).toBe(true);
  });

  it("rejects unsafe jumps and exposes a readable status label", () => {
    expect(canTransition("DISCONNECTED", "SPEAKING")).toBe(false);
    expect(canTransition("PROCESSING", "LISTENING")).toBe(false);
    expect(voiceStateLabel("RECONNECTING")).toBe("Reconnecting");
  });
});
