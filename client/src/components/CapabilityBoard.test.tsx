/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CapabilityBoard from "./CapabilityBoard";

describe("CapabilityBoard", () => {
  it("renders examples, capabilities, and limitations with transparent copy", () => {
    render(<CapabilityBoard />);
    expect(
      screen.getByRole("heading", { name: "Clear about what happens next." })
    ).toBeInTheDocument();
    expect(screen.getByText("Examples")).toBeInTheDocument();
    expect(screen.getByText("Capabilities")).toBeInTheDocument();
    expect(screen.getByText("Limitations")).toBeInTheDocument();
    expect(
      screen.getByText("Voice transcription bridge is still in progress")
    ).toBeInTheDocument();
    expect(
      screen.getByText("No durable personal memory is saved automatically")
    ).toBeInTheDocument();
  });
});
