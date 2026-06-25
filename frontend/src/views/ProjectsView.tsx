import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { projectsApi } from "../services/api";
import { useAuthStore } from "../stores/authStore";

const S: Record<string, React.CSSProperties> = {
    page: { display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)" },
    topbar: { height: 48, background: "var(--surface)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", padding: "0 22px", gap: 12, flexShrink: 0 },
    content: { flex: 1, overflowY: "auto", padding: 22, maxWidth: 760 },
    card: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r2)", padding: 20, marginBottom: 14, cursor: "pointer", transition: "border-color 0.15s" },
};

export default function ProjectsView() {
    const navigate = useNavigate();
    const { setProject } = useAuthStore();
    const { data: projects, isLoading } = useQuery({ queryKey: ["projects"], queryFn: projectsApi.list });

    const handleSelect = (id: string) => {
        setProject(id);
        navigate(`/projects/${id}/sentiment`);
    };

    return (
        <div style={S.page}>
            <div style={S.topbar}>
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>Proyectos disponibles</span>
            </div>
            <div style={S.content}>
                <div style={{ background: "var(--surface)", borderLeft: "3px solid var(--accent)", borderRadius: "0 var(--r) var(--r) 0", padding: "10px 14px", marginBottom: 18, fontSize: 12, color: "var(--text)", lineHeight: 1.7 }}>
                    Selecciona un proyecto para empezar a anotar. Tu progreso se guarda automáticamente.
                </div>

                {isLoading && <div style={{ color: "var(--muted)", padding: 20 }}>Cargando proyectos...</div>}

                {projects?.map((p) => (
                    <div key={p.id} style={S.card}
                        onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
                        onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                        onClick={() => handleSelect(p.id)}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                            <div>
                                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>{p.name}</div>
                                <div style={{ fontSize: 12, color: "var(--muted)" }}>{p.tema}</div>
                                {p.population_scope && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>🌍 {p.population_scope}</div>}
                            </div>
                            <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 100, background: "rgba(46,194,126,0.12)", color: "var(--green)", border: "1px solid rgba(46,194,126,0.3)", fontFamily: "monospace", fontWeight: 600 }}>activo</span>
                        </div>
                        {p.desc_tema && <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>{p.desc_tema}</div>}
                    </div>
                ))}

                {!isLoading && !projects?.length && (
                    <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--muted)" }}>
                        <div style={{ fontSize: 28, marginBottom: 10 }}>📂</div>
                        <div style={{ fontWeight: 500, color: "var(--text)", marginBottom: 4 }}>No hay proyectos</div>
                        <div style={{ fontSize: 12 }}>Un administrador debe crear proyectos e importar datos.</div>
                    </div>
                )}
            </div>
        </div>
    );
}