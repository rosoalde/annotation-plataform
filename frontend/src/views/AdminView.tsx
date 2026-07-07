import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "../services/api";
import type { UserRole } from "../types";

const S: Record<string, React.CSSProperties> = {
    page: { display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)" },
    topbar: { height: 48, background: "var(--surface)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", padding: "0 22px", gap: 12, flexShrink: 0 },
    content: { flex: 1, overflowY: "auto", padding: 22, maxWidth: 860 },
    card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r2)", padding: 16, marginBottom: 12 },
    toast: { position: "fixed" as const, bottom: 20, right: 20, background: "var(--card)", border: "1px solid var(--border2)", borderRadius: "var(--r)", padding: "10px 16px", fontSize: 12, zIndex: 200 },
};

const roleColor = (role: string) => ({ annotator: "var(--accent2)", reviewer: "var(--purple)", judge: "var(--amber)", admin: "var(--red)" }[role] || "var(--muted)");

const ROLE_OPTIONS: UserRole[] = ["annotator", "reviewer", "judge", "admin"];

export default function AdminView() {
    const qc = useQueryClient();
    const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
    const [tempPwModal, setTempPwModal] = useState<{ username: string; password: string } | null>(null);
    const [roleOverride, setRoleOverride] = useState<Record<string, UserRole>>({});

    const showToast = (msg: string, ok = true) => {
        setToast({ msg, ok });
        setTimeout(() => setToast(null), 2600);
    };

    const copyToClipboard = async (text: string) => {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                // Fallback para contextos no seguros (HTTP sobre IP, no localhost)
                const ta = document.createElement("textarea");
                ta.value = text;
                ta.style.position = "fixed";
                ta.style.opacity = "0";
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                document.execCommand("copy");
                document.body.removeChild(ta);
            }
            showToast("Contraseña copiada ✓");
        } catch {
            showToast("No se pudo copiar. Seleccioná el texto y usá Ctrl+C.", false);
        }
    };

    const { data: pending, isLoading: loadingPending } = useQuery({
        queryKey: ["admin-pending-users"],
        queryFn: adminApi.pendingUsers,
    });

    const { data: allUsers, isLoading: loadingAll } = useQuery({
        queryKey: ["admin-all-users"],
        queryFn: adminApi.allUsers,
    });

    const decideMutation = useMutation({
        mutationFn: ({ userId, decision, role }: { userId: string; decision: "approve" | "reject"; role?: UserRole }) =>
            adminApi.decide(userId, decision, role),
        onSuccess: (_, { decision }) => {
            qc.invalidateQueries({ queryKey: ["admin-pending-users"] });
            qc.invalidateQueries({ queryKey: ["admin-all-users"] });
            showToast(decision === "approve" ? "Usuario aprobado ✓" : "Usuario rechazado ✗");
        },
        onError: () => showToast("Error al procesar la solicitud", false),
    });

    const roleMutation = useMutation({
        mutationFn: ({ userId, role }: { userId: string; role: UserRole }) => adminApi.changeRole(userId, role),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["admin-all-users"] });
            showToast("Rol actualizado ✓");
        },
    });

    const resetPwMutation = useMutation({
        mutationFn: (userId: string) => adminApi.resetPassword(userId),
        onSuccess: (data, userId) => {
            const u = allUsers?.find((x) => x.id === userId);
            setTempPwModal({ username: u?.username ?? "usuario", password: data.temp_password });
        },
        onError: () => showToast("Error al resetear la contraseña", false),
    });

    return (
        <div style={S.page}>
            <div style={S.topbar}>
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", flex: 1 }}>👤 Administración de usuarios</span>
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 100, background: "rgba(232,150,42,0.12)", color: "var(--amber)", border: "1px solid rgba(232,150,42,0.3)", fontFamily: "monospace", fontWeight: 600 }}>
                    {pending?.length ?? 0} pendientes
                </span>
            </div>

            <div style={S.content}>
                {/* ── Pending approvals ───────────────────────────────────────── */}
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "var(--muted)", marginBottom: 10 }}>
                    Solicitudes pendientes
                </div>

                {loadingPending && <div style={{ color: "var(--muted)", padding: 12 }}>Cargando...</div>}

                {!loadingPending && !pending?.length && (
                    <div style={{ ...S.card, textAlign: "center" as const, color: "var(--muted)" }}>
                        ✅ No hay solicitudes pendientes de aprobación.
                    </div>
                )}

                {pending?.map((u) => {
                    const selectedRole = roleOverride[u.id] ?? u.role;
                    return (
                        <div key={u.id} style={S.card}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                                <div>
                                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{u.username}</div>
                                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{u.email}</div>
                                    <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                                        Solicitó el {new Date(u.created_at).toLocaleDateString()}
                                    </div>
                                </div>
                                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 100, background: "rgba(232,150,42,0.12)", color: "var(--amber)", border: "1px solid rgba(232,150,42,0.3)" }}>
                                    pendiente
                                </span>
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                                <span style={{ fontSize: 11, color: "var(--muted)" }}>Rol a asignar:</span>
                                <select
                                    value={selectedRole}
                                    onChange={(e) => setRoleOverride((p) => ({ ...p, [u.id]: e.target.value as UserRole }))}
                                    style={{ fontSize: 12, padding: "4px 8px" }}>
                                    {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                                </select>
                                {selectedRole !== u.role && (
                                    <span style={{ fontSize: 10, color: "var(--amber)" }}>(solicitó: {u.role})</span>
                                )}
                            </div>

                            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                                <button
                                    onClick={() => decideMutation.mutate({ userId: u.id, decision: "reject" })}
                                    style={{ padding: "6px 12px", borderRadius: "var(--r)", border: "1px solid rgba(224,82,82,0.3)", background: "rgba(224,82,82,0.08)", color: "var(--red)", fontSize: 11, fontWeight: 500 }}>
                                    ✗ Rechazar
                                </button>
                                <button
                                    onClick={() => decideMutation.mutate({ userId: u.id, decision: "approve", role: selectedRole })}
                                    style={{ padding: "6px 12px", borderRadius: "var(--r)", border: "1px solid rgba(46,194,126,0.3)", background: "rgba(46,194,126,0.08)", color: "var(--green)", fontSize: 11, fontWeight: 500 }}>
                                    ✓ Aprobar como {selectedRole}
                                </button>
                            </div>
                        </div>
                    );
                })}

                {/* ── All users ────────────────────────────────────────────────── */}
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "var(--muted)", margin: "26px 0 10px" }}>
                    Todos los usuarios
                </div>

                {loadingAll && <div style={{ color: "var(--muted)", padding: 12 }}>Cargando...</div>}

                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r2)", overflow: "hidden" }}>
                    {allUsers?.map((u, i) => (
                        <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: i < allUsers.length - 1 ? "1px solid var(--border)" : "none" }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 13, color: "var(--text)" }}>{u.username}</div>
                                <div style={{ fontSize: 11, color: "var(--muted)" }}>{u.email}</div>
                            </div>
                            <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 100, background: u.status === "approved" ? "rgba(46,194,126,0.12)" : u.status === "rejected" ? "rgba(224,82,82,0.12)" : "rgba(232,150,42,0.12)", color: u.status === "approved" ? "var(--green)" : u.status === "rejected" ? "var(--red)" : "var(--amber)" }}>
                                {u.status}
                            </span>
                            <select
                                value={u.role}
                                disabled={u.status !== "approved"}
                                onChange={(e) => roleMutation.mutate({ userId: u.id, role: e.target.value as UserRole })}
                                style={{ fontSize: 11, padding: "3px 6px", color: roleColor(u.role) }}>
                                {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                            <button
                                onClick={() => { if (confirm(`¿Resetear contraseña de ${u.username}?`)) resetPwMutation.mutate(u.id); }}
                                style={{ fontSize: 10, padding: "3px 8px", borderRadius: "var(--r)", border: "1px solid var(--border2)", background: "transparent", color: "var(--muted)" }}>
                                🔑 Reset
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {tempPwModal && (
                <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300 }}>
                    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r2)", padding: 20, maxWidth: 360 }}>
                        <div style={{ fontSize: 13, marginBottom: 10 }}>
                            Contraseña temporal para <b>{tempPwModal.username}</b>:
                        </div>
                        <div style={{ fontFamily: "monospace", fontSize: 16, background: "var(--card)", padding: "10px 14px", borderRadius: "var(--r)", marginBottom: 12, userSelect: "all" as const }}>
                            {tempPwModal.password}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 14 }}>
                            Copiala ahora y pasásela al usuario. No se va a volver a mostrar.
                        </div>
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            {/* <button onClick={() => navigator.clipboard.writeText(tempPwModal.password)} style={{ padding: "6px 12px", borderRadius: "var(--r)", border: "1px solid var(--border2)" }}>Copiar</button> */}
                            <button onClick={() => copyToClipboard(tempPwModal.password)} style={{ padding: "6px 12px", borderRadius: "var(--r)", border: "1px solid var(--border2)" }}>Copiar</button>
                            <button onClick={() => setTempPwModal(null)} style={{ padding: "6px 12px", borderRadius: "var(--r)", background: "var(--accent2)", color: "#fff" }}>Cerrar</button>
                        </div>
                    </div>
                </div>
            )}

            {toast && <div style={{ ...S.toast, color: toast.ok ? "var(--green)" : "var(--amber)" }}>{toast.ok ? "✓ " : "⚠ "}{toast.msg}</div>}
        </div>
    );
}