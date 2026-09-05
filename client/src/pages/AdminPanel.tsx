import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  Database,
  Gauge,
  LockKeyhole,
  Mic2,
  Radio,
  ShieldAlert,
  Sparkles,
  Users,
  XCircle,
} from "lucide-react";

function StatePill({ ok, children }: { ok: boolean; children: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${ok ? "bg-emerald-300/10 text-emerald-200" : "bg-amber-300/10 text-amber-200"}`}
    >
      {ok ? (
        <CheckCircle2 className="size-3" />
      ) : (
        <XCircle className="size-3" />
      )}
      {children}
    </span>
  );
}

export default function AdminPanel() {
  const { user, loading } = useAuth();
  const isAdmin = user?.role === "admin";
  const dashboardQuery = trpc.admin.dashboard.useQuery(undefined, {
    enabled: isAdmin,
    retry: false,
  });

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#080b13] text-white/60">
        Loading secure control center…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#080b13] p-6 text-center text-white">
        <div>
          <LockKeyhole className="mx-auto mb-4 size-10 text-emerald-300" />
          <h1 className="font-display text-3xl font-semibold">
            Admin access requires sign-in
          </h1>
          <p className="mt-2 text-sm text-white/45">
            The server will verify your role after authentication.
          </p>
          <button
            onClick={startLogin}
            className="mt-6 rounded-xl bg-emerald-300 px-5 py-3 text-sm font-semibold text-[#080b13]"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#080b13] p-6 text-center text-white">
        <div>
          <ShieldAlert className="mx-auto mb-4 size-10 text-rose-300" />
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-rose-200/70">
            403 · Forbidden
          </p>
          <h1 className="mt-3 font-display text-3xl font-semibold">
            This control center is admin-only.
          </h1>
          <p className="mt-2 text-sm text-white/45">
            Changing the URL or frontend state cannot grant administrative
            access.
          </p>
          <a
            href="/"
            className="mt-6 inline-flex items-center gap-2 rounded-xl border border-white/10 px-5 py-3 text-sm text-white/70 hover:bg-white/[0.06]"
          >
            <ArrowLeft className="size-4" /> Return to JUNI AI
          </a>
        </div>
      </div>
    );
  }

  const data = dashboardQuery.data;

  return (
    <main className="min-h-screen bg-[#080b13] px-5 py-6 text-white sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-5 border-b border-white/10 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-200/70">
              <LockKeyhole className="size-3.5" /> Server-authorized admin panel
            </div>
            <h1 className="mt-3 font-display text-4xl font-semibold tracking-[-0.05em] sm:text-6xl">
              Control Center
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/45">
              Operational visibility for the JUNI platform. Sensitive mutations
              and future administrative resources remain server-gated.
            </p>
          </div>
          <a
            href="/"
            className="inline-flex items-center gap-2 self-start rounded-xl border border-white/10 px-4 py-2.5 text-xs text-white/65 hover:bg-white/[0.06] md:self-auto"
          >
            <ArrowLeft className="size-3.5" /> User panel
          </a>
        </header>

        {dashboardQuery.isError ? (
          <div className="mt-8 rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] p-5 text-sm text-rose-100">
            The server denied this administrative request. No admin data was
            returned.
          </div>
        ) : (
          <>
            <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
                <div className="flex items-center justify-between text-white/45">
                  <Activity className="size-5 text-emerald-300" />
                  <StatePill ok={data?.system.status === "operational"}>
                    Operational
                  </StatePill>
                </div>
                <p className="mt-7 font-mono text-[10px] uppercase tracking-wider text-white/35">
                  System health
                </p>
                <p className="mt-1 text-lg font-medium">Core services online</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
                <div className="flex items-center justify-between text-white/45">
                  <Database className="size-5 text-cyan-300" />
                  <StatePill ok={data?.system.database === "configured"}>
                    {data?.system.database ?? "Checking"}
                  </StatePill>
                </div>
                <p className="mt-7 font-mono text-[10px] uppercase tracking-wider text-white/35">
                  Data layer
                </p>
                <p className="mt-1 text-lg font-medium">
                  Owner-scoped foundation
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
                <div className="flex items-center justify-between text-white/45">
                  <Radio className="size-5 text-violet-300" />
                  <StatePill ok={Boolean(data?.provider.openAiConfigured)}>
                    Server configured
                  </StatePill>
                </div>
                <p className="mt-7 font-mono text-[10px] uppercase tracking-wider text-white/35">
                  Provider
                </p>
                <p className="mt-1 text-lg font-medium">
                  {data?.provider.realtimeModel ?? "Realtime"}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
                <div className="flex items-center justify-between text-white/45">
                  <Gauge className="size-5 text-amber-300" />
                  <StatePill ok>Preview safe</StatePill>
                </div>
                <p className="mt-7 font-mono text-[10px] uppercase tracking-wider text-white/35">
                  Usage & limits
                </p>
                <p className="mt-1 text-lg font-medium">No billing provider</p>
              </div>
            </section>

            <section className="mt-6 grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-200/60">
                      Runtime inventory
                    </p>
                    <h2 className="mt-2 text-xl font-semibold">
                      Capabilities and personas
                    </h2>
                  </div>
                  <Sparkles className="size-5 text-emerald-300" />
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {(data?.personas ?? []).map(persona => (
                    <div
                      key={persona.id}
                      className="rounded-xl border border-white/10 bg-black/10 p-4"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`size-2 rounded-full ${persona.id === "juni" ? "bg-emerald-300" : "bg-fuchsia-300"}`}
                        />
                        <span className="font-medium">{persona.name}</span>
                      </div>
                      <p className="mt-2 text-xs text-white/45">
                        {persona.gender} · voice {persona.voice}
                      </p>
                    </div>
                  ))}
                  <div className="rounded-xl border border-white/10 bg-black/10 p-4">
                    <div className="flex items-center gap-2">
                      <Mic2 className="size-4 text-cyan-300" />
                      <span className="font-medium">Live voice</span>
                    </div>
                    <p className="mt-2 text-xs text-white/45">
                      WebRTC with short-lived server-brokered secrets.
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/10 p-4">
                    <div className="flex items-center gap-2">
                      <Users className="size-4 text-violet-300" />
                      <span className="font-medium">User management</span>
                    </div>
                    <p className="mt-2 text-xs text-white/45">
                      Role data is server-derived; CRUD is not yet exposed.
                    </p>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-200/60">
                  Control boundaries
                </p>
                <h2 className="mt-2 text-xl font-semibold">Safe by default</h2>
                <div className="mt-5 space-y-3 text-sm text-white/55">
                  {[
                    "Admin role verified on the server",
                    "Provider keys never enter browser code",
                    "Billing remains preview-only",
                    "Memory and audit storage are deferred",
                  ].map(item => (
                    <div key={item} className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-300" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
