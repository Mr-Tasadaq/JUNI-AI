import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clipboard,
  ExternalLink,
  FileCheck2,
  Github,
  LockKeyhole,
  Menu,
  Radar,
  ScanSearch,
  Shield,
  ShieldAlert,
  Sparkles,
  X,
  Zap,
} from "lucide-react";

type Severity = "Critical" | "High" | "Medium" | "Low";
type Filter = "All" | Severity;

type Finding = {
  id: string;
  severity: Severity;
  status: string;
  title: string;
  summary: string;
  evidence: string;
  recommendation: string;
};

const findings: Finding[] = [
  {
    id: "F-01",
    severity: "Critical",
    status: "Confirmed · external",
    title: "GitHub personal access token exposed",
    summary:
      "A GitHub PAT was pasted into the conversation and displayed in an image.",
    evidence:
      "The exposed credential is outside the repository, but anyone with access to the message or image may be able to use it depending on scope and validity.",
    recommendation:
      "Revoke it immediately, review token activity, then create a minimum-scope replacement with an expiry only if required.",
  },
  {
    id: "F-02",
    severity: "High",
    status: "Confirmed · repository control",
    title: "Dependabot alerts are disabled",
    summary:
      "GitHub reports dependency alerts are disabled for the public repository.",
    evidence:
      "There is no active dependency CVE because the project has no dependency manifest in the audited revision, but the future detection control is absent.",
    recommendation:
      "Enable Dependabot alerts and security updates before adding dependencies; commit lockfiles and add dependency review in CI.",
  },
  {
    id: "F-03",
    severity: "Medium",
    status: "Confirmed · repository control",
    title: "No security policy",
    summary:
      "Repository metadata reports no SECURITY.md and no security policy URL.",
    evidence:
      "There is currently no documented supported-version policy, private disclosure route, or response expectation.",
    recommendation:
      "Add SECURITY.md with responsible disclosure instructions, credential-exposure guidance, and response expectations.",
  },
  {
    id: "F-04",
    severity: "Medium",
    status: "Confirmed · repository control",
    title: "No automated security or quality checks",
    summary:
      "No CI workflow, tests, linter, or scanner configuration exists in the audited tree.",
    evidence:
      "The repository contains only README.md across two commits; no executable code or dependency manifest was present to validate.",
    recommendation:
      "Add CI with secret scanning, dependency audit, SAST, formatting, tests, and least-privilege workflow permissions.",
  },
  {
    id: "F-05",
    severity: "Medium",
    status: "Design risk · not exploitable yet",
    title: "Autonomous tool boundary is undefined",
    summary:
      "Planned browser, device, API, and autonomous actions need an enforcement layer before implementation.",
    evidence:
      "The roadmap names device control and external access but does not yet define authorization, sandboxing, SSRF protections, rate limits, or audit-log integrity.",
    recommendation:
      "Require server-side mediation, strict schemas, allowlists, per-user authorization, timeouts, approvals, isolation, and outbound-network controls.",
  },
  {
    id: "F-06",
    severity: "Medium",
    status: "Design risk · not exploitable yet",
    title: "Multimodal memory needs a privacy model",
    summary:
      "Voice, video, documents, embeddings, and long-term memory create retention and access risks.",
    evidence:
      "The planning documents describe a 10GB local brain, but not yet data classification, encryption, tenant isolation, or deletion verification.",
    recommendation:
      "Define consent, retention, export, deletion, encryption, redaction, provider-sharing, quota, backup, and tenant-boundary requirements first.",
  },
  {
    id: "F-07",
    severity: "Low",
    status: "Confirmed · documentation",
    title: "README overstates implementation status",
    summary:
      "The README lists a full project structure that is not present in the repository.",
    evidence:
      "The audited tree contains only README.md, while the README lists docs, src, frontend, backend, tests, and manifests as if they exist.",
    recommendation:
      "Label the project documentation-only, mark illustrative structure as planned, and synchronize acceptance status with the actual tree.",
  },
  {
    id: "F-08",
    severity: "Low",
    status: "Confirmed · documentation",
    title: "MIT claim lacks a license file",
    summary:
      "The README says MIT, but GitHub detects no license and no LICENSE file exists.",
    evidence:
      "The license claim is not backed by the complete legal text or repository metadata.",
    recommendation:
      "Add the complete MIT license with the correct copyright holder, or remove the claim and choose a license explicitly.",
  },
];

const severityStyles: Record<Severity, string> = {
  Critical: "border-rose-300/30 bg-rose-400/10 text-rose-200",
  High: "border-orange-300/30 bg-orange-400/10 text-orange-200",
  Medium: "border-amber-300/30 bg-amber-400/10 text-amber-200",
  Low: "border-sky-300/30 bg-sky-400/10 text-sky-200",
};

