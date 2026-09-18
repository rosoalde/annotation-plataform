/**
 * ProjectContextBar
 *  - Barra fija con el contexto del proyecto (tema, descripción, ámbito).
 *  - Se monta una sola vez arriba de la lista de registros en AnnotateView,
 *    para que el anotador nunca pierda de vista para qué proyecto está anotando.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { projectsApi, annotationsApi } from "../services/api";
import { useAuthStore } from "../stores/authStore";

export default function ProjectContextBar({ projectId, mode = "admin" }: { projectId: string; mode?: "admin" | "annotator" }) {
    const qc = useQueryClient();
    const username = useAuthStore((s) => s.user?.username);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    const [rejecting, setRejecting] = useState(false);
    const [changingProposal, setChangingProposal] = useState(false);
    const [newVal, setNewVal] = useState("");
    const [newReason, setNewReason] = useState("");

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

    const proposeMutation = useMutation({
        mutationFn: (data: { corrected_text: string; is_correction: boolean; correction_reason?: string }) =>
            annotationsApi.saveTopicDesc(projectId, data),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["project", projectId] });
            setRejecting(false);
            setChangingProposal(false);
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

    const myProposal = mode === "annotator" ? project.topic_desc_annotators?.find(a => a.annotator === username) : undefined;

    return (
        <div style={S.bar}>
            <div style={S.row}>
                <span style={S.label}>Tema</span>
                <span style={S.value}>{project.tema || "—"}</span>
            </div>
            <div style={S.row}>
                <span style={S.label}>Descripción</span>
                {mode === "annotator" ? (
                    <div style={{ flex: 1 }}>
                        <div style={{ ...S.value, marginBottom: 4 }}>
                            🤖 LLM: {project.desc_tema || <em style={{ opacity: 0.5 }}>Sin descripción</em>}
                        </div>
                        {myProposal && !changingProposal ? (
                            <div style={{ fontSize: 11, color: "var(--green)" }}>
                                ✓ Tu propuesta: {myProposal.corrected_text}
                                {myProposal.correction_reason && <em style={{ color: "var(--muted)" }}> — "{myProposal.correction_reason}"</em>}
                                <button onClick={() => setChangingProposal(true)}
                                    style={{ marginLeft: 8, background: "transparent", border: "none", color: "var(--muted)", fontSize: 10, cursor: "pointer", textDecoration: "underline" }}>
                                    ↶ Deshacer
                                </button>
                            </div>
                        ) : rejecting ? (
                            <div style={{ display: "flex", flexDirection: "column" as const, gap: 5, maxWidth: 480 }}>
                                <textarea rows={2} value={newVal} onChange={(e) => setNewVal(e.target.value)}
                                    placeholder="Tu descripción del tema..."
                                    style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)", color: "var(--text)", padding: "6px 8px", fontSize: 12, fontFamily: "inherit" }} />
                                <input value={newReason} onChange={(e) => setNewReason(e.target.value)}
                                    placeholder="Justificación..."
                                    style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)", color: "var(--text)", padding: "6px 8px", fontSize: 11, fontFamily: "inherit" }} />
                                <div style={{ display: "flex", gap: 6 }}>
                                    <button disabled={!newVal.trim() || proposeMutation.isPending}
                                        onClick={() => proposeMutation.mutate({ corrected_text: newVal.trim(), is_correction: true, correction_reason: newReason.trim() || undefined })}
                                        style={{ padding: "4px 10px", borderRadius: "var(--r)", border: "none", fontSize: 11, fontWeight: 500, cursor: "pointer", background: "var(--accent)", color: "#fff" }}>
                                        Guardar →
                                    </button>
                                    <button onClick={() => { setRejecting(false); setChangingProposal(false); }} style={{ padding: "4px 10px", borderRadius: "var(--r)", border: "1px solid var(--border)", fontSize: 11, background: "transparent", color: "var(--muted)", cursor: "pointer" }}>
                                        Cancelar
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                <button disabled={proposeMutation.isPending}
                                    onClick={() => proposeMutation.mutate({ corrected_text: project.desc_tema, is_correction: false })}
                                    style={{ padding: "4px 10px", borderRadius: "var(--r)", border: "1.5px solid var(--green)", fontSize: 10, fontWeight: 600, cursor: "pointer", background: "rgba(46,194,126,0.1)", color: "var(--green)" }}>
                                    ✓ CONFIRMO / ESTOY DE ACUERDO
                                </button>
                                <button onClick={() => setRejecting(true)}
                                    style={{ padding: "4px 10px", borderRadius: "var(--r)", border: "1.5px solid var(--red)", fontSize: 10, fontWeight: 600, cursor: "pointer", background: "rgba(224,82,82,0.1)", color: "var(--red)" }}>
                                    ✕ NO CONFIRMO / NO ESTOY DE ACUERDO
                                </button>
                                {changingProposal && (
                                    <button onClick={() => setChangingProposal(false)}
                                        style={{ background: "transparent", border: "none", color: "var(--muted)", fontSize: 10, cursor: "pointer", textDecoration: "underline" }}>
                                        ‹ Cancelar
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                ) : editing ? (
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
                    <div style={{ flex: 1, display: "flex", alignItems: "baseline", gap: 4 }}>
                        <span style={{ ...S.value, color: "var(--muted)" }}>
                            {project.desc_tema || <em style={{ opacity: 0.5 }}>Sin descripción</em>}
                        </span>
                        <button
                            style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13, padding: "0 2px", opacity: 0.6 }}
                            onClick={handleEdit}
                            title="Editar descripción del tema">
                            <span
                                style={{
                                    color: "var(--accent)",
                                    fontSize: 13,
                                    opacity: 1,
                                }}
                            >
                                ✎
                            </span>
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