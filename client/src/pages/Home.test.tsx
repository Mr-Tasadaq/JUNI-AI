/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedCreateMutation = vi.hoisted(() => ({
  isPending: false,
  isError: true,
  mutate: vi.fn(),
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { name: "Test User" },
    loading: false,
    error: null,
    isAuthenticated: true,
    logout: vi.fn(),
  }),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/components/AIChatBox", () => ({
  AIChatBox: () => <div data-testid="chat-box" />,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    conversations: {
      list: {
        useQuery: () => ({
          data: [],
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      create: { useMutation: () => mockedCreateMutation },
      messages: {
        useQuery: () => ({
          data: [],
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      send: {
        useMutation: () => ({
          isPending: false,
          isError: false,
          mutate: vi.fn(),
        }),
      },
    },
  },
}));

import Home from "./Home";

describe("Home conversation creation failure", () => {
  beforeEach(() => mockedCreateMutation.mutate.mockClear());

  it("shows Retry create and retries the failed mutation", () => {
    render(<Home />);
    expect(
      screen.getByText("Could not create a conversation.")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry create" }));
    expect(mockedCreateMutation.mutate).toHaveBeenCalledWith({});
  });
});
