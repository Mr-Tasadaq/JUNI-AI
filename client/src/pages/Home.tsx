import React from "react";
import { startLogin } from "@/const";
import { AIChatBox, type Message as ChatMessage } from "@/components/AIChatBox";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/_core/hooks/useAuth";
import { getWorkspaceStatus } from "@/lib/workspaceStatus";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CircleUserRound,
  LogOut,
  Plus,
  ShieldCheck,
  Sparkles,
  Wifi,
} from "lucide-react";

export default function Home() {
  const {
    user,
    loading: authLoading,
    error: authError,
    isAuthenticated,
    logout,
  } = useAuth();
  const [selectedConversationId, setSelectedConversationId] = useState<
    number | null
  >(null);
  const conversationsQuery = trpc.conversations.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const createConversation = trpc.conversations.create.useMutation({
    onSuccess: conversation => {
      setSelectedConversationId(conversation.id);
      void conversationsQuery.refetch();
    },
  });
  const messagesQuery = trpc.conversations.messages.useQuery(
    { conversationId: selectedConversationId ?? 0 },
    { enabled: isAuthenticated && selectedConversationId !== null }
  );
  const sendMessage = trpc.conversations.send.useMutation({
    onSuccess: async () => {
      await Promise.all([
        messagesQuery.refetch(),
        conversationsQuery.refetch(),
      ]);
    },
  });

  useEffect(() => {
    const firstConversation = conversationsQuery.data?.[0];
    if (selectedConversationId === null && firstConversation)
      setSelectedConversationId(firstConversation.id);
  }, [conversationsQuery.data, selectedConversationId]);

  const chatMessages = useMemo<ChatMessage[]>(
    () =>
      (messagesQuery.data ?? [])
        .filter(
          (
            message
          ): message is typeof message & {
            role: "system" | "user" | "assistant";
          } => message.role !== "tool"
        )
        .map(message => ({ role: message.role, content: message.content })),
    [messagesQuery.data]
  );
  const selectedConversation = conversationsQuery.data?.find(
    item => item.id === selectedConversationId
  );
  const isBusy = sendMessage.isPending;
  const workspaceStatus = getWorkspaceStatus({
    sendError: sendMessage.isError,
    creationError: createConversation.isError,
  });
  const statusMessage = workspaceStatus.message;
  const retryWorkspace = () => {
    void conversationsQuery.refetch();
    if (selectedConversationId !== null) void messagesQuery.refetch();
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f8f7] text-sm text-slate-500">
        Checking your secure session…
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f6f8f7] px-6 py-12 text-slate-900">
        <section className="w-full max-w-2xl rounded-[2rem] border border-white/80 bg-white/90 p-8 shadow-[0_24px_80px_rgba(42,70,65,0.14)] backdrop-blur sm:p-12">
          <div className="mb-10 flex items-center gap-3 text-emerald-700">
            <span className="grid size-11 place-items-center rounded-2xl bg-emerald-100">
              <Sparkles className="size-5" />
            </span>
            <span className="font-display text-xl font-semibold tracking-tight">
              JUNI AI
            </span>
          </div>
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.24em] text-emerald-700">
            A calmer intelligence layer
          </p>
          <h1 className="max-w-xl font-display text-4xl font-semibold leading-tight tracking-[-0.04em] text-slate-950 sm:text-6xl">
            A trustworthy workspace for thinking, making, and moving forward.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-slate-600">
            JUNI keeps conversations, capability status, and future memory under
            your control. Sign in to open your private workspace.
          </p>
          {authError && (
            <p className="mt-5 flex items-center gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <AlertCircle className="size-4" />
              {authError.message}
            </p>
          )}
          <Button
            className="mt-8 h-12 rounded-xl bg-slate-950 px-6 text-white hover:bg-slate-800"
            onClick={() => startLogin()}
          >
            Enter JUNI workspace
          </Button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f8f7] text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-[1500px] flex-col lg:flex-row">
        <aside className="flex w-full flex-col border-b border-slate-200/80 bg-white/70 px-5 py-5 backdrop-blur lg:min-h-screen lg:w-[290px] lg:border-b-0 lg:border-r lg:px-6 lg:py-7">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-2xl bg-slate-950 text-emerald-200">
                <Sparkles className="size-5" />
              </span>
              <div>
                <div className="font-display text-lg font-semibold">JUNI</div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                  Personal intelligence
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Account"
              className="rounded-xl"
            >
              <CircleUserRound className="size-5 text-slate-500" />
            </Button>
          </div>
          <Button
            className="mt-8 h-11 justify-start gap-2 rounded-xl bg-emerald-700 text-white hover:bg-emerald-800"
            onClick={() => createConversation.mutate({})}
            disabled={createConversation.isPending}
          >
            <Plus className="size-4" />
            New conversation
          </Button>
          {createConversation.isError && (
            <div className="mt-3 rounded-xl bg-rose-50 px-3 py-3 text-xs leading-5 text-rose-700">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                Could not create a conversation.
              </div>
              <button
                className="mt-1 font-semibold underline underline-offset-2"
                onClick={() => createConversation.mutate({})}
              >
                Retry create
              </button>
            </div>
          )}
          <div className="mt-8 flex-1">
            <div className="mb-3 px-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
              Conversations
            </div>
            <div className="space-y-1">
              {conversationsQuery.isLoading ? (
                <div className="px-3 py-4 text-sm text-slate-400">
                  Loading your conversations…
                </div>
              ) : conversationsQuery.isError ? (
                <div className="rounded-xl bg-rose-50 px-3 py-3 text-sm leading-5 text-rose-700">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    Could not load conversations.
                  </div>
                  <button
                    className="mt-2 font-semibold underline underline-offset-2"
                    onClick={retryWorkspace}
                  >
                    Retry
                  </button>
                </div>
              ) : conversationsQuery.data?.length ? (
                conversationsQuery.data.map(conversation => (
                  <button
                    key={conversation.id}
                    className={cn(
                      "w-full rounded-xl px-3 py-3 text-left text-sm transition-colors",
                      selectedConversationId === conversation.id
                        ? "bg-emerald-50 font-medium text-emerald-900"
                        : "text-slate-600 hover:bg-slate-100"
                    )}
                    onClick={() => setSelectedConversationId(conversation.id)}
                  >
                    {conversation.title}
                  </button>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm leading-6 text-slate-400">
                  Your first conversation will appear here.
                </div>
              )}
            </div>
          </div>
          <div className="mt-6 rounded-2xl bg-slate-950 p-4 text-white">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="size-4 text-emerald-300" />
              Private by default
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              Your workspace is authenticated and scoped to your account.
              External context will be treated as untrusted data.
            </p>
          </div>
          <Button
            variant="ghost"
            className="mt-3 justify-start gap-2 text-slate-500 hover:text-slate-900"
            onClick={() => void logout()}
          >
            <LogOut className="size-4" />
            Sign out
          </Button>
        </aside>
        <section className="flex min-h-[calc(100vh-90px)] flex-1 flex-col px-4 py-5 sm:px-8 sm:py-8 lg:px-12">
          <header className="mb-6 flex flex-col gap-4 border-b border-slate-200/80 pb-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-medium text-emerald-700">
                Good to see you, {user?.name?.split(" ")[0] ?? "there"}.
              </p>
              <h2 className="mt-1 font-display text-3xl font-semibold tracking-[-0.04em] text-slate-950">
                What are we working through?
              </h2>
            </div>
            <div className="flex items-center gap-2 self-start rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
              <Wifi className="size-3.5" /> Secure session active
            </div>
          </header>
          <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5 text-emerald-600" />
              Conversation persistence ready
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5 text-emerald-600" />
              Server-side AI boundary ready
            </span>
            <span className="flex items-center gap-1.5">
              <CircleUserRound className="size-3.5 text-slate-400" />
              Uploads planned, not yet enabled
            </span>
          </div>
          <div className="flex-1 rounded-[1.75rem] border border-white/80 bg-white/75 p-2 shadow-[0_20px_60px_rgba(42,70,65,0.08)] backdrop-blur sm:p-4">
            {messagesQuery.isError ? (
              <div className="grid min-h-[55vh] place-items-center p-8 text-center">
                <div>
                  <AlertCircle className="mx-auto size-8 text-rose-600" />
                  <p className="mt-4 font-display text-2xl font-semibold">
                    This conversation is unavailable.
                  </p>
                  <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                    JUNI could not retrieve this thread. Your account and
                    conversation ownership were not changed.
                  </p>
                  <Button
                    variant="outline"
                    className="mt-6 rounded-xl"
                    onClick={retryWorkspace}
                  >
                    Retry loading
                  </Button>
                </div>
              </div>
            ) : selectedConversationId ? (
              <AIChatBox
                messages={chatMessages}
                onSendMessage={content =>
                  sendMessage.mutate({
                    conversationId: selectedConversationId,
                    content,
                  })
                }
                isLoading={isBusy || messagesQuery.isLoading}
                height="min(66vh, 680px)"
                placeholder="Ask JUNI to help you think through something…"
                emptyStateMessage="Start with a question, a decision, or a piece of work you want to make clearer."
                suggestedPrompts={[
                  "Help me turn a fuzzy idea into a clear plan",
                  "What should I think through before making this decision?",
                  "Summarize the tradeoffs in a balanced way",
                ]}
              />
            ) : (
              <div className="grid min-h-[55vh] place-items-center p-8 text-center">
                <div>
                  <Sparkles className="mx-auto size-8 text-emerald-600" />
                  <p className="mt-4 font-display text-2xl font-semibold">
                    Your workspace is ready.
                  </p>
                  <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                    Create a conversation to begin. JUNI will be transparent
                    about what it can access and what it has not verified.
                  </p>
                  <Button
                    className="mt-6 rounded-xl bg-slate-950 text-white"
                    onClick={() => createConversation.mutate({})}
                  >
                    Start a conversation
                  </Button>
                  {createConversation.isError && (
                    <p className="mt-4 flex items-center justify-center gap-2 text-sm text-rose-700">
                      <AlertCircle className="size-4" />
                      Creation failed — use “Retry create” in the sidebar.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
          <div
            className={cn(
              "mt-4 flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs leading-5",
              workspaceStatus.tone === "error"
                ? "bg-rose-50 text-rose-700"
                : "bg-white/60 text-slate-500"
            )}
          >
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {statusMessage}
              {selectedConversation &&
                ` Current thread: ${selectedConversation.title}.`}
            </span>
          </div>
        </section>
      </div>
    </main>
  );
}
