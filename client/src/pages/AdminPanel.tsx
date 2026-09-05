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
  Search,
  ShieldAlert,
  Sparkles,
  Users,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";

type AdminRole = "user" | "admin";

type PendingRoleChange = {
  userId: number;
  name: string;
  role: AdminRole;
};

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

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function AdminPanel() {
  const { user, loading } = useAuth();
  const isAdmin = user?.role === "admin";
  const [search, setSearch] = useState("");
  const [pendingRoleChange, setPendingRoleChange] =
    useState<PendingRoleChange | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const dashboardQuery = trpc.admin.dashboard.useQuery(undefined, {
    enabled: isAdmin,
    retry: false,
  });
  const usersQuery = trpc.admin.users.useQuery(undefined, {
    enabled: isAdmin,
    retry: false,
  });
  const utils = trpc.useUtils();
  const changeRoleMutation = trpc.admin.changeUserRole.useMutation({
    onSuccess: updatedUser => {
      setFeedback({
        type: "success",
        message: `${updatedUser.name || `User #${updatedUser.id}`} is now ${updatedUser.role}.`,
      });
      setPendingRoleChange(null);
      void utils.admin.users.invalidate();
    },
    onError: error => {
      setFeedback({ type: "error", message: error.message });
      setPendingRoleChange(null);
    },
  });

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return usersQuery.data ?? [];
    return (usersQuery.data ?? []).filter(candidate =>
      [candidate.name, candidate.email, String(candidate.id), candidate.role]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(query))
    );
  }, [search, usersQuery.data]);

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
              Operational visibility and carefully scoped user administration.
              Every mutation is checked against the authenticated server role.
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

            <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
              <div className="flex flex-col gap-4 border-b border-white/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-200/60">
                    Administration
                  </p>
                  <h2 className="mt-2 text-xl font-semibold">
                    User management
                  </h2>
                  <p className="mt-1 text-xs text-white/40">
                    Role changes are server-authorized, non-destructive, and
                    logged to the operational stream.
                  </p>
                </div>
                <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/10 px-3 py-2 text-xs text-white/50">
                  <Search className="size-3.5" />
                  <span className="sr-only">Search users</span>
                  <input
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    placeholder="Search users"
                    className="w-40 bg-transparent text-white outline-none placeholder:text-white/25"
                  />
                </label>
              </div>

              {feedback && (
                <div
                  className={`mt-4 rounded-xl border p-3 text-sm ${feedback.type === "success" ? "border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-100" : "border-rose-300/20 bg-rose-300/[0.06] text-rose-100"}`}
                  role="status"
                >
                  {feedback.message}
                </div>
              )}

              {usersQuery.isPending ? (
                <div className="mt-6 rounded-xl border border-white/10 bg-black/10 p-8 text-center text-sm text-white/45">
                  Loading user directory…
                </div>
              ) : usersQuery.isError ? (
                <div className="mt-6 rounded-xl border border-rose-300/20 bg-rose-300/[0.06] p-5 text-sm text-rose-100">
                  User management data is unavailable. No private user records
                  were returned.
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="mt-6 rounded-xl border border-white/10 bg-black/10 p-8 text-center text-sm text-white/45">
                  No users match this search.
                </div>
              ) : (
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="font-mono text-[10px] uppercase tracking-wider text-white/30">
                      <tr className="border-b border-white/10">
                        <th className="px-3 py-3 font-normal">User</th>
                        <th className="px-3 py-3 font-normal">Email</th>
                        <th className="px-3 py-3 font-normal">Role</th>
                        <th className="px-3 py-3 font-normal">Created</th>
                        <th className="px-3 py-3 font-normal">Last activity</th>
                        <th className="px-3 py-3 text-right font-normal">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map(candidate => (
                        <tr
                          key={candidate.id}
                          className="border-b border-white/[0.06] last:border-0"
                        >
                          <td className="px-3 py-4">
                            <div className="font-medium text-white/85">
                              {candidate.name || "Unnamed user"}
                            </div>
                            <div className="mt-1 font-mono text-[10px] text-white/30">
                              ID #{candidate.id}
                            </div>
                          </td>
                          <td className="px-3 py-4 text-white/55">
                            {candidate.email || "—"}
                          </td>
                          <td className="px-3 py-4">
                            <span
                              className={`rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${candidate.role === "admin" ? "bg-violet-300/10 text-violet-200" : "bg-white/10 text-white/55"}`}
                            >
                              {candidate.role}
                            </span>
                          </td>
                          <td className="px-3 py-4 text-xs text-white/45">
                            {formatDate(candidate.createdAt)}
                          </td>
                          <td className="px-3 py-4 text-xs text-white/45">
                            {formatDate(candidate.lastSignedIn)}
                          </td>
                          <td className="px-3 py-4 text-right">
                            <select
                              value={candidate.role}
                              disabled={
                                candidate.id === user.id ||
                                changeRoleMutation.isPending
                              }
                              onChange={event => {
                                setFeedback(null);
                                setPendingRoleChange({
                                  userId: candidate.id,
                                  name:
                                    candidate.name || `User #${candidate.id}`,
                                  role: event.target.value as AdminRole,
                                });
                              }}
                              className="rounded-lg border border-white/10 bg-[#111725] px-2.5 py-2 text-xs text-white/75 outline-none disabled:cursor-not-allowed disabled:opacity-40"
                              aria-label={`Change role for ${candidate.name || `user ${candidate.id}`}`}
                            >
                              <option value="user">user</option>
                              <option value="admin">admin</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-4 text-[11px] text-white/30">
                Account status is not shown because the current user schema has
                no status field. Destructive deletion, billing mutations, and
                persistent audit events remain unavailable.
              </p>
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
                      Server-authorized role management is available; status and
                      deletion remain deferred.
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
                    "Role changes require confirmation",
                    "Billing and destructive actions remain unavailable",
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

      {pendingRoleChange && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-5 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="role-change-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111725] p-6 shadow-2xl">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-200/70">
              Confirm administrative action
            </p>
            <h2
              id="role-change-title"
              className="mt-3 text-xl font-semibold text-white"
            >
              Change {pendingRoleChange.name} to {pendingRoleChange.role}?
            </h2>
            <p className="mt-3 text-sm leading-6 text-white/50">
              This changes the persisted role used by server authorization. The
              action is non-destructive but may change access immediately.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setPendingRoleChange(null)}
                className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/65 hover:bg-white/[0.06]"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  changeRoleMutation.mutate({
                    userId: pendingRoleChange.userId,
                    role: pendingRoleChange.role,
                  })
                }
                disabled={changeRoleMutation.isPending}
                className="rounded-xl bg-emerald-300 px-4 py-2.5 text-sm font-semibold text-[#080b13] disabled:opacity-50"
              >
                {changeRoleMutation.isPending ? "Saving…" : "Confirm change"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
