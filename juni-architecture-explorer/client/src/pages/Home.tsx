import { useMemo, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  Box,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleAlert,
  Code2,
  Command,
  Database,
  ExternalLink,
  Eye,
  FileCode2,
  Fingerprint,
  Gauge,
  GitBranch,
  Globe2,
  Layers3,
  LockKeyhole,
  Menu,
  MessageSquareText,
  Network,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  TimerReset,
  Wrench,
  X,
  Zap,
} from "lucide-react";

type CapabilityStatus = "COMPLETE" | "IMPLEMENTED" | "PARTIAL" | "NOT IMPLEMENTED";

type Capability = {
  name: string;
  status: CapabilityStatus;
  boundary: string;
  tone: "cyan" | "violet" | "amber" | "slate";
};

const capabilities: Capability[] = [
  { name: "SMART_GENERAL", status: "COMPLETE", boundary: "Forge LLM adapter", tone: "cyan" },
  { name: "VISION", status: "IMPLEMENTED", boundary: "OpenAI Responses · input_image / input_file", tone: "violet" },
  { name: "EMBEDDING", status: "IMPLEMENTED", boundary: "OpenAI embeddings · text-embedding-3-small", tone: "cyan" },
  { name: "VOICE_REALTIME", status: "PARTIAL", boundary: "OpenAI Realtime WebRTC · separate path", tone: "amber" },
  { name: "FAST_GENERAL", status: "NOT IMPLEMENTED", boundary: "No adapter", tone: "slate" },
  { name: "VIDEO", status: "NOT IMPLEMENTED", boundary: "No video provider pipeline", tone: "slate" },
  { name: "RESEARCH", status: "NOT IMPLEMENTED", boundary: "No research tool layer", tone: "slate" },
  { name: "CODE", status: "NOT IMPLEMENTED", boundary: "No code capability adapter", tone: "slate" },
];

const sections = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "orchestrator", label: "Orchestrator", icon: Network },
  { id: "capabilities", label: "Capabilities", icon: Zap },
  { id: "boundaries", label: "Trust boundaries", icon: ShieldCheck },
  { id: "tools", label: "Tool registry", icon: Wrench },
  { id: "semantic", label: "Semantic substrate", icon: Database },
  { id: "roadmap", label: "Deferred roadmap", icon: TimerReset },
];

const statusStyles: Record<CapabilityStatus, string> = {
  COMPLETE: "status-complete",
  IMPLEMENTED: "status-implemented",
  PARTIAL: "status-partial",
  "NOT IMPLEMENTED": "status-muted",
};

function SectionKicker({ children }: { children: React.ReactNode }) {
  return <div className="section-kicker"><span className="kicker-line" />{children}</div>;
}

function StatusPill({ status }: { status: CapabilityStatus }) {
  return <span className={`status-pill ${statusStyles[status]}`}><span className="status-dot" />{status}</span>;
}

