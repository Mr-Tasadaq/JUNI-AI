/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

import VoiceSystem from "./VoiceSystem";

describe("VoiceSystem", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("moves from microphone connection through speaking and exposes interruption", async () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi
          .fn()
          .mockResolvedValue({ getTracks: () => [{ stop }] }),
      },
    });

    render(<VoiceSystem />);
    fireEvent.click(screen.getByRole("button", { name: "Enable microphone" }));
    await act(async () => {});
    expect(screen.getByText("Start listening")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start listening" }));
    expect(screen.getByText("Listening")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Finish capture" }));
    expect(screen.getByText("Processing")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByText("Speaking")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Interrupt" }));
    expect(screen.getByText("Interrupted")).toBeInTheDocument();
    expect(stop).not.toHaveBeenCalled();
  });
});
