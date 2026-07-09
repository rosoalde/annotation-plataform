/**
 * KeywordsView
 *  - Lista las keywords/términos de búsqueda del proyecto (generados por el LLM
 *    o añadidos a mano) y permite aceptarlas/rechazarlas.
 *  - Usa los endpoints YA EXISTENTES: GET/POST/PATCH /projects/{id}/keywords
 *  - Solo accesible para admin/reviewer (controlar en main.tsx igual que ImportView).
 */
import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { annotationsApi } from "../services/api";
import ProjectContextBar from "../components/ProjectContextBar";
import type { KeywordItem } from "../types";

const S: Record<string, React.CSSProperties> = {
    page: { display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)" },
    topbar: { height: 48, background: "var(--surface)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", padding: "0 22px", gap: 12, flexShrink: 0 },
    content: { flex: 1, overflowY: "auto", padding: 22, maxWidth: 700 },
    row: { display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r)", marginBottom: 8 },
    input: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)", color: "var(--text)", padding: "8px 11px", fontSize: 13, flex: 1 },
    btn: { padding: "6px 12px", borderRadius: "var(--r)", border: "none", fontSize: 12, fontWeight: 500, cursor: "pointer" },
};

export default function KeywordsView() {
    const { id: projectId } = useParams<{ id: string }>();
    const qc = useQueryClient();
    const [newKw, setNewKw] = useState("");
    const [addReason, setAddReason] = useState("");

    const { data: keywords, isLoading } = useQuery({
        queryKey: ["keywords", projectId],
        queryFn: () => annotationsApi.listKeywords(projectId!) as Promise<KeywordItem[]>,
        enabled: !!projectId,
    });

    const addMutation = useMutation({
        mutationFn: () =>
            annotationsApi.saveKeyword(projectId!, {
                project_id: projectId!,
                keyword: newKw.trim(),
                accepted: true,
                type: "manual",
                reason: addReason.trim() || undefined,
            }),
        onSuccess: () => {
            setNewKw("");
            setAddReason("");
            qc.invalidateQueries({ queryKey: ["keywords", projectId] });
        },
    });
    const [rejectReason, setRejectReason] = useState<Record<string, string>>({});
    const [rejectPending, setRejectPending] = useState<string | null>(null);

    const decideMutation = useMutation({
        mutationFn: ({ kw, accepted, reason }: { kw: KeywordItem; accepted: boolean; reason?: string }) => {
            if (!accepted && !reason?.trim()) throw new Error("Motivo requerido para rechazar");
            return annotationsApi.decideKeyword(projectId!, kw.id, {
                project_id: projectId!, keyword: kw.keyword, accepted: accepted, reason,
            });
        },
        onSuccess: (_, { kw }) => {
            setRejectPending(null);
            setRejectReason(prev => { const n = { ...prev }; delete n[kw.id]; return n; });
            qc.invalidateQueries({ queryKey: ["keywords", projectId] });
        },
    });

    return (
        <div style={S.page}>
            <div style={S.topbar}>
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>🔑 Palabras clave / términos de búsqueda</span>
            </div>
            <div style={S.content}>
                <ProjectContextBar projectId={projectId!} />

                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                        <input
                            style={S.input}
                            value={newKw}
                            placeholder="Añadir término manualmente..."
                            onChange={(e) => setNewKw(e.target.value)} />
                        <button
                            style={{ ...S.btn, background: "var(--accent)", color: "#fff" }}
                            disabled={!newKw.trim() || !addReason.trim() || addMutation.isPending}
                            onClick={() => addMutation.mutate()}>
                            + Añadir
                        </button>
                    </div>
                    <input
                        style={{ ...S.input, fontSize: 11 }}
                        value={addReason}
                        placeholder="Motivo de la adición (obligatorio)..."
                        onChange={(e) => setAddReason(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && newKw.trim() && addReason.trim()) addMutation.mutate();
                        }} />
                </div>

                {isLoading && <div style={{ color: "var(--muted)" }}>Cargando...</div>}

                {keywords?.map((kw) => (
                    <div key={kw.id} style={{ ...S.row, flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ flex: 1, fontSize: 13, color: "var(--text)" }}>{kw.keyword}</span>
                            <span style={{ fontSize: 10, color: "var(--muted)" }}>{kw.type}</span>
                            <span style={{
                                fontSize: 10, padding: "2px 8px", borderRadius: 100,
                                background: kw.accepted === true ? "rgba(46,194,126,0.12)" : kw.accepted === false ? "rgba(224,82,82,0.12)" : "rgba(107,112,128,0.12)",
                                color: kw.accepted === true ? "var(--green)" : kw.accepted === false ? "var(--red)" : "var(--muted)",
                            }}>
                                {kw.accepted === true ? "aceptada" : kw.accepted === false ? "rechazada" : "pendiente"}
                            </span>
                            <button style={{ ...S.btn, background: "transparent", border: "1px solid var(--border)", color: "var(--green)" }}
                                disabled={decideMutation.isPending}
                                onClick={() => decideMutation.mutate({ kw, accepted: true, reason: kw.reason ?? undefined })}>✓</button>
                            <button style={{ ...S.btn, background: "transparent", border: "1px solid var(--border)", color: "var(--red)" }}
                                onClick={() => setRejectPending(rejectPending === kw.id ? null : kw.id)}>✗</button>
                        </div>
                        {/* Motivo existente (solo lectura si ya fue decidida) */}
                        {kw.reason && rejectPending !== kw.id && (
                            <div style={{ fontSize: 11, color: "var(--muted)", fontStyle: "italic", paddingLeft: 4 }}>
                                Motivo: {kw.reason}
                            </div>
                        )}
                        {/* Panel de rechazo con motivo obligatorio */}
                        {rejectPending === kw.id && (
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                <input
                                    autoFocus
                                    style={{ ...S.input, flex: 1, fontSize: 11 }}
                                    placeholder="Motivo del rechazo (obligatorio)..."
                                    value={rejectReason[kw.id] ?? ""}
                                    onChange={(e) => setRejectReason(prev => ({ ...prev, [kw.id]: e.target.value }))}
                                />
                                <button
                                    style={{ ...S.btn, background: "var(--red)", color: "#fff", opacity: rejectReason[kw.id]?.trim() ? 1 : 0.4 }}
                                    disabled={!rejectReason[kw.id]?.trim() || decideMutation.isPending}
                                    onClick={() => decideMutation.mutate({ kw, accepted: false, reason: rejectReason[kw.id] })}>
                                    Confirmar rechazo
                                </button>
                                <button style={{ ...S.btn, background: "transparent", border: "1px solid var(--border)", color: "var(--muted)" }}
                                    onClick={() => setRejectPending(null)}>Cancelar</button>
                            </div>
                        )}
                    </div>
                ))}

                {!isLoading && !keywords?.length && (
                    <div style={{ textAlign: "center", padding: 40, color: "var(--muted)", fontSize: 13 }}>
                        Sin términos todavía. Añade uno arriba o impórtalos junto al CSV.
                    </div>
                )}
            </div>
        </div>
    );
}