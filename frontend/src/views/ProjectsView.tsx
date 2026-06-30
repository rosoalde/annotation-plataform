import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { projectsApi } from "../services/api";
import { useAuthStore } from "../stores/authStore";

const S: Record<string, React.CSSProperties> = {
    page: { display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)" },
    topbar: { height: 48, background: "var(--surface)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", padding: "0 22px", gap: 12, flexShrink: 0 },
    content: { flex: 1, overflowY: "auto", padding: 22, maxWidth: 760 },
    card: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r2)", padding: 20, marginBottom: 14, cursor: "pointer", transition: "border-color 0.15s" },
    formCard: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r2)", padding: 18, marginBottom: 18 },
    label: { fontSize: 11, color: "var(--muted)", fontWeight: 500, display: "block", marginBottom: 4 },
    field: { marginBottom: 12 },
    toast: { position: "fixed" as const, bottom: 20, right: 20, background: "var(--card)", border: "1px solid var(--border2)", borderRadius: "var(--r)", padding: "10px 16px", fontSize: 12, zIndex: 200 },
};

export default function ProjectsView() {
    const navigate = useNavigate();
    const { setProject, user } = useAuthStore();
    const qc = useQueryClient();
    const isAdmin = user?.role === "admin" || user?.role === "reviewer";

    const { data: projects, isLoading } = useQuery({ queryKey: ["projects"], queryFn: projectsApi.list });

    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ name: "", tema: "", desc_tema: "", population_scope: "" });
    const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

    const showToast = useCallback((msg: string, ok = true) => {
        setToast({ msg, ok });
        setTimeout(() => setToast(null), 3000);
    }, []);

    const createMutation = useMutation({
        mutationFn: () => projectsApi.create(form),
        onSuccess: (created) => {
            qc.invalidateQueries({ queryKey: ["projects"] });
            setShowForm(false);
            setForm({ name: "", tema: "", desc_tema: "", population_scope: "" });
            showToast(`Proyecto "${created.name}" creado ✓`);
        },
        onError: (err: any) => showToast(err?.response?.data?.detail ?? "Error al crear el proyecto", false),
    });

    const handleSelect = (id: string) => {
        setProject(id);
        navigate(`/projects/${id}/anotar`);
    };

    return (
        <div style={S.page}>
            <div style={S.topbar}>
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", flex: 1 }}>Proyectos disponibles</span>
                {isAdmin && (
                    <button
                        onClick={() => setShowForm((v) => !v)}
                        style={{ padding: "6px 12px", borderRadius: "var(--r)", border: "1px solid var(--accent)", background: showForm ? "var(--accent)" : "transparent", color: showForm ? "#fff" : "var(--accent2)", fontSize: 12, fontWeight: 500 }}>
                        {showForm ? "✕ Cancelar" : "+ Nuevo proyecto"}
                    </button>
                )}
            </div>
            <div style={S.content}>
                <div style={{ background: "var(--surface)", borderLeft: "3px solid var(--accent)", borderRadius: "0 var(--r) var(--r) 0", padding: "10px 14px", marginBottom: 18, fontSize: 12, color: "var(--text)", lineHeight: 1.7 }}>
                    Selecciona un proyecto para empezar a anotar. Tu progreso se guarda automáticamente.
                    {isAdmin && " Una vez dentro de un proyecto, debes usar “⬆ Importar CSV” en el menú lateral para cargar registros."}
                </div>

                {showForm && (
                    <div style={S.formCard}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 14 }}>Crear nuevo proyecto</div>

                        <div style={S.field}>
                            <label style={S.label}>Nombre *</label>
                            <input
                                value={form.name}
                                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                                placeholder="Ej: Proyecto de prueba"
                                style={{ width: "100%" }} />
                        </div>

                        <div style={S.field}>
                            <label style={S.label}>Tema *</label>
                            <input
                                value={form.tema}
                                onChange={(e) => setForm((f) => ({ ...f, tema: e.target.value }))}
                                placeholder="Ej: vacunación infantil"
                                style={{ width: "100%" }} />
                        </div>

                        <div style={S.field}>
                            <label style={S.label}>Descripción del tema</label>
                            <textarea
                                rows={2}
                                value={form.desc_tema}
                                onChange={(e) => setForm((f) => ({ ...f, desc_tema: e.target.value }))}
                                placeholder="Breve descripción de qué trata el proyecto"
                                style={{ width: "100%" }} />
                        </div>

                        <div style={S.field}>
                            <label style={S.label}>Ámbito / población (contexto geo)</label>
                            <input
                                value={form.population_scope}
                                onChange={(e) => setForm((f) => ({ ...f, population_scope: e.target.value }))}
                                placeholder="Ej: España"
                                style={{ width: "100%" }} />
                        </div>

                        <div style={{ display: "flex", justifyContent: "flex-end" }}>
                            <button
                                onClick={() => createMutation.mutate()}
                                disabled={!form.name || !form.tema || createMutation.isPending}
                                style={{ padding: "7px 16px", borderRadius: "var(--r)", background: "var(--accent)", color: "#fff", border: "none", fontSize: 12, fontWeight: 500, opacity: (!form.name || !form.tema) ? 0.5 : 1 }}>
                                {createMutation.isPending ? "Creando..." : "Crear proyecto →"}
                            </button>
                        </div>
                    </div>
                )}

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
                        <div style={{ fontSize: 12 }}>
                            {isAdmin ? 'Pulsa "+ Nuevo proyecto" arriba para crear el primero.' : "Un administrador debe crear proyectos e importar datos."}
                        </div>
                    </div>
                )}
            </div>

            {toast && (
                <div style={{ ...S.toast, color: toast.ok ? "var(--green)" : "var(--amber)" }}>
                    {toast.ok ? "✓ " : "⚠ "}{toast.msg}
                </div>
            )}
        </div>
    );
}