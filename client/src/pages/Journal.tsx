import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleDot,
  Clock3,
  Copy,
  ExternalLink,
  FileCode2,
  Filter,
  GitCommitHorizontal,
  LockKeyhole,
  Menu,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

const sessions = [
  {
    id: "14",
    kicker: "ACTIVE MILESTONE",
    title: "Core types & contract foundation",
    summary:
      "The first controlled implementation layer for JUNI AI’s canonical domain contracts. Small, verified, and intentionally resistant to speculative architecture.",
    status: "COMPLETE",
    date: "05 SEP 2026",
    duration: "42 min",
    color: "mint",
    sections: [
      {
        title: "Implemented contract",
        body: 'UserId is the canonical shared identity type. It aliases the Drizzle-derived User["id"] type, keeping the database schema authoritative while giving consuming code one stable domain name.',
      },
      {
        title: "Deferred by design",
        body: "SessionId, ConversationId, MessageId, FileId, MemoryId, MemoryCandidateId, ResearchId, TaskId, ActivityId, ProvenanceId, and OwnedByUser remain documented—not invented—until real consumers exist.",
      },
      {
        title: "Security boundary",
        body: "No secrets, provider credentials, migrations, tables, event infrastructure, vector storage, or automatic-memory behavior were introduced.",
      },
    ],
  },
  {
    id: "13",
    kicker: "FOUNDATION",
    title: "Coding workspace setup",
    summary:
      "Established the real repository root, package workflow, baseline commands, Git protection rules, and the implementation-agent operating protocol.",
    status: "COMPLETE",
    date: "04 SEP 2026",
    duration: "31 min",
    color: "violet",
    sections: [
      {
        title: "Repository baseline",
        body: "Frontend, backend, shared, database, configuration, migration, and documentation paths were inspected before implementation began.",
      },
      {
        title: "Validation",
        body: "pnpm install, pnpm test, pnpm check, and pnpm build all passed against the baseline.",
      },
      {
        title: "Operating rule",
        body: "Preserve valuable existing work. Inspect before writing. Make the smallest safe change, then verify it.",
      },
    ],
  },
];

const contractRows = [
  [
    "UserId",
    "shared/contracts/identity.ts",
    "Implemented",
    "Drizzle-derived identity boundary",
  ],
  ["PersonaId", "shared/juni.ts", "Canonical", "JUNI and SONA identity"],
  ["LanguageId", "shared/juni.ts", "Canonical", "Supported voice languages"],
  [
    "Tool declarations",
    "shared/juni.ts",
    "Canonical",
    "Safe realtime allowlist",
  ],
  ["ConversationId", "—", "Deferred", "No durable consumer yet"],
  ["MemoryId", "—", "Deferred", "Approval lifecycle not implemented"],
];

