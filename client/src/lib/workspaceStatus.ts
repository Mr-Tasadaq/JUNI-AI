export type WorkspaceStatusInput = {
  sendError: boolean;
  creationError: boolean;
};

export function getWorkspaceStatus({
  sendError,
  creationError,
}: WorkspaceStatusInput) {
  if (sendError) {
    return {
      message:
        "JUNI could not complete the response. Your message remains saved; you can retry safely.",
      tone: "error" as const,
      showRetryCreate: false,
    };
  }
  if (creationError) {
    return {
      message:
        "JUNI could not create a conversation. Check your connection and try again.",
      tone: "error" as const,
      showRetryCreate: true,
    };
  }
  return {
    message:
      "Responses are generated through a server-side provider boundary. No provider credential is sent to this browser.",
    tone: "neutral" as const,
    showRetryCreate: false,
  };
}
