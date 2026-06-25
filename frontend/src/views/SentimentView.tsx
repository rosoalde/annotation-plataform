/**
 * SentimentView
 *  - Acquires pessimistic lock before showing annotation controls.
 *  - Shows clear 409 error if another user holds the lock.
 *  - Progress bar uses server-side pending/done — never negative.
 *  - Saves release the lock automatically (server-side).
 *  - Shows lang + world_data (continent/country/region/city) badges,
 *    produced by the LLM re-analysis pass, purely informative.
 */
import React, { useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { recordsApi, annotationsApi, LockConflictError } from "../services/api";
import type { Record as AnnotRecord } from "../types";

const SENT_OPTS = [
    { v: 1, icon: "↑", label: "Positivo", color: "#2ec27e" },
    { v: -1, icon: "↓", label: "Negativo", color: "#e05252" },
    { v: 0, icon: "→", label: "Neutro", color: "#6b7080" },
    { v: 2, icon: "✕", label: "No relac.", color: "#30343f" },
];
const sentLabel = (v?: number) => SENT_OPTS.find((o) => o.v === v)?.label ?? String(v ?? "—");

function worldBadge(rec: AnnotRecord) {
    const parts = [rec.world_city, rec.world_region, rec.world_country].filter(Boolean);
    if (!parts.length && !rec.lang) return null;
    return (
        <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 100, background: "rgba(40,191,176,0.1)", color: "#28bfb0", border: "1px solid rgba(40,191,176,0.25)", fontFamily: "monospace" }}>
            🌍 {parts.join(", ") || "—"}{rec.lang ? ` · ${rec.lang}` : ""}
        </span>
    );
}

