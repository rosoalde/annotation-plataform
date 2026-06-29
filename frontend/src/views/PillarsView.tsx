import { useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { recordsApi, annotationsApi, LockConflictError } from "../services/api";
import type { Record as AnnotRecord } from "../types";

const PILLARS = [
    { key: "legitimacion", label: "Legitimación", color: "var(--accent2)" },
    { key: "efectividad", label: "Efectividad", color: "var(--green)" },
    { key: "justicia_equidad", label: "Justicia y equidad", color: "var(--teal)" },
    { key: "confianza_institucional", label: "Confianza instit.", color: "var(--purple)" },
] as const;

const pillarLabel = (v?: number | null) => ({ 1: "+1", "-1": "−1", 0: "0", 2: "N/A" }[String(v ?? "")] ?? "—");

const S: Record<string, React.CSSProperties> = {
    page: { display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)" },
    topbar: { height: 48, background: "var(--surface)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", padding: "0 22px", gap: 12, flexShrink: 0 },
    content: { flex: 1, overflowY: "auto", padding: 22, maxWidth: 900 },
    recCard: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r2)", padding: 16, marginBottom: 12 },
    ctxBlock: { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: "10px 12px", marginBottom: 10, fontSize: 11 },
    ctxLabel: { fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "var(--muted)", fontWeight: 600, marginBottom: 5 },
    ctxLine: { borderLeft: "2px solid var(--border2)", paddingLeft: 8, color: "var(--muted)", marginBottom: 3 },
    toast: { position: "fixed" as const, bottom: 20, right: 20, background: "var(--card)", border: "1px solid var(--border2)", borderRadius: "var(--r)", padding: "10px 16px", fontSize: 12, zIndex: 200 },
};

type PillarAnn = Record<string, { value?: number; reason?: string; is_correction?: boolean }>;

