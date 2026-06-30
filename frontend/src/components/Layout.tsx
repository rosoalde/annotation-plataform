import { Outlet, NavLink, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../stores/authStore";

const S: Record<string, React.CSSProperties> = {
    shell: { display: "flex", height: "100vh", overflow: "hidden" },
    sidebar: { width: 220, flexShrink: 0, background: "var(--surface)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column" },
    brand: { padding: "18px 16px 14px", borderBottom: "1px solid var(--border)" },
    brandTxt: { fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text)", textTransform: "uppercase" },
    brandSub: { fontSize: 10, color: "var(--muted)", marginTop: 2, fontFamily: "monospace" },
    userBlock: { padding: "12px 14px", background: "var(--card)", borderBottom: "1px solid var(--border)" },
    userName: { fontSize: 13, fontWeight: 500, color: "var(--text)" },
    userRole: { fontSize: 10, fontFamily: "'IBM Plex Mono',monospace", marginTop: 1 },
    navSection: { padding: "10px 12px 4px", fontSize: 9, letterSpacing: "0.15em", color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 },
    main: { flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" },
    bottom: { marginTop: "auto", padding: 12, borderTop: "1px solid var(--border)" },
};

function NavItem({ to, children, disabled }: { to: string; children: React.ReactNode; disabled?: boolean }) {
    if (disabled) return (
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 12px", margin: "1px 6px", color: "var(--muted)", fontSize: 12, opacity: 0.35, cursor: "not-allowed" }}>
            {children}
        </div>
    );
    return (
        <NavLink to={to} style={({ isActive }) => ({
            display: "flex", alignItems: "center", gap: 9,
            padding: "8px 12px", margin: "1px 6px",
            borderRadius: "var(--r)", color: isActive ? "var(--accent2)" : "var(--muted)",
            fontSize: 12, fontWeight: 500, textDecoration: "none",
            background: isActive ? "rgba(78,123,239,0.15)" : "transparent",
            transition: "all 0.12s",
        })}>
            {children}
        </NavLink>
    );
}

const roleColor = (role: string) => ({ annotator: "var(--accent2)", reviewer: "var(--purple)", judge: "var(--amber)", admin: "var(--red)" }[role] || "var(--muted)");

export default function Layout() {
    const { user, logout } = useAuthStore();
    const navigate = useNavigate();
    const qc = useQueryClient();
    const { id } = useParams<{ id?: string }>();
    const role = user?.role || "";

    const canReview = ["reviewer", "judge", "admin"].includes(role);
    const isJudge = ["judge", "admin"].includes(role);
    const isAdmin = role === "admin";

    return (
        <div style={S.shell}>
            <div style={S.sidebar}>
                <div style={S.brand}>
                    <div style={S.brandTxt}>Etiquetado</div>
                    <div style={S.brandSub}>annotation studio v3.1</div>
                </div>

                <div style={S.userBlock}>
                    <div style={S.userName}>{user?.username}</div>
                    <div style={{ ...S.userRole, color: roleColor(role) }}>● {role}</div>
                </div>

                <div style={S.navSection}>Proyecto</div>
                <NavItem to="/projects">📂 Proyectos</NavItem>

                {id && (
                    <>
                        <div style={S.navSection}>Anotar</div>
                        <NavItem to={`/projects/${id}/sentiment`}>💬 Sentimiento</NavItem>
                        <NavItem to={`/projects/${id}/pillars`}>🏛 Pilares</NavItem>

                        {canReview && (
                            <>
                                <div style={S.navSection}>Revisión</div>
                                <NavItem to={`/projects/${id}/review`}>🔍 Revisar</NavItem>
                            </>
                        )}
                        {(isAdmin || canReview) && (
                            <>
                                <div style={S.navSection}>Datos</div>
                                <NavItem to={`/projects/${id}/import`}>⬆ Importar CSV</NavItem>
                                <NavItem to={`/projects/${id}/keywords`}>🔑 Keywords</NavItem>
                            </>
                        )}
                        {isJudge && (
                            <>
                                <div style={S.navSection}>Juez</div>
                                <NavItem to={`/projects/${id}/judge`}>⚖️ Juzgar</NavItem>
                            </>
                        )}
                    </>
                )}

                {isAdmin && (
                    <>
                        <div style={S.navSection}>Administración</div>
                        <NavItem to="/admin">👤 Usuarios</NavItem>
                    </>
                )}

                <div style={S.bottom}>
                    <button
                        onClick={() => { logout(); qc.clear(); navigate("/login"); }}
                        style={{ width: "100%", padding: "6px 0", borderRadius: "var(--r)", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 12 }}>
                        Cerrar sesión
                    </button>
                </div>
            </div>

            <div style={S.main}>
                <Outlet />
            </div>
        </div>
    );
}