export default function SentimentView() {
    const { id: projectId } = useParams<{ id: string }>();
    const qc = useQueryClient();

    const [offset, setOffset] = useState(0);
    const LIMIT = 20;

    const [annotations, setAnnotations] = useState<
        Record<string, { corrected_sentiment?: number; correction_reason?: string; corrected_topic?: string; topic_reason?: string }>
    >({});
    const [lockErrors, setLockErrors] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState<Record<string, boolean>>({});
    const [toast, setToast] = useState<{ msg: string; type?: "ok" | "warn" } | null>(null);

    const { data, isLoading, error } = useQuery({
        queryKey: ["records", projectId, "sentiment", offset],
        queryFn: () => recordsApi.list(projectId!, { annotation_type: "sentiment", limit: LIMIT, offset }),
        enabled: !!projectId,
    });

    const lockMutation = useMutation({
        mutationFn: (recordId: string) => recordsApi.acquireLock(projectId!, recordId),
        onError: (err, recordId) => {
            const msg = err instanceof LockConflictError ? err.message : "Error al adquirir el lock";
            setLockErrors((prev) => ({ ...prev, [recordId]: msg }));
        },
        onSuccess: (_, recordId) => {
            setLockErrors((prev) => { const n = { ...prev }; delete n[recordId]; return n; });
        },
    });

    const saveMutation = useMutation({
        mutationFn: ({ rec, ann }: { rec: AnnotRecord; ann: typeof annotations[string] }) => {
            const corrected = ann.corrected_sentiment ?? rec.sentiment_llm ?? 2;
            return annotationsApi.saveSentiment(projectId!, {
                record_id: rec.id, project_id: projectId!,
                original_sentiment: rec.sentiment_llm ?? 2, corrected_sentiment: corrected,
                is_correction: corrected !== rec.sentiment_llm,
                correction_reason: ann.correction_reason ?? undefined,
                original_topic: rec.topic_llm ?? undefined,
                corrected_topic: ann.corrected_topic ?? rec.topic_llm ?? undefined,
                topic_reason: ann.topic_reason ?? undefined,
            });
        },
        onSuccess: (_, { rec }) => {
            setSaving((prev) => { const n = { ...prev }; delete n[rec.id]; return n; });
            qc.invalidateQueries({ queryKey: ["records", projectId, "sentiment"] });
            showToast("Guardado ✓");
        },
        onError: (err, { rec }) => {
            setSaving((prev) => { const n = { ...prev }; delete n[rec.id]; return n; });
            const msg = err instanceof LockConflictError ? err.message : "Error al guardar";
            showToast(msg, "warn");
        },
    });

    const showToast = useCallback((msg: string, type: "ok" | "warn" = "ok") => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 2600);
    }, []);

    const handleSave = async (rec: AnnotRecord) => {
        const ann = annotations[rec.id] ?? {};
        const isCorr = ann.corrected_sentiment !== undefined && ann.corrected_sentiment !== rec.sentiment_llm;
        if (isCorr && !ann.correction_reason) { showToast("Escribe el motivo de la corrección", "warn"); return; }
        setSaving((prev) => ({ ...prev, [rec.id]: true }));
        saveMutation.mutate({ rec, ann });
    };

    if (isLoading) return <PageMsg>Cargando registros...</PageMsg>;
    if (error) return <PageMsg>Error al cargar: {String(error)}</PageMsg>;

    const { records, total, pending, done } = data!;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    return (
        <div style={S.page}>
            <div style={S.topbar}>
                <span style={S.topbarTitle}>Etiquetado de sentimiento</span>
                <span style={S.badge}>{pending} pendientes</span>
            </div>

            <div style={S.content}>
                <div style={S.progressCard}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 11, color: "#6b7080" }}>Progreso</span>
                        <span style={{ fontSize: 11, fontFamily: "monospace", color: "#dde1ec" }}>{pct}%  ({done}/{total})</span>
                    </div>
                    <div style={S.progressTrack}><div style={{ ...S.progressFill, width: `${pct}%` }} /></div>
                    <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 10, color: "#6b7080" }}>
                        <span>✓ {done} anotados</span>
                        <span>◻ {Math.max(0, pending)} pendientes</span>
                    </div>
                </div>

                {records.length === 0 && (
                    <div style={S.emptyState}>
                        <div style={{ fontSize: 28, marginBottom: 8 }}>🎉</div>
                        <div style={{ fontWeight: 500, color: "#dde1ec" }}>¡Todo revisado!</div>
                        <div style={{ fontSize: 12, color: "#6b7080", marginTop: 4 }}>No quedan registros pendientes</div>
                    </div>
                )}

                {records.map((rec) => {
                    const ann = annotations[rec.id] ?? {};
                    const lockErr = lockErrors[rec.id];
                    const isLocked = rec.locked_by_other;
                    const hasLock = lockMutation.variables === rec.id && lockMutation.isSuccess;
                    const currentSent = ann.corrected_sentiment ?? rec.sentiment_llm ?? 2;
                    const isCorr = currentSent !== rec.sentiment_llm;

                    return (
                        <div key={rec.id} style={S.recordCard}>
                            <div style={S.recordMeta}>
                                <span style={{ ...S.platBadge, color: platColor(rec.platform) }}>{platIcon(rec.platform)} {rec.platform ?? "?"}</span>
                                {rec.tipo && <span style={S.tipoBadge}>{rec.tipo}</span>}
                                <span style={{ fontSize: 10, color: "#6b7080" }}>{rec.fecha}</span>
                                <span style={{ ...S.sentBadge, color: sentColor(rec.sentiment_llm) }}>IA: {sentLabel(rec.sentiment_llm)}</span>
                                {worldBadge(rec)}
                            </div>

                            {isLocked && !lockErr && (
                                <div style={S.lockWarn}>
                                    🔒 Este registro está siendo anotado por otra persona.
                                    {rec.locked_until && ` Lock expira: ${new Date(rec.locked_until).toLocaleTimeString()}`}
                                </div>
                            )}
                            {lockErr && <div style={S.lockError}>⚠ {lockErr}</div>}

                            {(rec.titulo_padre || rec.cuerpo_padre || rec.tweet_anterior) && (
                                <div style={S.ctxBlock}>
                                    <div style={S.ctxLabel}>Contexto del modelo</div>
                                    {rec.titulo_padre && <div style={S.ctxLine}><strong>[Título]</strong> {rec.titulo_padre}</div>}
                                    {rec.cuerpo_padre && <div style={S.ctxLine}><strong>[Cuerpo]</strong> {rec.cuerpo_padre.slice(0, 200)}</div>}
                                    {rec.tweet_anterior && <div style={S.ctxLine}><strong>[Post anterior]</strong> {rec.tweet_anterior.slice(0, 200)}</div>}
                                </div>
                            )}

                            <div style={{ fontSize: 9, textTransform: "uppercase" as const, letterSpacing: "0.1em", color: "#6b7080", marginBottom: 3 }}>[Contenido a clasificar]</div>
                            <div style={{ ...S.contentBlock, borderLeftColor: sentColor(rec.sentiment_llm) }}>{rec.content}</div>

                            {!isLocked && !hasLock && !lockErr && (
                                <button style={S.lockBtn} onClick={() => lockMutation.mutate(rec.id)} disabled={lockMutation.isPending}>
                                    🔓 Abrir para anotar
                                </button>
                            )}

                            {(hasLock || (!rec.locked_by_other && !lockErr)) && (
                                <>
                                    <div style={S.sentBtns}>
                                        {SENT_OPTS.map((opt) => (
                                            <button key={opt.v}
                                                style={{ ...S.sentBtn, ...(currentSent === opt.v ? { borderColor: opt.color, color: opt.color, background: opt.color + "18" } : {}) }}
                                                onClick={() => setAnnotations((prev) => ({ ...prev, [rec.id]: { ...prev[rec.id], corrected_sentiment: opt.v } }))}>
                                                <span style={{ display: "block", fontSize: 16 }}>{opt.icon}</span>{opt.label}
                                            </button>
                                        ))}
                                    </div>

                                    {isCorr && (
                                        <div style={{ marginTop: 8 }}>
                                            <div style={{ fontSize: 10, color: "#e8962a", marginBottom: 4 }}>⚑ Motivo de la corrección:</div>
                                            <textarea style={S.textarea} rows={2}
                                                placeholder="Ej: El texto es irónico, el modelo no lo detectó..."
                                                value={ann.correction_reason ?? ""}
                                                onChange={(e) => setAnnotations((prev) => ({ ...prev, [rec.id]: { ...prev[rec.id], correction_reason: e.target.value } }))} />
                                        </div>
                                    )}

                                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #252830" }}>
                                        <label style={{ ...S.label, color: "#28bfb0" }}>Tema/topic</label>
                                        <input style={S.input}
                                            value={ann.corrected_topic ?? rec.topic_llm ?? ""}
                                            onChange={(e) => setAnnotations((prev) => ({ ...prev, [rec.id]: { ...prev[rec.id], corrected_topic: e.target.value } }))} />
                                        {ann.corrected_topic && ann.corrected_topic !== rec.topic_llm && (
                                            <textarea style={{ ...S.textarea, marginTop: 4 }} rows={1}
                                                placeholder="Motivo del cambio de tema..."
                                                value={ann.topic_reason ?? ""}
                                                onChange={(e) => setAnnotations((prev) => ({ ...prev, [rec.id]: { ...prev[rec.id], topic_reason: e.target.value } }))} />
                                        )}
                                    </div>

                                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                                        <button style={S.saveBtn} onClick={() => handleSave(rec)} disabled={saving[rec.id]}>
                                            {saving[rec.id] ? "Guardando..." : "Guardar y siguiente →"}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    );
                })}

                {total > LIMIT && (
                    <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 8 }}>
                        <button style={S.pageBtn} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>← Anterior</button>
                        <button style={S.pageBtn} disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}>Siguiente →</button>
                    </div>
                )}
            </div>

            {toast && (
                <div style={{ ...S.toast, color: toast.type === "warn" ? "#e8962a" : "#2ec27e" }}>
                    {toast.type === "warn" ? "⚠ " : "✓ "}{toast.msg}
                </div>
            )}
        </div>
    );
}

