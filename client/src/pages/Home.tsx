import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { GoogleGenAI, Modality } from "@google/genai";
import {
  Activity,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  Headphones,
  Loader2,
  LogIn,
  Mic,
  MicOff,
  MoreHorizontal,
  Pause,
  Radio,
  ShieldCheck,
  Sparkles,
  UserRound,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JUNI_PERSONAS, LIVE_MODEL, type PersonaId } from "@shared/juni";
import { useAuth } from "@/_core/hooks/useAuth";

type SessionStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";
type PendingAction =
  | { kind: "website"; id?: string; url: string; reason: string }
  | { kind: "recharge"; id?: string; amount: number }
  | null;

type ActivityItem = {
  id: number;
  label: string;
  detail: string;
  tone: "mint" | "violet" | "amber" | "slate";
};

function floatToPcm16(input: Float32Array) {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] ?? 0));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

function pcm16ToBase64(input: Int16Array) {
  const bytes = new Uint8Array(input.buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(
      ...Array.from(bytes.subarray(index, index + chunkSize))
    );
  }
  return btoa(binary);
}

function base64ToPcm16(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return new Int16Array(bytes.buffer);
}

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();
  const tokenMutation = trpc.live.createEphemeralToken.useMutation();
  const rechargeMutation = trpc.live.startRecharge.useMutation();
  const trpcUtils = trpc.useUtils();
  const [assistantId, setAssistantId] = useState<PersonaId>("juni");
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [showMenu, setShowMenu] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [transcript, setTranscript] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const sessionRef = useRef<any>(null);
  const generationRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const statusRef = useRef<SessionStatus>("idle");

  const persona = JUNI_PERSONAS[assistantId];
  const isLive = status !== "idle" && status !== "error";
  const isBusy = status === "connecting" || status === "thinking";

  const addActivity = useCallback(
    (label: string, detail: string, tone: ActivityItem["tone"]) => {
      setActivity(current =>
        [{ id: Date.now(), label, detail, tone }, ...current].slice(0, 4)
      );
    },
    []
  );

  const stopPlayback = useCallback(() => {
    sourcesRef.current.forEach(source => {
      try {
        source.stop();
      } catch {
        /* source already ended */
      }
    });
    sourcesRef.current.clear();
    nextPlayTimeRef.current = 0;
  }, []);

  const playPcmChunk = useCallback(async (base64: string) => {
    const context =
      outputContextRef.current ?? new AudioContext({ sampleRate: 24000 });
    outputContextRef.current = context;
    if (context.state === "suspended") await context.resume();
    const pcm = base64ToPcm16(base64);
    const buffer = context.createBuffer(1, pcm.length, 24000);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < pcm.length; index += 1)
      channel[index] = (pcm[index] ?? 0) / 32768;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = Math.max(context.currentTime, nextPlayTimeRef.current);
    source.start(startAt);
    nextPlayTimeRef.current = startAt + buffer.duration;
    sourcesRef.current.add(source);
    source.onended = () => sourcesRef.current.delete(source);
  }, []);

  const sendToolResponse = useCallback(
    (id: string | undefined, name: string, response: unknown) => {
      sessionRef.current?.sendToolResponse({
        functionResponses: [{ id, name, response }],
      });
    },
    []
  );

  const closeSession = useCallback(async () => {
    generationRef.current += 1;
    sessionRef.current?.close?.();
    sessionRef.current = null;
    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (inputContextRef.current)
      await inputContextRef.current.close().catch(() => undefined);
    inputContextRef.current = null;
    stopPlayback();
    setStatus("idle");
    statusRef.current = "idle";
  }, [stopPlayback]);

  const handleLiveMessage = useCallback(
    async (message: any, generation: number) => {
      if (generation !== generationRef.current) return;
      const content = message.serverContent;
      if (content?.interrupted) {
        stopPlayback();
        setStatus("listening");
        statusRef.current = "listening";
      }
      if (content?.inputTranscription?.text)
        setTranscript(content.inputTranscription.text);
      if (content?.outputTranscription?.text)
        setTranscript(content.outputTranscription.text);
      if (content?.modelTurn?.parts) {
        for (const part of content.modelTurn.parts) {
          if (part.inlineData?.data) {
            setStatus("speaking");
            statusRef.current = "speaking";
            await playPcmChunk(part.inlineData.data);
          }
        }
      }
      if (content?.turnComplete) {
        setStatus("listening");
        statusRef.current = "listening";
      }
      const calls = message.toolCall?.functionCalls ?? [];
      for (const call of calls) {
        const args = (call.args ?? {}) as Record<string, unknown>;
        addActivity("Tool requested", call.name, "amber");
        if (call.name === "open_website") {
          const rawUrl = typeof args.url === "string" ? args.url : "";
          try {
            const url = new URL(rawUrl);
            if (url.protocol !== "https:")
              throw new Error("Only HTTPS websites can be opened.");
            setPendingAction({
              kind: "website",
              id: call.id,
              url: url.toString(),
              reason: String(args.reason ?? "Requested by JUNI"),
            });
          } catch {
            sendToolResponse(call.id, call.name, {
              ok: false,
              error: "Only valid https URLs are allowed.",
            });
          }
        } else if (call.name === "get_recharge_info") {
          const info = await trpcUtils.live.getRechargeInfo.fetch();
          sendToolResponse(call.id, call.name, info);
          addActivity("Read-only check", "Recharge status reviewed", "slate");
        } else if (call.name === "start_recharge") {
          const amount = Number(args.amount);
          if (!Number.isFinite(amount) || amount < 100 || amount > 100000) {
            sendToolResponse(call.id, call.name, {
              ok: false,
              error: "Amount must be between PKR 100 and PKR 100,000.",
            });
          } else {
            setPendingAction({ kind: "recharge", id: call.id, amount });
          }
        } else {
          sendToolResponse(call.id, call.name, {
            ok: false,
            error: "Tool is not allowlisted.",
          });
        }
      }
    },
    [
      addActivity,
      playPcmChunk,
      sendToolResponse,
      stopPlayback,
      trpcUtils.live.getRechargeInfo,
    ]
  );

  const connectSession = useCallback(async () => {
    if (!isAuthenticated) {
      startLogin();
      return;
    }
    setErrorMessage("");
    setStatus("connecting");
    statusRef.current = "connecting";
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    try {
      const token = await tokenMutation.mutateAsync();
      const ai = new GoogleGenAI({ apiKey: token.token });
      const session = await ai.live.connect({
        model: LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: persona.voiceName },
            },
          },
        },
        callbacks: {
          onopen: () =>
            addActivity(
              "Live session",
              `${persona.name} is listening`,
              assistantId === "juni" ? "mint" : "violet"
            ),
          onmessage: message => void handleLiveMessage(message, generation),
          onerror: event => {
            console.error("[Live] session error", event);
            setErrorMessage(
              "The live session lost its signal. Try reconnecting."
            );
            setStatus("error");
            statusRef.current = "error";
          },
          onclose: () => {
            if (
              generation === generationRef.current &&
              statusRef.current !== "idle"
            ) {
              setStatus("idle");
              statusRef.current = "idle";
            }
          },
        },
      });
      sessionRef.current = session;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;
      const inputContext = new AudioContext({ sampleRate: 16000 });
      inputContextRef.current = inputContext;
      const source = inputContext.createMediaStreamSource(stream);
      const processor = inputContext.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = event => {
        if (generation !== generationRef.current || !sessionRef.current) return;
        const pcm = floatToPcm16(event.inputBuffer.getChannelData(0));
        sessionRef.current.sendRealtimeInput({
          audio: { data: pcm16ToBase64(pcm), mimeType: "audio/pcm;rate=16000" },
        });
      };
      source.connect(processor);
      processor.connect(inputContext.destination);
      processorRef.current = processor;
      setStatus("listening");
      statusRef.current = "listening";
      addActivity("Microphone", "PCM16 · 16 kHz · mono", "slate");
    } catch (error) {
      console.error("[Live] could not connect", error);
      await closeSession();
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Could not start the voice session."
      );
      setStatus("error");
      statusRef.current = "error";
    }
  }, [
    addActivity,
    assistantId,
    closeSession,
    handleLiveMessage,
    isAuthenticated,
    persona,
    tokenMutation,
  ]);

  const switchAssistant = async (next: PersonaId) => {
    if (next === assistantId) return;
    if (isLive) await closeSession();
    setAssistantId(next);
    setTranscript(JUNI_PERSONAS[next].greeting);
    addActivity(
      "Assistant changed",
      JUNI_PERSONAS[next].name,
      next === "juni" ? "mint" : "violet"
    );
  };

  const approveAction = async () => {
    if (!pendingAction) return;
    if (pendingAction.kind === "website") {
      window.open(pendingAction.url, "_blank", "noopener,noreferrer");
      sendToolResponse(pendingAction.id, "open_website", {
        ok: true,
        opened: true,
        url: pendingAction.url,
      });
      addActivity(
        "Website opened",
        new URL(pendingAction.url).hostname,
        "mint"
      );
    } else {
      const result = await rechargeMutation.mutateAsync({
        amount: pendingAction.amount,
      });
      sendToolResponse(pendingAction.id, "start_recharge", result);
      addActivity(
        "Recharge intent",
        `PKR ${pendingAction.amount.toLocaleString()} · provider pending`,
        "amber"
      );
    }
    setPendingAction(null);
  };

  const declineAction = () => {
    if (pendingAction?.kind === "website")
      sendToolResponse(pendingAction.id, "open_website", {
        ok: false,
        cancelled: true,
      });
    if (pendingAction?.kind === "recharge")
      sendToolResponse(pendingAction.id, "start_recharge", {
        ok: false,
        cancelled: true,
      });
    addActivity("Action cancelled", "Nothing was changed", "slate");
    setPendingAction(null);
  };

  useEffect(
    () => () => {
      void closeSession();
    },
    [closeSession]
  );

  const statusLabel = useMemo(
    () =>
      ({
        idle: "Ready when you are",
        connecting: "Connecting securely",
        listening: "Listening",
        thinking: "Thinking",
        speaking: "Speaking",
        error: "Signal interrupted",
      })[status],
    [status]
  );
  const orbClass =
    assistantId === "juni"
      ? "from-emerald-300 via-cyan-300 to-blue-500"
      : "from-fuchsia-300 via-violet-300 to-indigo-500";
  const glowClass =
    assistantId === "juni" ? "bg-emerald-300/20" : "bg-fuchsia-300/20";

  return (
    <div className="min-h-screen overflow-hidden bg-[#080b13] text-white selection:bg-emerald-300 selection:text-[#080b13]">
      <div
        className={`pointer-events-none fixed left-1/2 top-[22%] size-[35rem] -translate-x-1/2 rounded-full ${glowClass} opacity-20 blur-[120px] transition-colors duration-500`}
      />
      <div className="pointer-events-none fixed inset-0 opacity-50 [background-image:linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.018)_1px,transparent_1px)] [background-size:32px_32px]" />
      <header className="relative z-20 flex items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
        <div className="flex items-center gap-3">
          <div
            className={`grid size-10 place-items-center rounded-2xl bg-gradient-to-br ${orbClass} shadow-lg shadow-emerald-400/10`}
          >
            <Sparkles className="size-5 text-[#080b13]" />
          </div>
          <div>
            <p className="font-display text-lg font-semibold tracking-[-0.04em]">
              JUNI
              <span
                className={
                  assistantId === "juni"
                    ? "text-emerald-300"
                    : "text-fuchsia-300"
                }
              >
                {" "}
                AI
              </span>
            </p>
            <p className="font-mono text-[9px] uppercase tracking-[0.24em] text-white/35">
              Voice companion
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-white/45 sm:flex">
            <ShieldCheck className="size-3.5 text-emerald-300" /> Ephemeral
            security
          </div>
          <button
            onClick={() => setShowMenu(open => !open)}
            className="rounded-xl border border-white/10 p-2.5 text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white"
            aria-label="Open account menu"
          >
            <MoreHorizontal className="size-5" />
          </button>
          {showMenu && (
            <div className="absolute right-5 top-16 w-64 rounded-2xl border border-white/10 bg-[#141727] p-4 shadow-2xl sm:right-8 lg:right-12">
              <p className="text-xs text-white/40">Session account</p>
              <p className="mt-1 truncate text-sm text-white/85">
                {user?.name ?? "Not signed in"}
              </p>
              <a
                href="/audit"
                className="mt-4 flex items-center justify-between rounded-xl bg-white/[0.05] px-3 py-2 text-xs text-white/70 hover:bg-white/[0.08]"
              >
                View security audit <ArrowUpRight className="size-3.5" />
              </a>
            </div>
          )}
        </div>
      </header>

      <main className="relative z-10 mx-auto flex min-h-[calc(100vh-88px)] max-w-6xl flex-col px-5 pb-8 sm:px-8 lg:px-12">
        <section className="flex flex-1 flex-col items-center justify-center py-8 text-center sm:py-12">
          <div className="mb-8 flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] p-1.5">
            {(Object.keys(JUNI_PERSONAS) as PersonaId[]).map(id => (
              <button
                key={id}
                onClick={() => void switchAssistant(id)}
                className={`group flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium transition-all duration-200 ${assistantId === id ? "bg-white text-[#080b13] shadow-lg" : "text-white/45 hover:text-white"}`}
              >
                <span
                  className={`size-2 rounded-full ${id === "juni" ? "bg-emerald-300" : "bg-fuchsia-300"}`}
                />
                {JUNI_PERSONAS[id].name}
                <span className="hidden text-[10px] opacity-50 sm:inline">
                  · {JUNI_PERSONAS[id].gender}
                </span>
              </button>
            ))}
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/35">
            {persona.role}
          </p>
          <h1 className="mt-3 font-display text-5xl font-semibold tracking-[-0.06em] text-white sm:text-7xl">
            {persona.name}
          </h1>
          <p
            className={`mt-3 text-sm font-medium transition-colors ${assistantId === "juni" ? "text-emerald-300" : "text-fuchsia-300"}`}
          >
            {persona.accent}
          </p>
          <div className="relative my-12 grid place-items-center sm:my-14">
            <div
              className={`absolute size-64 rounded-full ${glowClass} blur-3xl transition-colors duration-500`}
            />
            <div
              className={`absolute size-52 rounded-full border border-white/10 ${isLive ? "animate-pulse" : ""}`}
            />
            <button
              onClick={() => {
                if (isLive) void closeSession();
                else void connectSession();
              }}
              disabled={isBusy}
              className={`group relative grid size-40 place-items-center rounded-full bg-gradient-to-br ${orbClass} shadow-[0_0_70px_rgba(98,255,190,0.18)] transition-all duration-300 hover:scale-[1.04] active:scale-[0.97] disabled:cursor-wait disabled:opacity-70 sm:size-48`}
              aria-label={isLive ? "Stop voice session" : "Start voice session"}
            >
              {isBusy ? (
                <Loader2 className="size-10 animate-spin text-[#080b13]" />
              ) : isLive ? (
                <MicOff className="size-10 text-[#080b13]" />
              ) : (
                <Mic className="size-10 text-[#080b13]" />
              )}
              <span className="absolute -bottom-10 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.2em] text-white/45">
                {isLive ? "Tap to pause" : "Tap to speak"}
              </span>
            </button>
          </div>
          <div className="flex items-center gap-2 text-sm text-white/60">
            <span
              className={`size-2 rounded-full ${status === "error" ? "bg-rose-300" : isLive ? "animate-pulse bg-emerald-300" : "bg-white/20"}`}
            />
            {statusLabel}
          </div>
          {!isAuthenticated && !loading && (
            <button
              onClick={startLogin}
              className="mt-4 inline-flex items-center gap-2 text-xs text-white/40 underline decoration-white/20 underline-offset-4 hover:text-white/75"
            >
              <LogIn className="size-3.5" /> Sign in to start a private live
              session
            </button>
          )}
          {errorMessage && (
            <div className="mt-5 flex max-w-md items-center gap-2 rounded-xl border border-rose-300/20 bg-rose-400/[0.07] px-4 py-3 text-left text-xs text-rose-100/75">
              <CircleAlert className="size-4 shrink-0 text-rose-300" />
              {errorMessage}
            </div>
          )}
          {transcript && (
            <p className="mt-8 max-w-lg text-sm leading-6 text-white/45">
              “{transcript}”
            </p>
          )}
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr_0.75fr]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
                <Activity className="size-3.5 text-emerald-300" /> Live activity
              </span>
              <span className="font-mono text-[10px] text-white/25">
                {status === "idle" ? "STANDBY" : "STREAMING"}
              </span>
            </div>
            {activity.length === 0 ? (
              <div className="flex min-h-16 items-center gap-3 text-xs text-white/30">
                <Radio className="size-4" /> Your session trace will appear
                here.
              </div>
            ) : (
              <div className="space-y-3">
                {activity.map(item => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 text-xs"
                  >
                    <span
                      className={`size-1.5 rounded-full ${item.tone === "mint" ? "bg-emerald-300" : item.tone === "violet" ? "bg-fuchsia-300" : item.tone === "amber" ? "bg-amber-300" : "bg-white/30"}`}
                    />
                    <span className="text-white/70">{item.label}</span>
                    <span className="truncate text-white/30">
                      {item.detail}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
                <WalletCards className="size-3.5 text-amber-300" /> Safe actions
              </span>
              <span className="rounded-full bg-amber-300/10 px-2 py-1 font-mono text-[9px] text-amber-200">
                CONFIRM FIRST
              </span>
            </div>
            <p className="text-xs leading-5 text-white/40">
              JUNI can prepare website and recharge actions, but this app never
              opens or charges anything without your approval.
            </p>
          </div>
        </section>

        <footer className="mt-6 flex flex-col gap-2 border-t border-white/10 pt-5 text-[10px] text-white/25 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2">
            <Headphones className="size-3.5" /> Gemini Live · native audio · 24
            kHz output
          </span>
          <span className="font-mono">
            {user
              ? `Private session · ${user.name ?? "signed in"}`
              : "Authentication required for live audio"}
          </span>
        </footer>
      </main>

      {pendingAction && (
        <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-lg rounded-2xl border border-amber-300/25 bg-[#171827]/95 p-5 shadow-2xl shadow-black/50 backdrop-blur-xl sm:inset-x-auto sm:right-6 sm:bottom-6">
          <div className="flex items-start gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-300/10 text-amber-200">
              {pendingAction.kind === "website" ? (
                <ExternalLink className="size-4" />
              ) : (
                <WalletCards className="size-4" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white">
                {pendingAction.kind === "website"
                  ? "Open this website?"
                  : "Prepare recharge flow?"}
              </p>
              <p className="mt-1 text-xs leading-5 text-white/50">
                {pendingAction.kind === "website" ? (
                  <>
                    {pendingAction.reason}
                    <br />
                    <span className="break-all font-mono text-amber-200/80">
                      {pendingAction.url}
                    </span>
                  </>
                ) : (
                  <>
                    JUNI requested a safe recharge intent for{" "}
                    <span className="font-semibold text-amber-200">
                      PKR {pendingAction.amount.toLocaleString()}
                    </span>
                    . No payment will be made yet.
                  </>
                )}
              </p>
            </div>
            <button
              onClick={declineAction}
              className="text-white/35 hover:text-white"
              aria-label="Cancel action"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => void approveAction()}
              disabled={rechargeMutation.isPending}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-300 px-4 py-2.5 text-xs font-semibold text-[#17120a] transition-transform active:scale-[0.98]"
            >
              {rechargeMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}{" "}
              Approve safely
            </button>
            <button
              onClick={declineAction}
              className="rounded-xl border border-white/10 px-4 py-2.5 text-xs text-white/55 hover:bg-white/[0.05]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
