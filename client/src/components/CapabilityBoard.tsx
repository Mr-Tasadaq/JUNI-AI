import React from "react";
import { CheckCircle2, CircleAlert, Lightbulb, Sparkles } from "lucide-react";

const columns = [
  {
    title: "Examples",
    eyebrow: "Try a starting point",
    icon: Lightbulb,
    tone: "bg-amber-50 text-amber-800",
    items: [
      "Turn a fuzzy idea into a clear plan →",
      "Help me compare two difficult choices →",
      "Explain a complex topic in plain language →",
    ],
  },
  {
    title: "Capabilities",
    eyebrow: "Available in this workspace",
    icon: Sparkles,
    tone: "bg-emerald-50 text-emerald-800",
    items: [
      "Secure conversational workspace",
      "User-scoped conversation memory",
      "Server-mediated AI responses",
    ],
  },
  {
    title: "Limitations",
    eyebrow: "What is not verified yet",
    icon: CircleAlert,
    tone: "bg-slate-100 text-slate-700",
    items: [
      "Voice transcription bridge is still in progress",
      "No live web research connector in this milestone",
      "No durable personal memory is saved automatically",
    ],
  },
] as const;

export default function CapabilityBoard() {
  return (
    <section aria-labelledby="capability-board-title" className="mt-8">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
            JUNI capability board
          </p>
          <h3
            id="capability-board-title"
            className="mt-1 font-display text-2xl font-semibold tracking-[-0.03em] text-slate-950"
          >
            Clear about what happens next.
          </h3>
        </div>
        <p className="max-w-sm text-sm leading-6 text-slate-500">
          A compact map of what you can ask for, what is ready, and what JUNI
          will never pretend to have verified.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {columns.map(({ title, eyebrow, icon: Icon, tone, items }) => (
          <article
            key={title}
            className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-[0_12px_30px_rgba(42,70,65,0.04)]"
          >
            <div className="flex items-center gap-3">
              <span
                className={`grid size-9 place-items-center rounded-xl ${tone}`}
              >
                <Icon className="size-4" />
              </span>
              <div>
                <h4 className="text-sm font-semibold text-slate-950">
                  {title}
                </h4>
                <p className="text-xs text-slate-400">{eyebrow}</p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {items.map(item => (
                <div
                  key={item}
                  className="flex items-start gap-2 rounded-xl bg-slate-50/80 px-3 py-3 text-sm leading-5 text-slate-600"
                >
                  {title === "Capabilities" ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  ) : null}
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
