import {
  ArrowRight,
  Check,
  CircleAlert,
  Code2,
  Database,
  ExternalLink,
  FileText,
  Github,
  KeyRound,
  LockKeyhole,
  Network,
  Server,
  ShieldCheck,
  UserRound,
} from "lucide-react";

const flow = [
  ["01", "Browser", "OAuth intent + HttpOnly cookie transport", UserRound],
  ["02", "Manus OAuth", "Code exchange + provider identity", KeyRound],
  ["03", "Server context", "JWT verification → local users row", Server],
  ["04", "Protected tRPC", "ctx.user gates private procedures", ShieldCheck],
  ["05", "Provider / storage", "Server-only keys + owner boundary", Database],
] as const;

const procedures = [
  [
    "realtime.createClientSecret",
    "Protected",
    "Safety identifier from ctx.user.openId",
  ],
  ["files.analyze", "Protected", "Ephemeral analysis; no persisted metadata"],
  ["account.dashboard", "Protected", "Identity derived from ctx.user.id"],
  [
    "account.getRechargeInfo",
    "Protected",
    "Client owner fields cannot override context",
  ],
  [
    "account.startRecharge",
    "Protected",
    "Validated intent; no payment execution",
  ],
  ["system.notifyOwner", "Admin", "Database-derived role must be admin"],
  ["GET /manus-storage/*", "Owner scoped", "Only users/{ctx.user.id}/ keys"],
] as const;

const findings = [
  [
    "01",
    "Session token exposure",
    "HIGH",
    "Removed sessionStorage mirroring and browser Bearer forwarding.",
  ],
  [
    "02",
    "Storage IDOR boundary",
    "HIGH",
    "Added authentication and user-key prefix enforcement.",
  ],
  [
    "03",
    "Provider error leakage",
    "MED",
    "Provider failures now return a generic service-unavailable error.",
  ],
  [
    "04",
    "Identity override",
    "MED",
    "Server context remains the sole owner identity authority.",
  ],
];