export default function PillarsView() {
    const { id: projectId } = useParams<{ id: string }>();
    const qc = useQueryClient();
    const [offset, setOffset] = useState(0);
    const [annotations, setAnnotations] = useState<Record<string, PillarAnn>>({});
    const [saving, setSaving] = useState<Record<string, boolean>>({});
    const [lockErrors, setLockErrors] = useState<Record<string, string>>({});
    const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

    const LIMIT = 20;

    const showToast = useCallback((msg: string, ok = true) => {
        setToast({ msg, ok });
        setTimeout(() => setToast(null), 2600);
    }, []);

    const { data, isLoading } = useQuery({
        queryKey: ["records", projectId, "pillar", offset],
        queryFn: () => recordsApi.list(projectId!, { annotation_type: "pillar", limit: LIMIT, offset }),
        enabled: !!projectId,
    });

    const lockMutation = useMutation({
        mutationFn: (recordId: string) => recordsApi.acquireLock(projectId!, recordId),
        onError: (err, recordId) => {
            const msg = err instanceof LockConflictError ? err.message : "Error al adquirir el lock";
            setLockErrors((p) => ({ ...p, [recordId]: msg }));
        },
        onSuccess: (_, recordId) => {
            setLockErrors((p) => { const n = { ...p }; delete n[recordId]; return n; });
        },
    });

    const saveMutation = useMutation({
        mutationFn: async ({ rec, pann }: { rec: AnnotRecord; pann: PillarAnn }) => {
            for (const p of PILLARS) {
                const pa = pann[p.key];
                if (!pa || pa.value === undefined) continue;
                await annotationsApi.savePillar(projectId!, {
                    record_id: rec.id, project_id: projectId!, pillar: p.key,
                    original_value: (rec as any)[p.key] ?? 2, corrected_value: pa.value,
                    is_correction: pa.is_correction ?? false, correction_reason: pa.reason ?? undefined,
                });
            }
        },
        onSuccess: (_, { rec }) => {
            setSaving((p) => { const n = { ...p }; delete n[rec.id]; return n; });
            qc.invalidateQueries({ queryKey: ["records", projectId, "pillar"] });
            showToast("Pilares guardados ✓");
        },
        onError: (_, { rec }) => {
            setSaving((p) => { const n = { ...p }; delete n[rec.id]; return n; });
            showToast("Error al guardar", false);
        },
    });

    const handleSave = async (rec: AnnotRecord) => {
        const pann = annotations[rec.id] ?? {};
        for (const p of PILLARS) {
            if (pann[p.key]?.is_correction && !pann[p.key]?.reason) {
                showToast(`Escribe el motivo para "${p.label}"`, false);
                return;
            }
        }
        setSaving((p) => ({ ...p, [rec.id]: true }));
        saveMutation.mutate({ rec, pann });
    };

    if (isLoading) return <div style={{ padding: 40, color: "var(--muted)" }}>Cargando...</div>;

    const { records, total, pending, done } = data!;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    return (
        <div style={S.page}>
            <div style={S.topbar}>
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", flex: 1 }}>Pilares de aceptación</span>
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 100, background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)", fontFamily: "monospace" }}>{pending} pendientes</span>
            </div>

            <div style={S.content}>
                <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: 14, marginBottom: 18 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>Progreso</span>
                        <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text)" }}>{pct}% ({done}/{total})</span>
                    </div>
                    <div style={{ height: 3, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: "var(--teal)", borderRadius: 2, transition: "width 0.3s" }} />
                    </div>
                </div>

                {records.length === 0 && (
                    <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--muted)" }}>
                        <div style={{ fontSize: 28, marginBottom: 8 }}>🏛</div>
                        <div style={{ fontWeight: 500, color: "var(--text)" }}>¡Todo revisado!</div>
                    </div>
                )}

                {records.map((rec) => {
                    const pann = annotations[rec.id] ?? {};
                    const lockErr = lockErrors[rec.id];
                    const hasLock = lockMutation.variables === rec.id && lockMutation.isSuccess;

                    return (
                        <div key={rec.id} style={S.recCard}>
                            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" as const, alignItems: "center" }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>{rec.platform}</span>
                                {rec.fecha && <span style={{ fontSize: 10, color: "var(--muted)" }}>{rec.fecha}</span>}
                                {rec.world_country && (
                                    <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 100, background: "rgba(40,191,176,0.1)", color: "var(--teal)", border: "1px solid rgba(40,191,176,0.25)", fontFamily: "monospace" }}>
                                        🌍 {[rec.world_city, rec.world_country].filter(Boolean).join(", ")}
                                    </span>
                                )}
                            </div>

                            {rec.locked_by_other && !lockErr && (
                                <div style={{ background: "rgba(232,150,42,0.1)", border: "1px solid rgba(232,150,42,0.3)", borderRadius: "var(--r)", padding: "8px 10px", fontSize: 12, color: "var(--amber)", marginBottom: 10 }}>
                                    🔒 Bloqueado por otro usuario{rec.locked_until && ` hasta ${new Date(rec.locked_until).toLocaleTimeString()}`}
                                </div>
                            )}
                            {lockErr && <div style={{ background: "rgba(224,82,82,0.1)", border: "1px solid rgba(224,82,82,0.3)", borderRadius: "var(--r)", padding: "8px 10px", fontSize: 12, color: "var(--red)", marginBottom: 10 }}>⚠ {lockErr}</div>}

                            <div style={{ fontSize: 9, textTransform: "uppercase" as const, letterSpacing: "0.1em", color: "var(--muted)", marginBottom: 3 }}>[Contenido a clasificar]</div>
                            <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--text)", background: "var(--card)", borderRadius: "var(--r)", padding: 12, margin: "8px 0 12px", borderLeft: "3px solid var(--teal)" }}>
                                {rec.content}
                            </div>

                            {!rec.locked_by_other && !hasLock && !lockErr && (
                                <button onClick={() => lockMutation.mutate(rec.id)} disabled={lockMutation.isPending}
                                    style={{ marginBottom: 10, padding: "6px 12px", borderRadius: "var(--r)", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer" }}>
                                    🔓 Abrir para anotar
                                </button>
                            )}

                            {/* URL directa al post */}
                            {rec.url_post && (
                                <div style={{ marginBottom: 8 }}>
                                    <a href={rec.url_post} target="_blank" rel="noopener noreferrer"
                                        style={{ fontSize: 11, color: "var(--teal)", textDecoration: "none" }}>
                                        🔗 Ver post original en {rec.platform || "la plataforma"} ↗
                                    </a>
                                </div>
                            )}

                            {/* Post raíz: solo si hay cuerpo_padre (indica que es un comentario) */}
                            {rec.cuerpo_padre && (
                                <div style={{ ...S.ctxBlock, borderLeft: "2px solid var(--purple)" }}>
                                    <div style={S.ctxLabel}>Post raíz (contexto)</div>
                                    {rec.titulo_padre && (
                                        <div style={S.ctxLine}><strong>[Título]</strong> {rec.titulo_padre}</div>
                                    )}
                                    <div style={{ ...S.ctxLine, color: "var(--muted)" }}>
                                        {rec.cuerpo_padre.slice(0, 300)}{rec.cuerpo_padre.length > 300 ? "…" : ""}
                                    </div>
                                </div>
                            )}

                            {(hasLock || (!rec.locked_by_other && !lockErr)) && (
                                <>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                                        {PILLARS.map((p) => {
                                            const llmVal = (rec as any)[p.key] as number | undefined;
                                            const pa = pann[p.key] ?? {};
                                            const sel = pa.value !== undefined ? pa.value : llmVal;
                                            return (
                                                <div key={p.key} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: 10 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 600, color: p.color, marginBottom: 6 }}>{p.label}</div>
                                                    <div style={{ display: "flex", gap: 4 }}>
                                                        {[{ v: 1, l: "+1" }, { v: 0, l: "0" }, { v: -1, l: "−1" }, { v: 2, l: "N/A" }].map((btn) => (
                                                            <button key={btn.v}
                                                                style={{ flex: 1, padding: "5px 2px", borderRadius: 5, border: `1.5px solid ${sel === btn.v ? p.color : "var(--border)"}`, fontSize: 11, fontWeight: 500, background: sel === btn.v ? p.color + "18" : "var(--surface)", color: sel === btn.v ? p.color : "var(--muted)", cursor: "pointer" }}
                                                                onClick={() => {
                                                                    const isCorr = btn.v !== llmVal;
                                                                    setAnnotations((prev) => ({ ...prev, [rec.id]: { ...prev[rec.id], [p.key]: { ...prev[rec.id]?.[p.key], value: btn.v, is_correction: isCorr } } }));
                                                                }}>
                                                                {btn.l}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace", marginTop: 4 }}>IA: {pillarLabel(llmVal)}</div>
                                                    {pa.is_correction && (
                                                        <textarea rows={1} placeholder="Motivo..." value={pa.reason ?? ""}
                                                            onChange={(e) => setAnnotations((prev) => ({ ...prev, [rec.id]: { ...prev[rec.id], [p.key]: { ...prev[rec.id]?.[p.key], reason: e.target.value } } }))}
                                                            style={{ marginTop: 5, fontSize: 11, width: "100%", minHeight: 32, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)", padding: "4px 6px" }} />
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                        <button onClick={() => handleSave(rec)} disabled={saving[rec.id]}
                                            style={{ padding: "7px 14px", borderRadius: "var(--r)", background: "var(--teal)", color: "#fff", border: "none", fontSize: 12, fontWeight: 500, cursor: "pointer" }}>
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
                        <button style={{ padding: "6px 12px", borderRadius: "var(--r)", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 12, cursor: "pointer" }} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>← Anterior</button>
                        <button style={{ padding: "6px 12px", borderRadius: "var(--r)", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 12, cursor: "pointer" }} disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}>Siguiente →</button>
                    </div>
                )}
            </div>

            {toast && <div style={{ ...S.toast, color: toast.ok ? "var(--green)" : "var(--amber)" }}>{toast.ok ? "✓ " : "⚠ "}{toast.msg}</div>}
        </div>
    );
}