function FlowNode({ icon: Icon, title, detail, accent = "cyan" }: { icon: typeof Box; title: string; detail: string; accent?: string }) {
  return <div className={`flow-node flow-${accent}`}><div className="flow-icon"><Icon size={17} /></div><div><strong>{title}</strong><span>{detail}</span></div></div>;
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [selectedCapability, setSelectedCapability] = useState<string | null>(null);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleCapabilities = useMemo(() => capabilities.filter(item => [item.name, item.status, item.boundary].join(" ").toLowerCase().includes(normalizedQuery)), [normalizedQuery]);

  const jumpTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setMobileNavOpen(false);
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><span>J</span><i /></div>
          <div><div className="brand-name">JUNI <em>AI</em></div><div className="brand-caption">ARCHITECTURE RECORD</div></div>
          <button className="mobile-close" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>
        <div className="sidebar-rule" />
        <div className="side-label">DOCUMENT MAP</div>
        <nav className="side-nav">
          {sections.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => jumpTo(id)}><Icon size={16} /><span>{label}</span><ChevronRight size={13} className="nav-arrow" /></button>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="live-chip"><span className="live-dot" />SYSTEM RECORD <span className="live-separator" /> v1.4</div>
          <div className="side-note">A server-first assistant platform.<br />Documented as it exists.</div>
          <div className="side-links"><a href="https://github.com/Mr-Tasadaq/JUNI-AI" target="_blank" rel="noreferrer">Repository <ExternalLink size={12} /></a><span>·</span><a href="#roadmap">Roadmap</a></div>
        </div>
      </aside>
      <div className="mobile-overlay" onClick={() => setMobileNavOpen(false)} />

      <main className="main-canvas">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Menu size={19} /></button>
          <div className="crumb"><span className="crumb-dim">JUNI AI</span><ChevronRight size={14} /><span>Architecture record</span></div>
          <div className="topbar-actions">
            <div className="search-wrap"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search record" aria-label="Search architecture record" /><kbd>⌘ K</kbd></div>
            <div className="topbar-version">2026.09 <span className="version-dot" /></div>
          </div>
        </header>

        <div className="content-wrap">
          <section className="hero-section" id="overview">
            <div className="hero-copy">
              <div className="eyebrow"><span className="eyebrow-pulse" /> PLATFORM BLUEPRINT <span className="eyebrow-slash">/</span> LIVE RECORD</div>
              <h1>How JUNI <span>thinks,</span><br />routes &amp; stays safe.</h1>
              <p className="hero-lede">A server-first architecture for conversational intelligence — designed with explicit provider boundaries, durable context, and no accidental autonomy.</p>
              <div className="hero-actions"><button className="primary-cta" onClick={() => jumpTo("orchestrator")}>Explore the system <ArrowDown size={16} /></button><button className="text-cta" onClick={() => jumpTo("capabilities")}>View capability matrix <ArrowRight size={15} /></button></div>
            </div>
            <div className="hero-visual" aria-label="Platform status visualization">
              <div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit-core"><div className="core-glow" /><BrainCircuit size={31} /><span>JUNI<br /><small>CORE</small></span></div>
              <div className="orbit-label orbit-label-top"><span className="label-pip cyan-pip" />SERVER AUTHORITY</div>
              <div className="orbit-label orbit-label-right"><span className="label-pip violet-pip" />PROVIDER NEUTRAL</div>
              <div className="orbit-label orbit-label-bottom"><span className="label-pip amber-pip" />EXPLICIT LIMITS</div>
              <svg className="hero-connector" viewBox="0 0 430 370" fill="none"><path d="M213 45V8M340 185h82M213 325v36" stroke="currentColor" strokeDasharray="3 7" /><circle cx="213" cy="8" r="3" fill="#74e5e3" /><circle cx="422" cy="185" r="3" fill="#a78bfa" /><circle cx="213" cy="361" r="3" fill="#f0b45a" /></svg>
            </div>
            <div className="hero-meta-row"><span><Check size={13} /> Authenticated boundary</span><span><Check size={13} /> 8 capability aliases</span><span><Check size={13} /> No autonomous loop</span></div>
          </section>

          <section className="stats-grid" aria-label="Architecture summary">
            <div className="stat-card"><div className="stat-icon stat-cyan"><Layers3 size={17} /></div><div><strong>02</strong><span>controlled identities</span></div><small>JUNI + SONA</small></div>
            <div className="stat-card"><div className="stat-icon stat-violet"><Network size={17} /></div><div><strong>03</strong><span>active text paths</span></div><small>ROUTED, NOT HARD-CODED</small></div>
            <div className="stat-card"><div className="stat-icon stat-amber"><LockKeyhole size={17} /></div><div><strong>06</strong><span>trust categories</span></div><small>DATA ≠ AUTHORITY</small></div>
            <div className="stat-card stat-card-alert"><div className="stat-icon stat-slate"><CircleAlert size={17} /></div><div><strong>08</strong><span>deferred capabilities</span></div><small>TRUTHFUL BY DESIGN</small></div>
          </section>

          <section className="section-block" id="orchestrator">
            <SectionKicker>01 / CENTRAL ORCHESTRATOR</SectionKicker>
            <div className="section-heading-row"><div><h2>One boundary.<br /><i>Clear decisions.</i></h2></div><p className="section-intro">The orchestrator is the small, typed seam between authenticated intent and capability execution. It decides what is possible, assembles only supplied context, and returns a normalized result — never an autonomous action.</p></div>
            <div className="flow-diagram">
              <div className="flow-column"><div className="flow-column-label">INPUT</div><FlowNode icon={MessageSquareText} title="User input" detail="authenticated request" accent="cyan" /><FlowNode icon={Fingerprint} title="Server identity" detail="ctx.user · trusted" accent="violet" /></div>
              <div className="flow-arrow"><ArrowRight size={18} /><span>orchestrate()</span></div>
              <div className="flow-column flow-main"><div className="flow-column-label">DECISION LAYER</div><FlowNode icon={Layers3} title="Context assembly" detail="typed data categories" accent="cyan" /><FlowNode icon={GitBranch} title="Capability selection" detail="registry resolution" accent="violet" /><FlowNode icon={ShieldCheck} title="Policy + trust" detail="tools inspected, not run" accent="amber" /></div>
              <div className="flow-arrow"><ArrowRight size={18} /><span>normalized</span></div>
              <div className="flow-column"><div className="flow-column-label">OUTPUT</div><FlowNode icon={Server} title="Capability / tool" detail="server-only boundary" accent="cyan" /><div className="flow-result"><span className="result-dot" />RESULT_READY</div></div>
            </div>
            <div className="callout callout-cyan"><ShieldCheck size={18} /><div><strong>The governing rule</strong><p>Only <code>SYSTEM_INSTRUCTIONS</code> are authoritative system policy. Memory, retrieved text, uploads, external content, and tool results are data — they cannot silently become permissions or tool definitions.</p></div></div>
          </section>

          <section className="section-block" id="capabilities">
            <SectionKicker>02 / CAPABILITY REGISTRY</SectionKicker>
            <div className="section-heading-row"><div><h2>Truthful routing,<br /><i>not wishful thinking.</i></h2></div><p className="section-intro">The registry exposes a capability vocabulary and chooses adapters deterministically. Unsupported means unsupported — no fake providers, no universal model, no hidden fallback.</p></div>
            <div className="capability-shell">
              <div className="capability-table-head"><span>CAPABILITY</span><span>STATUS</span><span>SERVER BOUNDARY</span><span>DETAIL</span></div>
              {visibleCapabilities.map((item, index) => <button key={item.name} className={`capability-row ${selectedCapability === item.name ? "capability-row-selected" : ""}`} onClick={() => setSelectedCapability(selectedCapability === item.name ? null : item.name)}><span className="capability-name"><span className={`capability-glyph glyph-${item.tone}`}><Zap size={13} /></span>{item.name}</span><StatusPill status={item.status} /><span className="capability-boundary">{item.boundary}</span><span className="row-detail">{selectedCapability === item.name ? "Selected — inspect architecture notes" : <ChevronRight size={15} />}</span></button>)}
              {!visibleCapabilities.length && <div className="no-results"><Search size={18} />No capability matches “{query}”.</div>}
            </div>
            <div className="capability-foot"><span><span className="legend-dot legend-live" />Available when configured</span><span><span className="legend-dot legend-partial" />Separate / partial path</span><span><span className="legend-dot legend-deferred" />Not implemented</span><span className="foot-note">{query ? `${visibleCapabilities.length} matches` : "Click a row to focus"}</span></div>
          </section>

          <section className="section-block" id="boundaries">
            <SectionKicker>03 / SHARED PLATFORM BOUNDARIES</SectionKicker>
            <div className="boundary-grid">
              <div className="boundary-main"><h2>Safety is a <i>shape.</i></h2><p>Authentication, authorization, persona configuration, realtime orchestration, safe tools, file analysis, provider credentials, and security policy are shared platform concerns. JUNI and SONA are controlled identities inside one authenticated platform.</p><div className="persona-cards"><div className="persona persona-juni"><div className="persona-orb">J</div><div><strong>JUNI AI</strong><span>cedar · male voice</span><p>Confident, calm, clever, supportive.</p></div></div><div className="persona persona-sona"><div className="persona-orb">S</div><div><strong>SONA AI</strong><span>marin · female voice</span><p>Warm, playful, expressive, witty.</p></div></div></div></div>
              <div className="boundary-stack"><div className="boundary-card"><Fingerprint size={17} /><div><strong>Identity is server-derived</strong><span>Browser state cannot choose owner, role, or credentials.</span></div></div><div className="boundary-card"><Eye size={17} /><div><strong>Uploads stay ephemeral</strong><span>Analysis returns safe text only; binaries are not persisted.</span></div></div><div className="boundary-card"><TerminalSquare size={17} /><div><strong>Providers stay behind adapters</strong><span>Orchestration never calls vendor transports directly.</span></div></div></div>
            </div>
          </section>

          <section className="section-block" id="tools">
            <SectionKicker>04 / SECURE TOOL REGISTRY</SectionKicker>
            <div className="section-heading-row"><div><h2>Tools are <i>registered,</i><br />not unleashed.</h2></div><p className="section-intro">The registry uses closed-world names, strict schemas, authenticated execution, and explicit risk levels. The orchestrator can inspect metadata; it cannot call a tool because a model or user mentioned it.</p></div>
            <div className="tool-layout"><div className="tool-pipeline"><div className="pipeline-label">EXECUTION PIPELINE</div><div className="pipeline-row"><div className="pipeline-box"><Network size={16} />orchestrator</div><ArrowRight size={15} /><div className="pipeline-box"><LockKeyhole size={16} />policy / auth</div><ArrowRight size={15} /><div className="pipeline-box"><Wrench size={16} />tool adapter</div><ArrowRight size={15} /><div className="pipeline-box pipeline-box-muted"><Globe2 size={16} />external service</div></div><div className="tool-cards"><div className="tool-card"><div className="tool-card-top"><span className="tool-icon"><Activity size={15} /></span><code>weather.lookup</code><StatusPill status="IMPLEMENTED" /></div><p>Current conditions for validated geographic coordinates. Read-only, authenticated, confirmation-free.</p><div className="tool-tags"><span>READ_ONLY</span><span>GOOGLE WEATHER</span></div></div><div className="tool-card"><div className="tool-card-top"><span className="tool-icon tool-icon-violet"><Box size={15} /></span><code>device.status</code><StatusPill status="PARTIAL" /></div><p>Deterministic placeholder status for the JUNI server. No device contact in this slice.</p><div className="tool-tags"><span>READ_ONLY</span><span>FIXTURE</span></div></div></div></div><div className="tool-policy"><div className="policy-title"><ShieldCheck size={17} /> POLICY CONTRACT</div><div className="risk-list"><div><span className="risk-index">01</span><strong>read_only</strong><span>no confirmation</span></div><div><span className="risk-index">02</span><strong>external_side_effect</strong><span>confirmation required</span></div><div><span className="risk-index">03</span><strong>sensitive_action</strong><span>confirmation required</span></div></div><div className="policy-note"><CircleAlert size={15} /><span>Tool results are <strong>untrusted external data</strong>. They cannot change policy, persona, or authorization.</span></div></div></div>
          </section>

          <section className="section-block" id="semantic">
            <SectionKicker>05 / SEMANTIC INDEX SUBSTRATE</SectionKicker>
            <div className="semantic-header"><div><h2>Useful memory,<br /><i>without pretending.</i></h2><p className="section-intro">The semantic index is a rebuildable derived representation of canonical sources — not a long-term memory system and not the source of truth.</p></div><div className="semantic-badge"><Database size={19} /><span><strong>PATH B</strong><small>INTERIM COMPATIBILITY LAYER</small></span></div></div>
            <div className="semantic-grid"><div className="semantic-visual"><div className="db-ring ring-a" /><div className="db-ring ring-b" /><div className="db-core"><Database size={22} /><span>semantic<br /><b>chunks</b></span></div><div className="db-label db-label-1">OWNER-SCOPED</div><div className="db-label db-label-2">COSINE DISTANCE</div><div className="db-label db-label-3">REBUILDABLE</div></div><div className="semantic-facts"><div><strong>4,000</strong><span>max chars / chunk</span></div><div><strong>64</strong><span>max chunks / source</span></div><div><strong>20</strong><span>max retrieval results</span></div><div><strong>∞</strong><span>no lossy rounding</span></div></div></div>
            <div className="semantic-note"><Check size={16} /><p>Canonical content is loaded and embedded before replacement begins. If the provider fails, existing semantic rows stay intact.</p></div>
          </section>

          <section className="section-block roadmap-section" id="roadmap">
            <SectionKicker>06 / DEFERRED ROADMAP</SectionKicker>
            <div className="roadmap-heading"><div><h2>What JUNI <i>doesn’t</i><br />do yet.</h2></div><span>Explicit limits are part of the architecture.</span></div>
            <div className="roadmap-grid">{["Autonomous agent loop", "Automatic tool execution", "Long-term memory formation", "Automatic semantic retrieval", "RAG prompt assembly", "Research engine", "Browser automation", "Scheduling + messaging"].map((item, i) => <div className="roadmap-item" key={item}><span>{String(i + 1).padStart(2, "0")}</span><span>{item}</span><CircleAlert size={14} /></div>)}</div>
            <div className="final-statement"><Sparkles size={18} /><p><strong>Designed to be extended.</strong> The architecture records what exists today so the next capability can be added deliberately, behind a boundary that can be tested.</p><button onClick={() => jumpTo("overview")} aria-label="Back to top"><ArrowDown size={16} /></button></div>
          </section>
          <footer className="site-footer"><span>JUNI AI · ARCHITECTURE RECORD</span><span>SERVER-FIRST / PROVIDER-NEUTRAL / EXPLICITLY BOUNDED</span><span>2026.09</span></footer>
        </div>
      </main>
    </div>
  );
}
