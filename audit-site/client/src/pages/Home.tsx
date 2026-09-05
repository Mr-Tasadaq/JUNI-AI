import {
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  ChevronDown,
  CircleCheck,
  ClipboardList,
  Code2,
  Database,
  ExternalLink,
  Gauge,
  GitBranch,
  LockKeyhole,
  Menu,
  Network,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import { useState } from "react";

const sections = [
  { id: "readout", label: "Executive readout", index: "01" },
  { id: "map", label: "Boundary map", index: "02" },
  { id: "modules", label: "Active modules", index: "03" },
  { id: "findings", label: "Findings", index: "04" },
  { id: "next", label: "Next slice", index: "05" },
];

const modules = [
  {
    name: "routers.ts",
    role: "Transport + business logic",
    tag: "ROUTER-HEAVY",
    tone: "orange",
    icon: Network,
    detail:
      "Owns tRPC transport, Zod inputs, protected/admin middleware selection, Realtime session construction, file analysis, and account previews.",
  },
  {
    name: "orchestration.ts",
    role: "AI orchestration",
    tag: "SECURITY LOGIC",
    tone: "blue",
    icon: Sparkles,
    detail:
      "Builds system, history, and user messages; wraps untrusted context; invokes the LLM; and extracts provider responses.",
  },
  {
    name: "db.ts",
    role: "Identity repository",
    tag: "DB + DECISIONS",
    tone: "olive",
    icon: Database,
    detail:
      "Lazily creates the Drizzle MySQL client, upserts and reads users, promotes the owner, and updates sign-in timestamps.",
  },
  {
    name: "_core/",
    role: "Auth + provider helpers",
    tag: "BOUNDARY LAYER",
    tone: "black",
    icon: ShieldCheck,
    detail:
      "Contains auth context, OAuth, JWT verification, LLM, image, storage, notification, heartbeat, map, and transcription helpers.",
  },
];

const findings = [
  {
    id: "F-01",
    severity: "HIGH",
    title: "Router-coupled domain decisions",
    body: "Validation, authorization, provider payloads, and response shaping still live together in server/routers.ts. This is workable for the current surface, but it makes extraction into independently testable services harder.",
    action: "Extract one boundary at a time, starting with Realtime session construction.",
  },
  {
    id: "F-02",
    severity: "MEDIUM",
    title: "Provider contracts leak into the application surface",
    body: "OpenAI Realtime and Responses API shapes appear directly in router and client-adjacent flows. The permanent key remains server-side, but the provider boundary is not yet a replaceable seam.",
    action: "Introduce provider-neutral request and result contracts before adding new providers.",
  },
  {
    id: "F-03",
    severity: "MEDIUM",
    title: "Apparent domains are not active services",
    body: "Conversation, memory, research, task, account, and file services do not exist as active domain modules. Some appear in migration history or shared contracts only.",
    action: "Treat them as future contracts, not implemented capabilities.",
  },
  {
    id: "F-04",
    severity: "LOW",
    title: "Error policy is distributed",
    body: "HttpError, TRPCError, direct Error, and provider-specific mapping coexist. The system works, but public error behavior is not yet one documented contract.",
    action: "Normalize errors at the API boundary after service seams are established.",
  },
];

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFinding, setOpenFinding] = useState<string | null>("F-01");

  return (
    <div className="audit-app">
      <div className="grain" aria-hidden="true" />
      <header className="mobile-header">
        <a className="brand" href="#readout" onClick={() => setMenuOpen(false)}>
          <span className="brand-mark"><span>J</span><b>09</b></span>
          <span className="brand-name">JUNI / audit</span>
        </a>
        <button className="menu-button" aria-label="Toggle menu" onClick={() => setMenuOpen(value => !value)}>
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>

      <aside className={`rail ${menuOpen ? "rail-open" : ""}`}>
        <div className="rail-top">
          <a className="brand" href="#readout" onClick={() => setMenuOpen(false)}>
            <span className="brand-mark"><span>J</span><b>09</b></span>
            <span className="brand-name">JUNI / audit</span>
          </a>
          <div className="rail-stamp">STEP 09<br /><span>SERVICE LAYER</span></div>
        </div>
        <nav className="rail-nav" aria-label="Report sections">
          <p className="eyebrow">Report index</p>
          {sections.map(section => (
            <button key={section.id} onClick={() => { scrollToSection(section.id); setMenuOpen(false); }}>
              <span>{section.index}</span>{section.label}<ArrowUpRight size={13} />
            </button>
          ))}
        </nav>
        <div className="rail-bottom">
          <div className="rail-status"><span className="status-dot" /> AUDIT COMPLETE</div>
          <p>Read-only audit of actual server business logic and service boundaries.</p>
          <div className="rail-footer"><span>JUNI-AI</span><span>2026.09</span></div>
        </div>
      </aside>

      <main className="content">
        <section className="hero" id="readout">
          <div className="hero-copy">
            <div className="hero-index" aria-hidden="true"><span>09</span><small>FIELD<br />MANUAL</small></div>
            <p className="kicker"><span className="kicker-line" /> Service layer / architecture audit</p>
            <h1>The active domain is smaller than the repository suggests.</h1>
            <p className="hero-lede">A field guide to where JUNI-AI actually makes decisions today—and where the architecture is still a set of promising contracts.</p>
            <div className="hero-meta">
              <span><ClipboardList size={15} /> READ-ONLY / STEP 09</span>
              <span><CircleCheck size={15} /> NO ROUTER REWRITE</span>
              <span><LockKeyhole size={15} /> SERVER BOUNDARIES INTACT</span>
            </div>
            <button className="text-link" onClick={() => scrollToSection("map")}>Trace the service boundary <ArrowDownRight size={16} /></button>
          </div>
          <div className="hero-art" role="img" aria-label="Abstract paper dossier illustration">
            <img src="/manus-storage/evidence-ledger-cover_2f51a66a.png" alt="" />
            <div className="hero-art-caption"><span>FIG. 09A</span><span>BOUNDARY / 2026</span></div>
          </div>
        </section>

        <section className="signal-strip" aria-label="Audit summary">
          <div><span className="signal-number">18</span><span className="signal-label">server modules<br /><b>mapped</b></span></div>
          <div><span className="signal-number">06</span><span className="signal-label">active domain<br /><b>surfaces</b></span></div>
          <div><span className="signal-number">00</span><span className="signal-label">standalone future<br /><b>services</b></span></div>
          <div className="signal-note"><Gauge size={18} /><span><b>Conclusion</b><br />Business decisions are concentrated, not distributed.</span></div>
        </section>

        <section className="section-block intro-block" id="map">
          <div className="section-heading">
            <p className="eyebrow">02 / Boundary map</p>
            <h2>Trace the boundary before you add the service.</h2>
            <p>The current runtime is a narrow, legible path: transport selects the rule, context resolves identity, routers perform most domain work, and provider helpers carry side effects.</p>
          </div>
          <div className="boundary-card">
            <div className="boundary-top"><span>EVIDENCE / MAP-02</span><span>ACTIVE REQUEST PATH · SERVER ONLY / EXCEPT WEBRTC NEGOTIATION</span></div>
            <div className="boundary-map">
              {[
                { num: "01", title: "Transport", desc: "tRPC / Express", icon: Terminal },
                { num: "02", title: "Identity", desc: "ctx.user", icon: LockKeyhole },
                { num: "03", title: "Domain", desc: "routers.ts", icon: Code2 },
                { num: "04", title: "Provider", desc: "OpenAI / Forge", icon: Sparkles },
                { num: "05", title: "Storage", desc: "Drizzle / S3", icon: Database },
                { num: "06", title: "Schedule", desc: "heartbeat.ts", icon: GitBranch },
              ].map(({ num, title, desc, icon: NodeIcon }, index) => (
                <div className="map-node-wrap" key={num}>
                  <div className={`map-node node-${index}`}><span>{num}</span><NodeIcon size={18} /><strong>{title}</strong><small>{desc}</small></div>
                  {index < 5 && <div className="map-connector"><ArrowUpRight size={14} /></div>}
                </div>
              ))}
            </div>
            <div className="boundary-foot"><span>AUTHORITY FLOWS LEFT → RIGHT</span><span>PROVIDER CREDENTIALS NEVER ENTER THE BROWSER</span></div>
          </div>
          <div className="quote-block"><span className="quote-mark">“</span><p>Several apparent domains exist only in migration history or shared contracts and do not yet have active services.</p><cite>— current conclusion / service-layer audit</cite></div>
        </section>

        <section className="section-block" id="modules">
          <div className="section-heading split-heading">
            <div><p className="eyebrow">03 / Existing server modules</p><h2>Four centers of gravity.</h2></div>
            <p>The audit found a compact active domain surface. The rest of the repository is scaffolding, provider support, or future intent.</p>
          </div>
          <div className="module-grid">
            {modules.map(module => { const Icon = module.icon; return <article className={`module-card tone-${module.tone}`} key={module.name}>
              <div className="module-card-top"><Icon size={19} /><span>EVIDENCE / {module.tag}</span></div>
              <h3>{module.name}</h3><p className="module-role">{module.role}</p><p className="module-detail">{module.detail}</p>
              <div className="module-arrow"><ArrowUpRight size={15} /></div>
            </article>; })}
          </div>
        </section>

        <section className="section-block findings-section" id="findings">
          <div className="section-heading split-heading">
            <div><p className="eyebrow">04 / Findings register · EVIDENCE LOG</p><h2>What the audit can say with confidence.</h2></div>
            <div className="legend"><span><i className="legend-high" /> high attention</span><span><i className="legend-med" /> structural</span><span><i className="legend-low" /> hygiene</span></div>
          </div>
          <div className="finding-list">
            {findings.map(finding => <div className={`finding ${openFinding === finding.id ? "finding-open" : ""}`} key={finding.id}>
              <button className="finding-trigger" onClick={() => setOpenFinding(openFinding === finding.id ? null : finding.id)}>
                <span className="finding-id">{finding.id}</span><span className={`severity severity-${finding.severity.toLowerCase()}`}>{finding.severity}</span><strong>{finding.title}</strong><ChevronDown size={18} />
              </button>
              {openFinding === finding.id && <div className="finding-detail"><p>{finding.body}</p><div><span>NEXT MOVE</span><b>{finding.action}</b></div></div>}
            </div>)}
          </div>
        </section>

        <section className="section-block next-section" id="next">
          <div className="next-panel">
            <div><p className="eyebrow">05 / Next slice · DECISION LOG</p><h2>One auditable seam at a time.</h2><p>The recommendation is not a rewrite. Establish provider-neutral contracts, extract the highest-churn router paths, and only then promote future domains into real services.</p></div>
            <div className="next-list"><div><span>01</span><b>Extract Realtime session construction</b><small>Highest coupling / clear boundary</small></div><div><span>02</span><b>Normalize public errors</b><small>One contract at the API edge</small></div><div><span>03</span><b>Keep future domains honest</b><small>Contract is not capability</small></div></div>
          </div>
        </section>

        <footer className="site-footer"><span>JUNI-AI / SERVICE LAYER AUDIT</span><span>READ-ONLY · 2026</span><a href="https://github.com/Mr-Tasadaq/JUNI-AI" target="_blank" rel="noreferrer">SOURCE REPOSITORY <ExternalLink size={13} /></a></footer>
      </main>
    </div>
  );
}
