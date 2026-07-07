import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi, AccountPendingError } from "../services/api";
import { useAuthStore } from "../stores/authStore";
import type { UserRole } from "../types";

const ROLES: { value: UserRole; label: string; desc: string }[] = [
    { value: "annotator", label: "Anotador/a", desc: "Revisa y corrige clasificaciones" },
    { value: "reviewer", label: "Revisor/a", desc: "Supervisa el trabajo del equipo" },
    { value: "judge", label: "Juez/a", desc: "Decide la etiqueta definitiva" },
];

export default function LoginView() {
    const navigate = useNavigate();
    const setAuth = useAuthStore((s) => s.setAuth);

    const [tab, setTab] = useState<"login" | "register">("login");
    const [username, setUsername] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [role, setRole] = useState<UserRole>("annotator");
    const [error, setError] = useState("");
    const [pendingMsg, setPendingMsg] = useState("");
    const [loading, setLoading] = useState(false);

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setError("");
        setPendingMsg("");
        setLoading(true);
        try {
            if (tab === "register") {
                // Self-registration: account is created as "pending".
                // No token is returned — the user CANNOT log in until an admin approves.
                const res = await authApi.register({ username, email, password, role });
                setPendingMsg(res.message);
                setTab("login");
                setPassword("");
                return;
            }

            const data = await authApi.login(username, password);
            setAuth(data.access_token, {
                id: data.user_id, username: data.username, role: data.role, status: data.status,
                must_change_password: data.must_change_password,
            });
            navigate(data.must_change_password ? "/change-password" : "/projects");
        } catch (err: any) {
            if (err instanceof AccountPendingError) {
                setError(err.message);
            } else {
                setError(err?.response?.data?.detail ?? err.message ?? "Error desconocido");
            }
        } finally {
            setLoading(false);
        }
    }

    return (
        <div style={styles.bg}>
            <div style={styles.card}>
                <div style={styles.brand}>Panel de etiquetado</div>
                <h1 style={styles.heading}>
                    {tab === "login" ? "Iniciar sesión" : "Crear cuenta"}
                </h1>

                <div style={styles.tabs}>
                    {(["login", "register"] as const).map((t) => (
                        <button key={t}
                            style={{ ...styles.tab, ...(tab === t ? styles.tabActive : {}) }}
                            onClick={() => { setTab(t); setError(""); setPendingMsg(""); }}>
                            {t === "login" ? "Entrar" : "Registrarse"}
                        </button>
                    ))}
                </div>

                {pendingMsg && (
                    <div style={styles.pendingBox}>
                        ⏳ {pendingMsg}
                    </div>
                )}

                <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <label style={styles.label}>Usuario</label>
                    <input style={styles.input} value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="nombre de usuario" required />

                    {tab === "register" && (
                        <>
                            <label style={styles.label}>Email</label>
                            <input style={styles.input} type="email" value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="tu@email.com" required />
                        </>
                    )}

                    <label style={styles.label}>Contraseña</label>
                    <input style={styles.input} type="password" value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="mínimo 8 caracteres" required />

                    {tab === "register" && (
                        <>
                            <label style={styles.label}>Rol solicitado</label>
                            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>
                                Un administrador confirmará o ajustará tu rol al aprobar la cuenta.
                            </div>
                            {ROLES.map((r) => (
                                <div key={r.value}
                                    style={{ ...styles.roleOption, ...(role === r.value ? styles.roleSelected : {}) }}
                                    onClick={() => setRole(r.value)}>
                                    <div style={{ fontWeight: 500, fontSize: 13 }}>{r.label}</div>
                                    <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>{r.desc}</div>
                                </div>
                            ))}
                        </>
                    )}

                    {error && <div style={styles.error}>{error}</div>}

                    <button type="submit" style={styles.submit} disabled={loading}>
                        {loading ? "..." : tab === "login" ? "Entrar →" : "Solicitar acceso →"}
                    </button>
                </form>
                <p style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", marginTop: 10 }}>
                    ¿Olvidaste tu contraseña? Pídele a un administrador que la resetee.
                </p>
            </div>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    bg: { minHeight: "100vh", background: "#0a0b0e", display: "flex", alignItems: "center", justifyContent: "center" },
    card: { background: "#181b22", border: "1px solid #252830", borderRadius: 12, padding: 32, width: 380 },
    brand: { fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#6b7080", marginBottom: 6, fontFamily: "monospace" },
    heading: { fontSize: 22, fontWeight: 600, color: "#dde1ec", marginBottom: 20 },
    tabs: { display: "flex", gap: 0, marginBottom: 18, background: "#111318", borderRadius: 8, padding: 3 },
    tab: { flex: 1, padding: "7px 0", fontSize: 12, fontWeight: 500, cursor: "pointer", border: "none", background: "transparent", color: "#6b7080", borderRadius: 6 },
    tabActive: { background: "#252830", color: "#dde1ec" },
    label: { fontSize: 11, color: "#6b7080", fontWeight: 500 },
    input: { background: "#111318", border: "1px solid #252830", borderRadius: 8, color: "#dde1ec", padding: "8px 11px", fontSize: 13, outline: "none", fontFamily: "inherit" },
    roleOption: { border: "1.5px solid #252830", borderRadius: 8, padding: "10px 12px", cursor: "pointer" },
    roleSelected: { borderColor: "#4e7bef", background: "rgba(78,123,239,0.08)" },
    error: { fontSize: 12, color: "#e05252", background: "rgba(224,82,82,0.1)", borderRadius: 6, padding: "7px 10px" },
    pendingBox: { fontSize: 12, color: "#e8962a", background: "rgba(232,150,42,0.1)", border: "1px solid rgba(232,150,42,0.3)", borderRadius: 8, padding: "10px 12px", marginBottom: 14, lineHeight: 1.5 },
    submit: { marginTop: 4, background: "#4e7bef", color: "#fff", border: "none", borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 500, cursor: "pointer" },
};