export default function Journal() {
  const [query, setQuery] = useState("");
  const [activeSession, setActiveSession] = useState("14");
  const [mobileNav, setMobileNav] = useState(false);
  const [copied, setCopied] = useState(false);

  const filteredSessions = useMemo(() => {
    const normalized = query.toLowerCase().trim();
    if (!normalized) return sessions;
    return sessions.filter(session =>
      `${session.title} ${session.summary} ${session.sections.map(item => `${item.title} ${item.body}`).join(" ")}`
        .toLowerCase()
        .includes(normalized)
    );
  }, [query]);

  const active =
    sessions.find(session => session.id === activeSession) ?? sessions[0];

  const copyCommit = async () => {
    await navigator.clipboard?.writeText(
      "6b60900 feat: establish JUNI AI core contracts"
    );
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <main className="min-h-screen overflow-hidden bg-[#080b13] text-[#f4f5f8]">
      <div
        className="pointer-events-none fixed inset-0 opacity-80"
        aria-hidden="true"
      >
        <div className="absolute -left-40 top-[-18rem] h-[36rem] w-[36rem] rounded-full bg-[#8fffc0]/[0.08] blur-3xl" />
        <div className="absolute right-[-16rem] top-[26rem] h-[32rem] w-[32rem] rounded-full bg-[#a78bfa]/[0.08] blur-3xl" />
        <div className="journal-grid absolute inset-0" />
      </div>

      <header className="relative z-10 border-b border-white/[0.08] bg-[#080b13]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-4 sm:px-8 lg:px-12">
          <a href="#top" className="group flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#8fffc0]/30 bg-[#8fffc0]/10 text-[#8fffc0] transition-transform duration-200 group-hover:rotate-6">
              <Sparkles className="h-4 w-4" />
            </span>
            <span>
              <span className="block font-display text-sm font-semibold tracking-[0.22em] text-white">
                JUNI AI
              </span>
              <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
                implementation journal
              </span>
            </span>
          </a>
          <nav className="hidden items-center gap-7 md:flex">
            <a
              href="#sessions"
              className="text-xs font-medium text-white/60 transition-colors hover:text-[#8fffc0]"
            >
              Sessions
            </a>
            <a
              href="#contracts"
              className="text-xs font-medium text-white/60 transition-colors hover:text-[#8fffc0]"
            >
              Contracts
            </a>
            <a
              href="#validation"
              className="text-xs font-medium text-white/60 transition-colors hover:text-[#8fffc0]"
            >
              Validation
            </a>
            <a
              href="/"
              className="flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs font-semibold text-white transition-all hover:border-[#8fffc0]/40 hover:bg-[#8fffc0]/10"
            >
              Open JUNI <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </nav>
          <button
            className="rounded-lg p-2 text-white/70 md:hidden"
            onClick={() => setMobileNav(value => !value)}
            aria-label="Toggle navigation"
          >
            {mobileNav ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </button>
        </div>
        {mobileNav && (
          <nav className="border-t border-white/[0.08] px-5 py-4 md:hidden">
            <div className="flex flex-col gap-4 text-sm text-white/70">
              <a href="#sessions" onClick={() => setMobileNav(false)}>
                Sessions
              </a>
              <a href="#contracts" onClick={() => setMobileNav(false)}>
                Contracts
              </a>
              <a href="#validation" onClick={() => setMobileNav(false)}>
                Validation
              </a>
              <a href="/">Open JUNI</a>
            </div>
          </nav>
        )}
      </header>

      <section
        id="top"
        className="relative z-10 mx-auto max-w-[1440px] px-5 pb-20 pt-16 sm:px-8 lg:px-12 lg:pb-28 lg:pt-24"
      >
        <div className="max-w-4xl">
          <div className="mb-7 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.22em] text-[#8fffc0]">
            <span className="h-px w-9 bg-[#8fffc0]" />A living record of the
            build
          </div>
          <h1 className="max-w-4xl font-display text-5xl font-semibold leading-[0.98] tracking-[-0.055em] text-white sm:text-7xl lg:text-[6.6rem]">
            Build with
            <span className="block text-[#8fffc0]">evidence.</span>
          </h1>
          <p className="mt-8 max-w-2xl text-base leading-7 text-white/55 sm:text-lg">
            JUNI AI is being shaped through small, verifiable steps. This
            journal makes the decisions, boundaries, and proof of work
            visible—without claiming more than the code can support.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <a
              href="#sessions"
              className="group inline-flex items-center gap-3 rounded-full bg-[#8fffc0] px-5 py-3 text-sm font-bold text-[#08100d] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#b4ffd4]"
            >
              Explore the work{" "}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </a>
            <button
              onClick={copyCommit}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 px-5 py-3 font-mono text-xs text-white/60 transition-colors hover:border-white/25 hover:text-white"
            >
              {copied ? (
                <Check className="h-4 w-4 text-[#8fffc0]" />
              ) : (
                <GitCommitHorizontal className="h-4 w-4" />
              )}
              {copied ? "Commit copied" : "6b60900"}
              <Copy className="h-3.5 w-3.5 opacity-50" />
            </button>
          </div>
        </div>

        <div className="mt-20 grid gap-px overflow-hidden rounded-2xl border border-white/[0.09] bg-white/[0.09] sm:grid-cols-3">
          {[
            ["14", "sections completed", "from workspace to contracts"],
            ["11", "tests passing", "across 4 test files"],
            ["0", "tables added", "no speculative persistence"],
          ].map(([number, label, detail]) => (
            <div key={label} className="bg-[#0d111c]/90 p-6 sm:p-7">
              <div className="font-display text-4xl font-semibold tracking-[-0.06em] text-white">
                {number}
              </div>
              <div className="mt-2 text-sm font-semibold text-white/80">
                {label}
              </div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-white/35">
                {detail}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section
        id="sessions"
        className="relative z-10 border-y border-white/[0.08] bg-[#0a0e18]/80"
      >
        <div className="mx-auto grid max-w-[1440px] gap-0 lg:grid-cols-[0.85fr_1.3fr]">
          <div className="border-b border-white/[0.08] p-5 sm:p-8 lg:border-b-0 lg:border-r lg:p-12">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8fffc0]">
                  01 / Sessions
                </div>
                <h2 className="mt-3 font-display text-3xl font-semibold tracking-[-0.04em]">
                  The work log
                </h2>
              </div>
              <div className="rounded-full border border-[#8fffc0]/20 bg-[#8fffc0]/10 px-3 py-1 font-mono text-[10px] text-[#8fffc0]">
                LIVE
              </div>
            </div>
            <div className="relative mt-10 space-y-3">
              <div className="absolute bottom-5 left-[18px] top-5 w-px bg-gradient-to-b from-[#8fffc0]/70 via-white/10 to-transparent" />
              {filteredSessions.map(session => (
                <button
                  key={session.id}
                  onClick={() => setActiveSession(session.id)}
                  className={`relative flex w-full gap-4 rounded-xl p-4 text-left transition-all duration-200 ${activeSession === session.id ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"}`}
                >
                  <span
                    className={`relative z-10 mt-1 flex h-2.5 w-2.5 shrink-0 rounded-full border-2 ${activeSession === session.id ? "border-[#8fffc0] bg-[#8fffc0] shadow-[0_0_14px_#8fffc0]" : "border-white/30 bg-[#0a0e18]"}`}
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em] text-white/35">
                      Session {session.id} <span>·</span> {session.date}
                    </span>
                    <span className="mt-1 block font-display text-lg font-semibold text-white">
                      {session.title}
                    </span>
                    <span className="mt-1 block line-clamp-2 text-sm leading-5 text-white/45">
                      {session.summary}
                    </span>
                  </span>
                  <ChevronDown
                    className={`ml-auto mt-1 h-4 w-4 shrink-0 text-white/30 transition-transform ${activeSession === session.id ? "-rotate-90 text-[#8fffc0]" : ""}`}
                  />
                </button>
              ))}
              {filteredSessions.length === 0 && (
                <div className="rounded-xl border border-dashed border-white/10 p-5 text-sm text-white/40">
                  No journal entry matches “{query}”.
                </div>
              )}
            </div>
          </div>

          <div className="p-5 sm:p-8 lg:p-12">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
              <div>
                <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[#8fffc0]">
                  <CircleDot className="h-3 w-3" /> Session {active.id} ·{" "}
                  {active.kicker}
                </div>
                <h2 className="mt-4 max-w-2xl font-display text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
                  {active.title}
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-2 rounded-full border border-[#8fffc0]/20 bg-[#8fffc0]/10 px-3 py-1.5 font-mono text-[10px] font-medium tracking-[0.12em] text-[#8fffc0]">
                <Check className="h-3.5 w-3.5" /> {active.status}
              </div>
            </div>
            <p className="mt-6 max-w-2xl text-base leading-7 text-white/55">
              {active.summary}
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {active.sections.map((section, index) => (
                <article
                  key={section.title}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-5 transition-colors hover:border-white/15"
                >
                  <div className="font-mono text-[10px] text-white/30">
                    0{index + 1}
                  </div>
                  <h3 className="mt-6 font-display text-base font-semibold text-white">
                    {section.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/45">
                    {section.body}
                  </p>
                </article>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-3 border-t border-white/[0.08] pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
              <span className="inline-flex items-center gap-2">
                <Clock3 className="h-3.5 w-3.5" /> {active.duration}
              </span>
              <span className="inline-flex items-center gap-2">
                <GitCommitHorizontal className="h-3.5 w-3.5" /> 6b60900
              </span>
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5 text-[#8fffc0]" /> security
                reviewed
              </span>
            </div>
          </div>
        </div>
      </section>

      <section
        id="contracts"
        className="relative z-10 mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-28"
      >
        <div className="grid gap-12 lg:grid-cols-[0.7fr_1.3fr] lg:gap-24">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#a78bfa]">
              02 / Contract map
            </div>
            <h2 className="mt-4 font-display text-4xl font-semibold tracking-[-0.05em] text-white">
              One owner.
              <br />
              No silent duplicates.
            </h2>
            <p className="mt-6 max-w-sm text-sm leading-6 text-white/45">
              Every domain contract has one canonical owner. The rest of the
              system consumes it. If the codebase cannot support a type yet, the
              honest status is deferred.
            </p>
            <div className="mt-8 flex items-center gap-3 rounded-xl border border-[#a78bfa]/20 bg-[#a78bfa]/[0.07] p-4 text-sm text-white/65">
              <LockKeyhole className="h-4 w-4 shrink-0 text-[#a78bfa]" />{" "}
              Provider details stay behind the boundary.
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/[0.09]">
            <div className="grid grid-cols-[1fr_1.4fr_0.9fr] gap-4 border-b border-white/[0.08] bg-white/[0.03] px-5 py-4 font-mono text-[10px] uppercase tracking-[0.15em] text-white/30">
              <span>Contract</span>
              <span>Owner</span>
              <span>Status</span>
            </div>
            {contractRows.map(([name, owner, status, purpose]) => (
              <div
                key={name}
                className="grid grid-cols-[1fr_1.4fr_0.9fr] gap-4 border-b border-white/[0.06] px-5 py-4 last:border-0"
              >
                <div>
                  <div className="font-mono text-xs text-white/80">{name}</div>
                  <div className="mt-1 text-[11px] text-white/35">
                    {purpose}
                  </div>
                </div>
                <div className="break-all font-mono text-[11px] text-white/45">
                  {owner}
                </div>
                <div>
                  <span
                    className={`inline-flex rounded-full px-2 py-1 font-mono text-[9px] uppercase tracking-wider ${status === "Implemented" ? "bg-[#8fffc0]/10 text-[#8fffc0]" : status === "Canonical" ? "bg-[#a78bfa]/10 text-[#c4b5fd]" : "bg-white/[0.06] text-white/35"}`}
                  >
                    {status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="validation"
        className="relative z-10 border-y border-white/[0.08] bg-[#0a0e18]/80"
      >
        <div className="mx-auto grid max-w-[1440px] gap-10 px-5 py-20 sm:px-8 lg:grid-cols-[1fr_1fr] lg:px-12 lg:py-24">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8fffc0]">
              03 / Proof of work
            </div>
            <h2 className="mt-4 max-w-lg font-display text-4xl font-semibold tracking-[-0.05em] text-white">
              Green is good.
              <br />
              Truth is better.
            </h2>
            <p className="mt-6 max-w-lg text-sm leading-6 text-white/45">
              A completed milestone means the code exists, the existing
              repository still works, and validation has proven it. Nothing
              more. Nothing less.
            </p>
            <div className="mt-8 flex items-center gap-3 font-mono text-xs text-white/55">
              <Terminal className="h-4 w-4 text-[#8fffc0]" /> pnpm check{" "}
              <span className="text-white/20">→</span>{" "}
              <span className="text-[#8fffc0]">PASS</span>
            </div>
            <div className="mt-3 flex items-center gap-3 font-mono text-xs text-white/55">
              <Terminal className="h-4 w-4 text-[#8fffc0]" /> pnpm test{" "}
              <span className="text-white/20">→</span>{" "}
              <span className="text-[#8fffc0]">11 PASS</span>
            </div>
            <div className="mt-3 flex items-center gap-3 font-mono text-xs text-white/55">
              <Terminal className="h-4 w-4 text-[#8fffc0]" /> pnpm build{" "}
              <span className="text-white/20">→</span>{" "}
              <span className="text-[#8fffc0]">PASS</span>
            </div>
          </div>
          <div className="relative overflow-hidden rounded-2xl border border-white/[0.09] bg-[#080b13] p-6 sm:p-8">
            <div className="absolute right-0 top-0 h-32 w-32 rounded-full bg-[#8fffc0]/10 blur-3xl" />
            <div className="relative flex items-center justify-between border-b border-white/[0.08] pb-5">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
                Release gate
              </span>
              <span className="flex items-center gap-2 font-mono text-[10px] text-[#8fffc0]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#8fffc0] shadow-[0_0_10px_#8fffc0]" />{" "}
                ALL SYSTEMS NOMINAL
              </span>
            </div>
            <div className="relative mt-7 flex items-end gap-2">
              <div className="font-display text-7xl font-semibold tracking-[-0.08em] text-white">
                100
              </div>
              <div className="mb-3 font-mono text-2xl text-[#8fffc0]">%</div>
            </div>
            <div className="mt-2 text-sm text-white/45">
              Section 14 validation completion
            </div>
            <div className="mt-8 h-2 overflow-hidden rounded-full bg-white/[0.08]">
              <div className="h-full w-full rounded-full bg-gradient-to-r from-[#8fffc0] to-[#a78bfa]" />
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {["types", "tests", "build", "security"].map(label => (
                <div
                  key={label}
                  className="rounded-lg border border-white/[0.07] px-3 py-3 text-center"
                >
                  <Check className="mx-auto h-4 w-4 text-[#8fffc0]" />
                  <div className="mt-2 font-mono text-[9px] uppercase tracking-wider text-white/35">
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer className="relative z-10 mx-auto flex max-w-[1440px] flex-col gap-4 px-5 py-10 text-xs text-white/35 sm:px-8 md:flex-row md:items-center md:justify-between lg:px-12">
        <div className="flex items-center gap-2 font-mono">
          <FileCode2 className="h-4 w-4 text-[#8fffc0]" /> JUNI AI / CONTINUUM
        </div>
        <div className="font-mono">
          Documented, tested, and intentionally unfinished where it should be.
        </div>
      </footer>

      <div className="fixed bottom-5 right-5 z-20 hidden w-64 rounded-xl border border-white/10 bg-[#0d111c]/90 p-3 shadow-2xl backdrop-blur-xl lg:block">
        <div className="flex items-center gap-2 border-b border-white/[0.08] pb-3">
          <Search className="h-3.5 w-3.5 text-[#8fffc0]" />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search the journal…"
            className="w-full bg-transparent font-mono text-[11px] text-white outline-none placeholder:text-white/25"
          />
          <Filter className="h-3.5 w-3.5 text-white/25" />
        </div>
        <div className="mt-3 flex items-center justify-between font-mono text-[9px] uppercase tracking-wider text-white/25">
          <span>Filter sessions</span>
          <span>{filteredSessions.length} results</span>
        </div>
      </div>
    </main>
  );
}