export default function Architecture() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[#080b13] text-[#edf7f0]">
      <div className="architecture-grid pointer-events-none fixed inset-0 opacity-70" />
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#080b13]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-4 lg:px-12">
          <a
            href="/"
            className="flex items-center gap-3"
            aria-label="JUNI AI home"
          >
            <span className="grid size-9 place-items-center rounded-xl border border-[#8fffc0]/25 bg-[#8fffc0]/10 text-[#8fffc0]">
              <Network className="size-5" />
            </span>
            <span>
              <span className="block font-mono text-[9px] uppercase tracking-[0.3em] text-white/35">
                JUNI AI / ARCHITECTURE
              </span>
              <span className="font-display text-sm font-semibold tracking-wide text-white">
                SECURITY <span className="text-[#8fffc0]">RECORD</span>
              </span>
            </span>
          </a>
          <nav
            className="hidden items-center gap-6 font-mono text-[10px] uppercase tracking-[0.16em] text-white/45 md:flex"
            aria-label="Architecture navigation"
          >
            <a href="#flow" className="transition-colors hover:text-[#8fffc0]">
              Flow
            </a>
            <a
              href="#authorization"
              className="transition-colors hover:text-[#8fffc0]"
            >
              Authorization
            </a>
            <a
              href="#findings"
              className="transition-colors hover:text-[#8fffc0]"
            >
              Findings
            </a>
            <a
              href="#validation"
              className="transition-colors hover:text-[#8fffc0]"
            >
              Validation
            </a>
            <a
              href="https://github.com/Mr-Tasadaq/JUNI-AI"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[#8fffc0]"
            >
              GitHub <ExternalLink className="size-3" />
            </a>
          </nav>
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-[1440px] px-5 pb-24 lg:px-12">
        <section className="grid gap-12 pb-20 pt-16 lg:grid-cols-[1.15fr_0.85fr] lg:items-end lg:pt-24">
          <div>
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#8fffc0]/20 bg-[#8fffc0]/[0.07] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[#8fffc0]/90">
              <span className="size-1.5 animate-pulse rounded-full bg-[#8fffc0]" />{" "}
              Authentication hardened
            </div>
            <h1 className="max-w-4xl font-display text-5xl font-semibold leading-[0.96] tracking-[-0.06em] text-white sm:text-6xl lg:text-[6.2rem]">
              Trust is a<br />
              <span className="text-[#8fffc0]">server decision.</span>
            </h1>
            <p className="mt-8 max-w-2xl text-base leading-7 text-white/55 sm:text-lg">
              A living architecture record for the JUNI AI workspace. Follow
              identity from the browser to the protected provider boundary—and
              see exactly where ownership is enforced.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="#flow"
                className="inline-flex items-center gap-2 rounded-xl bg-[#8fffc0] px-4 py-3 text-sm font-semibold text-[#080b13] transition-all hover:-translate-y-0.5 hover:bg-[#b5ffda] active:scale-[0.98]"
              >
                Trace the request <ArrowRight className="size-4" />
              </a>
              <a
                href="/control-center"
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-3 text-sm font-medium text-white/75 transition-colors hover:border-white/30 hover:bg-white/[0.04]"
              >
                Control profile
              </a>
            </div>
          </div>
          <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/20 backdrop-blur-sm sm:p-6">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
                Current posture
              </span>
              <span className="flex items-center gap-1.5 font-mono text-[10px] text-[#8fffc0]">
                <span className="size-1.5 rounded-full bg-[#8fffc0]" /> VERIFIED
              </span>
            </div>
            <div className="grid grid-cols-2 gap-5 py-6">
              <div>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
                  Auth model
                </span>
                <p className="mt-2 font-display text-2xl text-white">
                  OAuth + JWT
                </p>
              </div>
              <div>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
                  Private routes
                </span>
                <p className="mt-2 font-display text-2xl text-white">
                  7 guarded
                </p>
              </div>
              <div>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
                  Provider keys
                </span>
                <p className="mt-2 font-display text-2xl text-[#8fffc0]">
                  Server-only
                </p>
              </div>
              <div>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
                  Tests
                </span>
                <p className="mt-2 font-display text-2xl text-white">
                  16 passing
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 border-t border-white/10 pt-4 text-xs text-white/50">
              <FileText className="size-4 text-[#8fffc0]" /> `ARCHITECTURE.md` ·
              living record
            </div>
          </div>
        </section>

        <section
          id="flow"
          className="scroll-mt-24 border-t border-white/10 py-16 lg:py-20"
        >
          <div className="mb-10 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#8fffc0]/75">
                01 / Request path
              </p>
              <h2 className="mt-3 font-display text-4xl tracking-[-0.04em] text-white sm:text-5xl">
                Identity, end to end.
              </h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-white/45">
              The browser never becomes the authority. Every private action
              resolves through the server context before reaching a provider,
              database, or storage boundary.
            </p>
          </div>
          <div className="grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 md:grid-cols-5">
            {flow.map(([number, title, detail, Icon], index) => (
              <div key={title} className="relative bg-[#0c111c] p-5 sm:p-6">
                <div className="mb-10 flex items-center justify-between">
                  <span className="font-mono text-[10px] text-[#8fffc0]/70">
                    {number}
                  </span>
                  <Icon className="size-5 text-white/45" />
                </div>
                <h3 className="font-display text-lg text-white">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-white/45">{detail}</p>
                {index < flow.length - 1 && (
                  <ArrowRight className="absolute -right-3 top-1/2 z-10 hidden size-5 text-[#8fffc0]/60 md:block" />
                )}
              </div>
            ))}
          </div>
        </section>

        <section
          id="authorization"
          className="scroll-mt-24 grid gap-10 border-t border-white/10 py-16 lg:grid-cols-[0.8fr_1.2fr] lg:py-20"
        >
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#8fffc0]/75">
              02 / Authorization model
            </p>
            <h2 className="mt-3 font-display text-4xl tracking-[-0.04em] text-white sm:text-5xl">
              The server owns identity.
            </h2>
            <p className="mt-6 max-w-md text-sm leading-7 text-white/50">
              Protected procedures use `ctx.user`, derived from the verified
              session and local database record. Extra client fields are ignored
              for ownership decisions.
            </p>
            <div className="mt-8 space-y-3">
              <div className="flex items-start gap-3 rounded-xl border border-[#8fffc0]/15 bg-[#8fffc0]/[0.05] p-4">
                <LockKeyhole className="mt-0.5 size-4 shrink-0 text-[#8fffc0]" />
                <span className="text-sm text-white/75">
                  No browser-supplied user ID can override the authenticated
                  context.
                </span>
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <Code2 className="mt-0.5 size-4 shrink-0 text-white/50" />
                <span className="text-sm text-white/60">
                  Future private resources must query by resource ID and owner
                  ID together.
                </span>
              </div>
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
            <div className="grid grid-cols-[1.4fr_0.65fr_1fr] border-b border-white/10 px-5 py-4 font-mono text-[9px] uppercase tracking-[0.18em] text-white/35">
              <span>Procedure / route</span>
              <span>Boundary</span>
              <span>Owner rule</span>
            </div>
            {procedures.map(([name, boundary, rule]) => (
              <div
                key={name}
                className="grid grid-cols-[1.4fr_0.65fr_1fr] items-center border-b border-white/[0.07] px-5 py-4 last:border-0"
              >
                <span className="font-mono text-xs text-white/80">{name}</span>
                <span className="text-xs text-[#8fffc0]/80">{boundary}</span>
                <span className="text-xs leading-5 text-white/45">{rule}</span>
              </div>
            ))}
          </div>
        </section>

        <section
          id="findings"
          className="scroll-mt-24 border-t border-white/10 py-16 lg:py-20"
        >
          <div className="mb-10">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#8fffc0]/75">
              03 / Security findings
            </p>
            <h2 className="mt-3 font-display text-4xl tracking-[-0.04em] text-white sm:text-5xl">
              Make the boundary visible.
            </h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {findings.map(([number, title, severity, detail]) => (
              <article
                key={number}
                className="group rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-[#8fffc0]/25 hover:bg-[#8fffc0]/[0.04] sm:p-6"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-white/30">
                    F-{number}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-1 font-mono text-[9px] tracking-[0.18em] ${severity === "HIGH" ? "border-orange-300/25 bg-orange-300/10 text-orange-200" : "border-amber-300/25 bg-amber-300/10 text-amber-200"}`}
                  >
                    {severity}
                  </span>
                </div>
                <h3 className="mt-8 font-display text-xl text-white">
                  {title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-white/50">{detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section
          id="validation"
          className="scroll-mt-24 grid gap-10 border-t border-white/10 py-16 lg:grid-cols-[1fr_0.8fr] lg:py-20"
        >
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#8fffc0]/75">
              04 / Evidence
            </p>
            <h2 className="mt-3 font-display text-4xl tracking-[-0.04em] text-white sm:text-5xl">
              Green means tested.
            </h2>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {[
                "Prettier",
                "pnpm check",
                "pnpm test · 16",
                "pnpm build",
                "git diff --check",
                "GitHub synced",
              ].map(item => (
                <div
                  key={item}
                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/70"
                >
                  <span className="grid size-5 place-items-center rounded-full bg-[#8fffc0]/10 text-[#8fffc0]">
                    <Check className="size-3" />
                  </span>
                  {item}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.05] p-6">
            <CircleAlert className="size-5 text-amber-200" />
            <h3 className="mt-5 font-display text-xl text-white">
              Known limitations
            </h3>
            <p className="mt-3 text-sm leading-7 text-white/55">
              The local JWT remains stateless with its existing one-year
              lifetime. Durable conversations, memories, projects, tasks, and
              stored-file metadata are not yet active resources; they must
              receive owner-scoped tables and tests before exposure.
            </p>
            <a
              href="/journal"
              className="mt-6 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#8fffc0]"
            >
              Read implementation journal <ArrowRight className="size-3" />
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