function PageMsg({ children }: { children: React.ReactNode }) {
    return <div style={{ padding: 40, color: "#6b7080", fontSize: 13 }}>{children}</div>;
}

const sentColor = (v?: number) => ({ 1: "#2ec27e", "-1": "#e05252", 0: "#6b7080", 2: "#30343f" }[String(v ?? 2)] ?? "#6b7080");
const platColor = (p?: string) => ({ reddit: "#ff4500", bluesky: "#0085ff", youtube: "#ff0000", twitter: "#1da1f2" }[(p ?? "").toLowerCase()] ?? "#6b7080");
const platIcon = (p?: string) => ({ reddit: "🔴", bluesky: "🔵", youtube: "▶", twitter: "🐦" }[(p ?? "").toLowerCase()] ?? "🌐");

const S: Record<string, React.CSSProperties> = {
    page: { display: "flex", flexDirection: "column", height: "100vh", background: "#0a0b0e" },
    topbar: { height: 48, background: "#111318", borderBottom: "1px solid #252830", display: "flex", alignItems: "center", padding: "0 22px", gap: 12, flexShrink: 0 },
    topbarTitle: { fontSize: 13, fontWeight: 500, color: "#dde1ec", flex: 1 },
    badge: { fontSize: 10, padding: "2px 8px", borderRadius: 100, background: "#181b22", border: "1px solid #252830", color: "#6b7080", fontFamily: "monospace" },
    content: { flex: 1, overflowY: "auto", padding: 22, maxWidth: 900 },
    progressCard: { background: "#181b22", border: "1px solid #252830", borderRadius: 8, padding: 14, marginBottom: 18 },
    progressTrack: { height: 3, background: "#252830", borderRadius: 2, overflow: "hidden" },
    progressFill: { height: "100%", background: "#4e7bef", borderRadius: 2, transition: "width 0.3s" },
    recordCard: { background: "#111318", border: "1px solid #252830", borderRadius: 12, padding: 16, marginBottom: 12 },
    recordMeta: { display: "flex", alignItems: "center", gap: 7, marginBottom: 10, flexWrap: "wrap" as const },
    platBadge: { fontSize: 12, fontWeight: 600 },
    tipoBadge: { fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "rgba(78,123,239,0.12)", color: "#7a9bf5", border: "1px solid rgba(78,123,239,0.25)", fontFamily: "monospace", fontWeight: 700 },
    sentBadge: { fontSize: 9, padding: "2px 7px", borderRadius: 100, fontFamily: "monospace", fontWeight: 600, border: "1px solid #30343f" },
    lockWarn: { background: "rgba(232,150,42,0.1)", border: "1px solid rgba(232,150,42,0.3)", borderRadius: 6, padding: "8px 10px", fontSize: 12, color: "#e8962a", marginBottom: 10 },
    lockError: { background: "rgba(224,82,82,0.1)", border: "1px solid rgba(224,82,82,0.3)", borderRadius: 6, padding: "8px 10px", fontSize: 12, color: "#e05252", marginBottom: 10 },
    ctxBlock: { background: "#0a0b0e", border: "1px solid #252830", borderRadius: 6, padding: "10px 12px", marginBottom: 10, fontSize: 11 },
    ctxLabel: { fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "#6b7080", fontWeight: 600, marginBottom: 5 },
    ctxLine: { borderLeft: "2px solid #30343f", paddingLeft: 8, color: "#6b7080", marginBottom: 3 },
    contentBlock: { fontSize: 13, lineHeight: 1.7, color: "#dde1ec", background: "#181b22", borderRadius: 6, padding: 12, margin: "10px 0", borderLeft: "3px solid #30343f" },
    sentBtns: { display: "flex", gap: 6, flexWrap: "wrap" as const, margin: "8px 0" },
    sentBtn: { flex: 1, minWidth: 70, padding: "9px 6px", borderRadius: 6, border: "1.5px solid #252830", fontSize: 11, fontWeight: 500, cursor: "pointer", textAlign: "center" as const, background: "#181b22", color: "#6b7080" },
    lockBtn: { marginTop: 8, padding: "7px 14px", borderRadius: 6, border: "1px solid #252830", background: "transparent", color: "#6b7080", fontSize: 12, cursor: "pointer" },
    textarea: { background: "#0a0b0e", border: "1px solid #252830", borderRadius: 6, color: "#dde1ec", padding: "7px 10px", fontSize: 11, width: "100%", resize: "vertical" as const },
    label: { fontSize: 11, color: "#6b7080", fontWeight: 500, display: "block", marginBottom: 4 },
    input: { background: "#0a0b0e", border: "1px solid #252830", borderRadius: 6, color: "#dde1ec", padding: "7px 10px", fontSize: 12, width: "100%" },
    saveBtn: { padding: "7px 14px", borderRadius: 6, background: "#4e7bef", color: "#fff", border: "none", fontSize: 12, fontWeight: 500, cursor: "pointer" },
    pageBtn: { padding: "6px 12px", borderRadius: 6, border: "1px solid #252830", background: "transparent", color: "#6b7080", fontSize: 12, cursor: "pointer" },
    emptyState: { textAlign: "center" as const, padding: "48px 20px", color: "#6b7080" },
    toast: { position: "fixed" as const, bottom: 20, right: 20, background: "#181b22", border: "1px solid #30343f", borderRadius: 8, padding: "10px 16px", fontSize: 12, zIndex: 200 },
};