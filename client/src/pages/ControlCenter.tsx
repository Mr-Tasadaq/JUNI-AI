import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleAlert,
  FileCheck2,
  GitBranch,
  GitCommitHorizontal,
  Github,
  KeyRound,
  LockKeyhole,
  Play,
  Rocket,
  ShieldCheck,
  Terminal,
  UserCheck,
} from "lucide-react";

const allowed = [
  ["Read & edit code", "Source files, tests, docs, and configuration"],
  ["Create branches", "Work in isolated branches when appropriate"],
  ["Run validation", "Formatter, typecheck, tests, and production build"],
  ["Commit & push", "Focused commits with clear evidence"],
  ["Pull request workflow", "Create and update PRs and issues when requested"],
];

const approval = [
  ["Delete", "Repositories, branches, tags, files, releases, issues, or PRs"],
  [
    "Security & access",
    "Visibility, owners, collaborators, teams, deploy keys, OAuth",
  ],
  [
    "Governance",
    "Branch protection, rulesets, required reviews, merge restrictions",
  ],
  [
    "Secrets",
    "Create, rotate, expose, or delete repository and environment secrets",
  ],
  [
    "Irreversible actions",
    "Force-push, production deployment, billing, or external operations",
  ],
];

function StatusBadge({
  children,
  tone = "mint",
}: {
  children: React.ReactNode;
  tone?: "mint" | "amber";
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${tone === "mint" ? "border-[#8fffc0]/20 bg-[#8fffc0]/10 text-[#8fffc0]" : "border-[#f3c969]/25 bg-[#f3c969]/10 text-[#f3c969]"}`}
    >
      {tone === "mint" ? (
        <Check className="h-3 w-3" />
      ) : (
        <CircleAlert className="h-3 w-3" />
      )}
      {children}
    </span>
  );
}

export default function ControlCenter() {
  return (
    <main className="min-h-screen bg-[#080b13] text-[#f4f5f8]">
      <div
        className="pointer-events-none fixed inset-0 overflow-hidden"
        aria-hidden="true"
      >
        <div className="absolute -left-40 top-[-16rem] h-[38rem] w-[38rem] rounded-full bg-[#8fffc0]/[0.08] blur-3xl" />
        <div className="absolute right-[-18rem] top-[16rem] h-[34rem] w-[34rem] rounded-full bg-[#a78bfa]/[0.08] blur-3xl" />
        <div className="control-grid absolute inset-0" />
      </div>
      <header className="relative z-10 border-b border-white/[0.08] bg-[#080b13]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-4 sm:px-8 lg:px-12">
          <a href="/" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#8fffc0]/30 bg-[#8fffc0]/10">
              <Github className="h-4 w-4 text-[#8fffc0]" />
            </span>
            <span>
              <span className="block font-display text-sm font-semibold tracking-[0.2em]">
                JUNI AI
              </span>
              <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">
                repository control center
              </span>
            </span>
          </a>
          <a
            href="/journal"
            className="flex items-center gap-2 text-xs text-white/50 transition-colors hover:text-[#8fffc0]"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Implementation journal
          </a>
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-[1440px] px-5 pb-20 pt-12 sm:px-8 lg:px-12 lg:pt-20">
        <div className="flex flex-col justify-between gap-7 lg:flex-row lg:items-end">
          <div>
            <div className="mb-5 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[#8fffc0]">
              <span className="h-px w-8 bg-[#8fffc0]" /> Safe full development
              control
            </div>
            <h1 className="max-w-4xl font-display text-5xl font-semibold leading-[0.95] tracking-[-0.06em] sm:text-7xl">
              A clear path from
              <br />
              <span className="text-[#8fffc0]">intent to commit.</span>
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-7 text-white/50">
              Repository control is powerful when its boundaries are explicit.
              This workspace keeps normal development fast while requiring
              approval for security-sensitive or irreversible actions.
            </p>
          </div>
          <StatusBadge>policy active</StatusBadge>
        </div>

        <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-[#8fffc0]/20 bg-[#8fffc0]/[0.06] p-5">
            <Github className="h-5 w-5 text-[#8fffc0]" />
            <div className="mt-7 font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
              Repository
            </div>
            <div className="mt-1 font-display text-xl font-semibold">
              Mr-Tasadaq/JUNI-AI
            </div>
          </div>
          <div className="rounded-2xl border border-white/[0.09] bg-white/[0.03] p-5">
            <UserCheck className="h-5 w-5 text-[#a78bfa]" />
            <div className="mt-7 font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
              Account permission
            </div>
            <div className="mt-1 font-display text-xl font-semibold">ADMIN</div>
          </div>
          <div className="rounded-2xl border border-white/[0.09] bg-white/[0.03] p-5">
            <GitBranch className="h-5 w-5 text-[#f3c969]" />
            <div className="mt-7 font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
              Default branch
            </div>
            <div className="mt-1 font-display text-xl font-semibold">main</div>
          </div>
          <div className="rounded-2xl border border-white/[0.09] bg-white/[0.03] p-5">
            <ShieldCheck className="h-5 w-5 text-[#8fffc0]" />
            <div className="mt-7 font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
              Policy commit
            </div>
            <div className="mt-1 font-display text-xl font-semibold">
              fc92381
            </div>
          </div>
        </div>

        <section className="mt-16 grid gap-10 lg:grid-cols-[1fr_1fr] lg:gap-16">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8fffc0]">
              01 / Allowed by default
            </div>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-[-0.04em]">
              Development can move.
            </h2>
            <div className="mt-7 overflow-hidden rounded-2xl border border-white/[0.09]">
              {allowed.map(([title, description]) => (
                <div
                  key={title}
                  className="flex gap-4 border-b border-white/[0.07] p-5 last:border-0"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#8fffc0]/10">
                    <Check className="h-4 w-4 text-[#8fffc0]" />
                  </div>
                  <div>
                    <div className="font-semibold text-white/90">{title}</div>
                    <div className="mt-1 text-sm leading-5 text-white/40">
                      {description}
                    </div>
                  </div>
                  <ChevronRight className="ml-auto mt-1 h-4 w-4 text-white/20" />
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#f3c969]">
              02 / Approval boundary
            </div>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-[-0.04em]">
              Governance stays human.
            </h2>
            <div className="mt-7 overflow-hidden rounded-2xl border border-[#f3c969]/15">
              {approval.map(([title, description]) => (
                <div
                  key={title}
                  className="flex gap-4 border-b border-white/[0.07] p-5 last:border-0"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#f3c969]/10">
                    <LockKeyhole className="h-4 w-4 text-[#f3c969]" />
                  </div>
                  <div>
                    <div className="font-semibold text-white/90">{title}</div>
                    <div className="mt-1 text-sm leading-5 text-white/40">
                      {description}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-16 grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="rounded-2xl border border-white/[0.09] bg-[#0d111c]/85 p-6 sm:p-8">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-5">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#a78bfa]">
                  03 / Required workflow
                </div>
                <h2 className="mt-3 font-display text-2xl font-semibold">
                  Every change leaves evidence.
                </h2>
              </div>
              <FileCheck2 className="h-6 w-6 text-[#a78bfa]" />
            </div>
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              {[
                ["01", "Inspect", "Understand the repository before writing."],
                ["02", "Implement", "Make the smallest safe change."],
                [
                  "03",
                  "Validate",
                  "Run formatter, typecheck, tests, and build.",
                ],
                ["04", "Review", "Check diff, changed files, and status."],
                ["05", "Publish", "Use a focused commit and report evidence."],
              ].map(([number, title, detail]) => (
                <div
                  key={number}
                  className="flex gap-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4"
                >
                  <span className="font-mono text-xs text-[#a78bfa]">
                    {number}
                  </span>
                  <div>
                    <div className="font-semibold text-white/85">{title}</div>
                    <div className="mt-1 text-sm text-white/40">{detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-[#8fffc0]/20 bg-[#8fffc0]/[0.06] p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <Terminal className="h-5 w-5 text-[#8fffc0]" />
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8fffc0]">
                Current state
              </span>
            </div>
            <div className="mt-8 space-y-4">
              {[
                ["Code access", "write enabled", Check],
                ["Git operations", "push enabled", GitCommitHorizontal],
                ["Secrets", "never exposed", KeyRound],
                ["Production", "approval required", Rocket],
              ].map(([title, state, Icon]) => (
                <div
                  key={title as string}
                  className="flex items-center justify-between border-b border-white/[0.08] pb-4 last:border-0 last:pb-0"
                >
                  <div className="flex items-center gap-3">
                    <Icon className="h-4 w-4 text-white/40" />
                    <span className="text-sm text-white/65">
                      {title as string}
                    </span>
                  </div>
                  <span
                    className={`font-mono text-[10px] uppercase tracking-wider ${(state as string).includes("required") ? "text-[#f3c969]" : "text-[#8fffc0]"}`}
                  >
                    {state as string}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <footer className="mt-16 flex flex-col gap-4 border-t border-white/[0.08] pt-7 text-xs text-white/35 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 font-mono">
            <Play className="h-3.5 w-3.5 text-[#8fffc0]" /> AGENTS.md / SAFE
            FULL DEVELOPMENT CONTROL
          </div>
          <div className="font-mono">
            No secrets. No silent governance changes.
          </div>
        </footer>
      </div>
    </main>
  );
}
