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

    const { data: keywords, isLoading } = useQuery({
        queryKey: ["keywords", projectId],
        queryFn: () => annotationsApi.listKeywords(projectId!) as Promise<KeywordItem[]>,
        enabled: !!projectId,
    });

    const addMutation = useMutation({
        mutationFn: (keyword: string) =>
            annotationsApi.saveKeyword(projectId!, {
                project_id: projectId!, keyword, accepted: true, type: "manual",
            }),
        onSuccess: () => { setNewKw(""); qc.invalidateQueries({ queryKey: ["keywords", projectId] }); },
    });

    const decideMutation = useMutation({
        mutationFn: ({ kw, accepted }: { kw: KeywordItem; accepted: boolean }) =>
            annotationsApi.decideKeyword(projectId!, kw.id, {
                project_id: projectId!, keyword: kw.keyword, accepted,
            }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["keywords", projectId] }),
    });

    return (
        <div style={S.page}>
            <div style={S.topbar}>
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>🔑 Palabras clave / términos de búsqueda</span>
            </div>
            <div style={S.content}>
                <ProjectContextBar projectId={projectId!} />

                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                    <input style={S.input} value={newKw} placeholder="Añadir término manualmente..."
                        onChange={(e) => setNewKw(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && newKw.trim() && addMutation.mutate(newKw.trim())} />
                    <button style={{ ...S.btn, background: "var(--accent)", color: "#fff" }}
                        disabled={!newKw.trim() || addMutation.isPending}
                        onClick={() => addMutation.mutate(newKw.trim())}>+ Añadir</button>
                </div>

                {isLoading && <div style={{ color: "var(--muted)" }}>Cargando...</div>}

                {keywords?.map((kw) => (
                    <div key={kw.id} style={S.row}>
                        <span style={{ flex: 1, fontSize: 13, color: "var(--text)" }}>{kw.keyword}</span>
                        <span style={{ fontSize: 10, color: "var(--muted)" }}>{kw.type}</span>
                        <span style={{
                            fontSize: 10, padding: "2px 8px", borderRadius: 100,
                            background: kw.accepted ? "rgba(46,194,126,0.12)" : "rgba(224,82,82,0.12)",
                            color: kw.accepted ? "var(--green)" : "var(--red)",
                        }}>
                            {kw.accepted ? "aceptada" : "rechazada"}
                        </span>
                        <input
                            style={{ ...S.input, flex: 2, fontSize: 11 }}
                            placeholder="Justificación..."
                            defaultValue={kw.reason ?? ""}
                            onBlur={(e) => decideMutation.mutate({ kw, accepted: kw.accepted ?? true, reason: e.target.value })}
                        />
                        <button style={{ ...S.btn, background: "transparent", border: "1px solid var(--border)", color: "var(--green)" }}
                            onClick={() => decideMutation.mutate({ kw, accepted: true })}>✓</button>
                        <button style={{ ...S.btn, background: "transparent", border: "1px solid var(--border)", color: "var(--red)" }}
                            onClick={() => decideMutation.mutate({ kw, accepted: false })}>✗</button>
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