const severityDot: Record<Severity, string> = {
  Critical: "bg-rose-400",
  High: "bg-orange-300",
  Medium: "bg-amber-300",
  Low: "bg-sky-300",
};

function severityCount(severity: Severity) {
  return findings.filter(finding => finding.severity === severity).length;
}

export default function Home() {
  const [filter, setFilter] = useState<Filter>("All");
  const [expanded, setExpanded] = useState<string | null>("F-01");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const visibleFindings = useMemo(
    () =>
      filter === "All"
        ? findings
        : findings.filter(finding => finding.severity === filter),
    [filter]
  );

  const copyCommit = async () => {
    await navigator.clipboard?.writeText("9c3a19096568dd1be449a76186db2266dc6a1791");
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#08110f] text-[#edf7f0] selection:bg-emerald-300 selection:text-[#06100c]">
      <div className="pointer-events-none fixed inset-0 z-0 opacity-60 [background-image:radial-gradient(circle_at_15%_15%,rgba(92,255,184,0.09),transparent_28%),radial-gradient(circle_at_88%_5%,rgba(255,171,85,0.07),transparent_25%),linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] [background-size:auto,auto,42px_42px,42px_42px]" />
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#08110f]/80 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-5 py-4 lg:px-10">
          <a href="#top" className="group flex items-center gap-3" aria-label="Security Audit home">
            <span className="grid size-9 place-items-center rounded-xl border border-emerald-300/25 bg-emerald-300/10 text-emerald-200 transition-transform duration-200 group-hover:rotate-6">
              <Shield className="size-5" />
            </span>
            <span>
              <span className="block font-mono text-[10px] uppercase tracking-[0.28em] text-emerald-300/70">Audit surface</span>
              <span className="font-display text-sm font-semibold tracking-wide text-white">JOHNNY<span className="text-emerald-300">AI</span></span>
            </span>
          </a>
          <nav className="hidden items-center gap-7 text-xs font-medium text-white/55 md:flex" aria-label="Primary navigation">
            <a className="transition-colors hover:text-white" href="#overview">Overview</a>
            <a className="transition-colors hover:text-white" href="#findings">Findings</a>
            <a className="transition-colors hover:text-white" href="#remediation">Remediation</a>
            <a className="inline-flex items-center gap-1.5 text-emerald-300 transition-colors hover:text-emerald-200" href="https://github.com/TasadaqAli/JohnnyAI" target="_blank" rel="noreferrer">Repository <ExternalLink className="size-3" /></a>
          </nav>
          <button className="rounded-lg border border-white/10 p-2 text-white/70 md:hidden" onClick={() => setMobileOpen(open => !open)} aria-label="Toggle navigation">
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
        {mobileOpen && (
          <nav className="border-t border-white/10 px-5 py-4 md:hidden" aria-label="Mobile navigation">
            <div className="flex flex-col gap-4 text-sm text-white/70">
              <a href="#overview" onClick={() => setMobileOpen(false)}>Overview</a>
              <a href="#findings" onClick={() => setMobileOpen(false)}>Findings</a>
              <a href="#remediation" onClick={() => setMobileOpen(false)}>Remediation</a>
              <a href="https://github.com/TasadaqAli/JohnnyAI" target="_blank" rel="noreferrer">Repository ↗</a>
            </div>
          </nav>
        )}
      </header>

      <main id="top" className="relative z-10 mx-auto max-w-[1400px] px-5 pb-24 lg:px-10">
        <section id="overview" className="grid gap-10 pb-20 pt-16 lg:grid-cols-[1.2fr_0.8fr] lg:items-end lg:pt-24">
          <div>
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/[0.07] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-200/90">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-300" />
              Point-in-time assessment · 29 Aug 2026
            </div>
            <h1 className="max-w-4xl font-display text-5xl font-semibold leading-[0.98] tracking-[-0.055em] text-white sm:text-6xl lg:text-[5.5rem]">
              Find the gap<br />
              <span className="text-emerald-300">before it ships.</span>
            </h1>
            <p className="mt-8 max-w-2xl text-base leading-7 text-white/55 sm:text-lg">
              A focused security and issue review of <span className="font-medium text-white/85">TasadaqAli/JohnnyAI</span> — separating confirmed repository controls from design risks that need to be resolved before implementation.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#findings" className="group inline-flex items-center gap-2 rounded-xl bg-emerald-300 px-4 py-3 text-sm font-semibold text-[#08110f] transition-all duration-200 hover:-translate-y-0.5 hover:bg-emerald-200 active:scale-[0.98]">
                Explore findings <ArrowDownRight className="size-4 transition-transform group-hover:translate-y-0.5" />
              </a>
              <a href="https://github.com/TasadaqAli/JohnnyAI" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-3 text-sm font-medium text-white/80 transition-all duration-200 hover:border-white/30 hover:bg-white/[0.05] active:scale-[0.98]">
                <Github className="size-4" /> View source
              </a>
            </div>
          </div>
          <div className="relative lg:pb-1">
            <div className="absolute -inset-5 rounded-[2rem] bg-emerald-300/[0.04] blur-2xl" />
            <div className="relative rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/20 backdrop-blur-sm sm:p-6">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Assessment pulse</span>
                <span className="flex items-center gap-1.5 font-mono text-[10px] text-emerald-300"><span className="size-1.5 rounded-full bg-emerald-300" /> LIVE SNAPSHOT</span>
              </div>
              <div className="grid grid-cols-2 gap-5 py-6">
                <div><span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">Open issues</span><p className="mt-2 font-display text-4xl text-white">00</p></div>
                <div><span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">Open PRs</span><p className="mt-2 font-display text-4xl text-white">00</p></div>
                <div><span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">Tracked files</span><p className="mt-2 font-display text-4xl text-white">01</p></div>
                <div><span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">Findings</span><p className="mt-2 font-display text-4xl text-amber-200">08</p></div>
              </div>
              <div className="flex items-center gap-3 border-t border-white/10 pt-4 text-xs text-white/50">
                <FileCheck2 className="size-4 text-emerald-300" /> Audited revision <button onClick={copyCommit} className="group inline-flex items-center gap-1 font-mono text-[10px] text-white/80 hover:text-emerald-200" title="Copy audited commit">9c3a190 <Clipboard className="size-3 opacity-50 group-hover:opacity-100" />{copied && <span className="font-sans text-emerald-300">copied</span>}</button>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-3 border-y border-white/10 py-5 sm:grid-cols-2 lg:grid-cols-4">
          {([
            ["Critical", severityCount("Critical"), "Immediate action", "rose"],
            ["High", severityCount("High"), "Control gap", "orange"],
            ["Medium", severityCount("Medium"), "Design risk", "amber"],
            ["Low", severityCount("Low"), "Documentation", "sky"],
          ] as const).map(([label, count, detail, color]) => (
            <button key={label} onClick={() => { setFilter(label); document.querySelector("#findings")?.scrollIntoView({ behavior: "smooth" }); }} className="group flex items-center justify-between rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/[0.04]">
              <span className="flex items-center gap-3"><span className={`size-2 rounded-full bg-${color}-300`} /><span><span className="block text-sm font-medium text-white/80">{label}</span><span className="font-mono text-[10px] uppercase tracking-wider text-white/35">{detail}</span></span></span>
              <span className="font-display text-2xl text-white/80 transition-transform group-hover:translate-x-1">0{count}</span>
            </button>
          ))}
        </section>

        <section id="findings" className="scroll-mt-24 pt-24">
          <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-300"><ScanSearch className="size-3.5" /> Signal review</div>
              <h2 className="font-display text-4xl tracking-[-0.04em] text-white sm:text-5xl">Findings, without the noise.</h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-white/45">Eight signals across account security, repository controls, and future system design. Expand a row for evidence and the next move.</p>
            </div>
            <div className="flex flex-wrap gap-1 rounded-xl border border-white/10 bg-white/[0.035] p-1">
              {(["All", "Critical", "High", "Medium", "Low"] as Filter[]).map(item => (
                <button key={item} onClick={() => setFilter(item)} className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${filter === item ? "bg-white text-[#08110f]" : "text-white/45 hover:text-white"}`}>{item}{item !== "All" && <span className="ml-1.5 font-mono text-[10px] opacity-60">{severityCount(item)}</span>}</button>
              ))}
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">
            {visibleFindings.map((finding, index) => {
              const isOpen = expanded === finding.id;
              return (
                <article key={finding.id} className={`border-b border-white/10 last:border-0 ${isOpen ? "bg-white/[0.035]" : ""}`}>
                  <button onClick={() => setExpanded(isOpen ? null : finding.id)} className="flex w-full items-center gap-4 px-4 py-5 text-left transition-colors hover:bg-white/[0.035] sm:px-6">
                    <span className="hidden w-7 font-mono text-[10px] text-white/25 sm:block">0{index + 1}</span>
                    <span className={`hidden rounded-md border px-2 py-1 font-mono text-[9px] uppercase tracking-wider sm:block ${severityStyles[finding.severity]}`}>{finding.severity}</span>
                    <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className={`size-1.5 shrink-0 rounded-full ${severityDot[finding.severity]} sm:hidden`} /><span className="truncate font-medium text-white/90">{finding.title}</span></span><span className="mt-1 block truncate text-xs text-white/40">{finding.status}</span></span>
                    <span className="hidden max-w-xs text-right text-xs leading-5 text-white/35 lg:block">{finding.summary}</span>
                    <ChevronDown className={`size-4 shrink-0 text-white/35 transition-transform duration-200 ${isOpen ? "rotate-180 text-white" : ""}`} />
                  </button>
                  {isOpen && (
                    <div className="grid gap-6 px-4 pb-6 sm:grid-cols-[0.8fr_1.2fr] sm:px-16">
                      <div><span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">Evidence</span><p className="mt-2 text-sm leading-6 text-white/60">{finding.evidence}</p></div>
                      <div className="rounded-xl border border-emerald-300/15 bg-emerald-300/[0.05] p-4"><span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-300"><ArrowUpRight className="size-3.5" /> Next move</span><p className="mt-2 text-sm leading-6 text-white/70">{finding.recommendation}</p></div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <section id="remediation" className="scroll-mt-24 grid gap-10 pt-28 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-300"><Zap className="size-3.5" /> The way forward</div>
            <h2 className="font-display text-4xl tracking-[-0.04em] text-white sm:text-5xl">Make the next commit safer.</h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-white/45">A short, ordered path from exposed credential to implementation-ready foundation.</p>
            <div className="mt-8 rounded-2xl border border-rose-300/20 bg-rose-400/[0.06] p-5"><div className="flex items-start gap-3"><ShieldAlert className="mt-0.5 size-5 shrink-0 text-rose-300" /><div><p className="text-sm font-semibold text-rose-100">First: revoke exposed credentials</p><p className="mt-1 text-xs leading-5 text-rose-100/55">Do not paste replacement tokens into chat, issues, screenshots, or source control.</p></div></div></div>
          </div>
          <div className="relative pl-6 sm:pl-10">
            <div className="absolute bottom-4 left-[9px] top-4 w-px bg-gradient-to-b from-emerald-300/80 via-emerald-300/30 to-transparent sm:left-[17px]" />
            {[
              ["01", "Contain", "Revoke the exposed GitHub PAT and review account and token activity."],
              ["02", "Harden the repo", "Add SECURITY.md, a real license file, .gitignore, and a safe environment-variable policy."],
              ["03", "Automate trust", "Enable Dependabot and add secret scanning, SAST, tests, and least-privilege CI."],
              ["04", "Design the boundary", "Define authorization, approvals, sandboxing, privacy, and tenant isolation before autonomous actions."],
            ].map(([number, title, copy], index) => (
              <div key={number} className="relative mb-7 flex gap-5 last:mb-0 sm:gap-7"><span className="relative z-10 grid size-5 shrink-0 place-items-center rounded-full border border-emerald-300/60 bg-[#08110f] text-[9px] font-bold text-emerald-300 sm:size-9 sm:text-[10px]">{index === 0 ? <CircleAlert className="size-3.5 sm:size-4" /> : number}</span><div className="pb-1"><p className="font-display text-xl text-white">{title}</p><p className="mt-1 max-w-lg text-sm leading-6 text-white/45">{copy}</p></div></div>
            ))}
          </div>
        </section>

        <section className="mt-28 grid gap-4 sm:grid-cols-3">
          {[
            [<LockKeyhole className="size-5" />, "No secrets found", "Pattern scan across reachable history returned no common credential matches."],
            [<CircleCheck className="size-5" />, "0 open issues", "No unresolved GitHub issues or pull requests were found at audit time."],
            [<Radar className="size-5" />, "Scope is explicit", "No runtime claims: this was a point-in-time review of a documentation-only tree."],
          ].map(([icon, title, copy]) => <div key={title as string} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-emerald-300/20 hover:bg-white/[0.045]"><span className="text-emerald-300">{icon}</span><p className="mt-5 font-medium text-white/85">{title}</p><p className="mt-2 text-xs leading-5 text-white/40">{copy}</p></div>)}
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/10 bg-black/10">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-5 py-8 text-xs text-white/35 sm:flex-row sm:items-center sm:justify-between lg:px-10"><span>Security audit · JohnnyAI · 29 Aug 2026</span><span className="flex items-center gap-2 font-mono text-[10px]"><Sparkles className="size-3 text-emerald-300" /> Evidence first. Ship deliberately.</span></div>
      </footer>
    </div>
  );
}
