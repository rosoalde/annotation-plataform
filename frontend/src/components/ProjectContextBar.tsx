/**
 * ProjectContextBar
 *  - Barra fija con el contexto del proyecto (tema, descripción, ámbito).
 *  - Se monta una sola vez arriba de la lista de registros en AnnotateView,
 *    para que el anotador nunca pierda de vista para qué proyecto está anotando.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { projectsApi } from "../services/api";

export default function ProjectContextBar({ projectId }: { projectId: string }) {
    const qc = useQueryClient();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");

    const { data: project, isLoading } = useQuery({
        queryKey: ["project", projectId],
        queryFn: () => projectsApi.get(projectId),
        enabled: !!projectId,
        staleTime: 60_000,
    });

    const updateMutation = useMutation({
        mutationFn: (desc_tema: string) =>
            projectsApi.update(projectId, { desc_tema }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["project", projectId] });
            setEditing(false);
        },
    });

    const handleEdit = () => {
        setDraft(project?.desc_tema ?? "");
        setEditing(true);
    };
    const handleSave = () => {
        const trimmed = draft.trim();
        if (trimmed === (project?.desc_tema ?? "").trim()) { setEditing(false); return; }
        updateMutation.mutate(trimmed);
    };

    const handleCancel = () => setEditing(false);

    if (isLoading || !project) return null;

    return (
        <div style={S.bar}>
            <div style={S.row}>
                <span style={S.label}>Tema</span>
                <span style={S.value}>{project.tema || "—"}</span>
            </div>
            <div style={S.row}>
                <span style={S.label}>Descripción</span>
                {editing ? (
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
                        <textarea
                            autoFocus
                            rows={3}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)", color: "var(--text)", padding: "7px 10px", fontSize: 12, width: "100%", resize: "vertical", fontFamily: "inherit" }}
                            placeholder="Describe el tema del proyecto..."
                        />
                        <div style={{ display: "flex", gap: 6 }}>
                            <button
                                style={{ padding: "4px 10px", borderRadius: "var(--r)", border: "none", fontSize: 11, fontWeight: 500, cursor: "pointer", background: "var(--accent)", color: "#fff" }}
                                disabled={updateMutation.isPending}
                                onClick={handleSave}>
                                {updateMutation.isPending ? "Guardando..." : "Guardar"}
                            </button>
                            <button
                                style={{ padding: "4px 10px", borderRadius: "var(--r)", border: "1px solid var(--border)", fontSize: 11, fontWeight: 500, cursor: "pointer", background: "transparent", color: "var(--muted)" }}
                                onClick={handleCancel}>
                                Cancelar
                            </button>
                        </div>
                    </div>
                ) : (
                    <div style={{ flex: 1, display: "flex", alignItems: "baseline", gap: 8 }}>
                        <span style={{ ...S.value, color: "var(--muted)", flex: 1 }}>
                            {project.desc_tema || <em style={{ opacity: 0.5 }}>Sin descripción</em>}
                        </span>
                        <button
                            style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13, padding: "0 2px", opacity: 0.6 }}
                            onClick={handleEdit}
                            title="Editar descripción del tema">
                            ✎
                        </button>
                    </div>
                )}
            </div>
            {project.population_scope && (
                <div style={S.row}>
                    <span style={S.label}>Ámbito</span>
                    <span style={{ ...S.value, color: "var(--teal)" }}>🌍 {project.population_scope}</span>
                </div>
            )}
        </div>
    );
}

const S: Record<string, React.CSSProperties> = {
    bar: {
        position: "sticky" as const,
        top: 0,
        zIndex: 10,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r)",
        padding: "10px 14px",
        marginBottom: 16,
        display: "flex",
        flexDirection: "column" as const,
        gap: 4,
    },
    row: { display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" as const },
    label: {
        fontSize: 9,
        textTransform: "uppercase" as const,
        letterSpacing: "0.1em",
        color: "var(--muted)",
        fontWeight: 600,
        minWidth: 78,
        flexShrink: 0,
    },
    value: { fontSize: 12, color: "var(--text)", lineHeight: 1.5 },
};