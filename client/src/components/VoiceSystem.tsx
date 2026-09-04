import React from "react";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  Loader2,
  Mic,
  MicOff,
  Radio,
  RotateCcw,
  Square,
  Volume2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  canTransition,
  type VoiceState,
  voiceStateLabel,
} from "@/lib/voiceState";

function statusCopy(state: VoiceState) {
  switch (state) {
    case "DISCONNECTED":
      return "Microphone is off. JUNI will ask for permission before listening.";
    case "CONNECTING":
      return "Requesting a secure microphone session…";
    case "CONNECTED":
      return "Microphone is connected. Start listening when you are ready.";
    case "LISTENING":
      return "Listening locally. Voice transcription is the next bridge to connect.";
    case "PROCESSING":
      return "Preparing the captured audio. No response has been generated yet.";
    case "SPEAKING":
      return "Voice output stage is active in this preview. No spoken response has been generated yet.";
    case "INTERRUPTED":
      return "Voice output was interrupted and can safely resume.";
    case "RECONNECTING":
      return "Reconnecting the voice session…";
    case "ERROR":
      return "Microphone access was not completed. Check browser permission and try again.";
  }
}

export default function VoiceSystem() {
  const [state, setState] = useState<VoiceState>("DISCONNECTED");
  const streamRef = useRef<MediaStream | null>(null);
  const timersRef = useRef<number[]>([]);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach(track => track.stop());
      timersRef.current.forEach(timer => window.clearTimeout(timer));
    },
    []
  );

  const transition = (next: VoiceState) => {
    setState(current => (canTransition(current, next) ? next : current));
  };

  const connect = async () => {
    transition(state === "ERROR" ? "RECONNECTING" : "CONNECTING");
    if (!navigator.mediaDevices?.getUserMedia) {
      transition("ERROR");
      return;
    }
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      transition("CONNECTED");
    } catch {
      transition("ERROR");
    }
  };

  const disconnect = () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (state === "LISTENING" || state === "SPEAKING")
      transition("INTERRUPTED");
    transition("DISCONNECTED");
  };

  const startListening = () => transition("LISTENING");
  const stopListening = () => {
    transition("PROCESSING");
    timersRef.current.push(
      window.setTimeout(() => transition("SPEAKING"), 500)
    );
    timersRef.current.push(
      window.setTimeout(() => transition("CONNECTED"), 1800)
    );
  };
  const previewSpeaking = () => {
    transition("SPEAKING");
    timersRef.current.push(
      window.setTimeout(() => transition("CONNECTED"), 1200)
    );
  };
  const interrupt = () => transition("INTERRUPTED");

  const isBusy =
    state === "CONNECTING" ||
    state === "RECONNECTING" ||
    state === "PROCESSING";
  const isConnected =
    state === "CONNECTED" ||
    state === "LISTENING" ||
    state === "SPEAKING" ||
    state === "INTERRUPTED";

  return (
    <section
      aria-labelledby="voice-system-title"
      className="rounded-[1.5rem] border border-emerald-100 bg-emerald-50/70 p-5 sm:p-6"
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-emerald-700 text-white shadow-sm">
            <Mic className="size-5" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3
                id="voice-system-title"
                className="font-display text-xl font-semibold text-slate-950"
              >
                Voice system
              </h3>
              <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-800">
                Mic preview
              </span>
            </div>
            <p className="mt-1 max-w-xl text-sm leading-6 text-slate-600">
              A controlled microphone session for hands-free JUNI conversations.
              Permission, transport, and AI response generation remain separate
              stages.
            </p>
          </div>
        </div>
        <div
          className="flex items-center gap-2 self-start rounded-full bg-white px-3 py-2 text-xs font-semibold text-slate-600"
          aria-live="polite"
        >
          <Radio
            className={
              state === "LISTENING"
                ? "size-3.5 animate-pulse text-emerald-600"
                : "size-3.5 text-slate-400"
            }
          />
          {voiceStateLabel(state)}
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-4 border-t border-emerald-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p
          className="flex items-start gap-2 text-sm leading-6 text-slate-600"
          aria-live="polite"
        >
          {state === "ERROR" ? (
            <AlertCircle className="mt-1 size-4 shrink-0 text-rose-600" />
          ) : (
            <Volume2 className="mt-1 size-4 shrink-0 text-emerald-700" />
          )}
          {statusCopy(state)}
        </p>
        <div className="flex flex-wrap gap-2">
          {!isConnected && state !== "PROCESSING" && (
            <Button
              className="rounded-xl bg-slate-950 text-white hover:bg-slate-800"
              onClick={() => void connect()}
              disabled={isBusy}
            >
              {isBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : state === "ERROR" ? (
                <RotateCcw className="size-4" />
              ) : (
                <Mic className="size-4" />
              )}
              {state === "ERROR"
                ? "Reconnect voice session"
                : "Enable microphone"}
            </Button>
          )}
          {state === "CONNECTED" && (
            <>
              <Button
                className="rounded-xl bg-emerald-700 text-white hover:bg-emerald-800"
                onClick={startListening}
              >
                <Mic className="size-4" />
                Start listening
              </Button>
              <Button
                variant="outline"
                className="rounded-xl"
                onClick={previewSpeaking}
              >
                <Volume2 className="size-4" />
                Preview speaking stage
              </Button>
            </>
          )}
          {state === "LISTENING" && (
            <Button
              className="rounded-xl bg-slate-950 text-white hover:bg-slate-800"
              onClick={stopListening}
            >
              <Square className="size-4" />
              Finish capture
            </Button>
          )}
          {(state === "LISTENING" || state === "SPEAKING") && (
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={interrupt}
            >
              <MicOff className="size-4" />
              Interrupt
            </Button>
          )}
          {isConnected && state !== "LISTENING" && state !== "SPEAKING" && (
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={disconnect}
            >
              Disconnect
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
