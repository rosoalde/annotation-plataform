import React, { useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { recordsApi, annotationsApi, LockConflictError } from "../services/api";
import type { Record as AnnotRecord } from "../types";
import ProjectContextBar from "../components/ProjectContextBar";
import COUNTRIES_RAW from "../assets/talkwalker_countries.json";
import LANGUAGES_RAW from "../assets/talkwalker_languages.json";

const SENT_OPTS = [
    { v: 1, icon: "↑", label: "Positivo", color: "#2ec27e" },
    { v: -1, icon: "↓", label: "Negativo", color: "#e05252" },
    { v: 0, icon: "→", label: "Neutro", color: "#6b7080" },
    { v: 2, icon: "✕", label: "No relac.", color: "#30343f" },
];
const sentLabel = (v?: number) => SENT_OPTS.find((o) => o.v === v)?.label ?? String(v ?? "—");
const sentColor = (v?: number) => ({ 1: "#2ec27e", "-1": "#e05252", 0: "#6b7080", 2: "#30343f" }[String(v ?? 2)] ?? "#6b7080");
const platColor = (p?: string) => ({ reddit: "#ff4500", bluesky: "#0085ff", youtube: "#ff0000", twitter: "#1da1f2" }[(p ?? "").toLowerCase()] ?? "#6b7080");
const platIcon = (p?: string) => ({ reddit: "🔴", bluesky: "🔵", youtube: "▶", twitter: "🐦" }[(p ?? "").toLowerCase()] ?? "🌐");

const PILARS = [
    { key: "legitimacion", label: "Legitimación", justifKey: "justif_legitimacion", color: "#7a9bf5" },
    { key: "efectividad", label: "Efectividad", justifKey: "justif_efectividad", color: "#2ec27e" },
    { key: "justicia_equidad", label: "Justicia y equidad", justifKey: "justif_justicia_equidad", color: "#28bfb0" },
    { key: "confianza_institucional", label: "Confianza instit.", justifKey: "justif_confianza_institucional", color: "#9b72ef" },
] as const;
const pilarLabel = (v?: number | null) => ({ 1: "+1", "-1": "−1", 0: "0", 2: "N/A" }[String(v ?? "")] ?? "—");

// Opciones para desplegables — extraídas de los recursos de la plataforma
const PERTINENCIA_OPTS = ["relevante", "irrelevante"];
const POSICION_OPTS = [
    { v: "1", label: "1 — A favor / Pro" },
    { v: "0", label: "0 — Neutro / Mixto" },
    { v: "-1", label: "-1 — En contra / Anti" },
    { v: "2", label: "2 — Sin postura inferible" },
];
// Se cargan dinámicamente desde /api/resources/* para no hardcodear 250 países
// Por ahora ponemos los más frecuentes; el backend puede exponerlos si se desea
const CONTINENT_OPTS = ["EU", "NA", "SA", "AF", "AS", "OC", "N/A"];


// Campos de texto genéricos: se guardan vía POST /annotations/field.
// justifKey es null cuando ese campo no tiene una justificación dedicada del LLM.
const TEXT_FIELDS: Array<{ key: string; label: string; justifKey: string | null }> = [
    { key: "pertinencia", label: "Pertinencia", justifKey: "justif_pertinencia" },
    { key: "posicion", label: "Posición", justifKey: "justif_posicion" },
    { key: "lang", label: "Idioma", justifKey: "justif_lang" },
    { key: "world_continent", label: "Continente", justifKey: "justif_continente" },
    { key: "world_country", label: "País", justifKey: "justif_pais" },
    { key: "world_region", label: "Región", justifKey: "justif_region" },
    { key: "world_city", label: "Ciudad", justifKey: "justif_ciudad" },
    // { key: "codigo_pais", label: "Código país (ISO)", justifKey: null },
];

type FieldState = { value?: string; reason?: string };
type RecordAnn = {
    sentiment?: number;
    sentiment_reason?: string;
    topic?: string;
    topic_reason?: string;
    pilars: Record<string, { value?: number; reason?: string }>;
    fields: Record<string, FieldState>;
};
const emptyAnn = (): RecordAnn => ({ pilars: {}, fields: {} });

export default function AnnotateView() {
    const { id: projectId } = useParams<{ id: string }>();
    const qc = useQueryClient();

    const [offset, setOffset] = useState(0);
    const LIMIT = 10;

    const [annotations, setAnnotations] = useState<Record<string, RecordAnn>>({});
    const [lockedIds, setLockedIds] = useState<Set<string>>(new Set());
    const [lockErrors, setLockErrors] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState<Record<string, boolean>>({});
    const [toast, setToast] = useState<{ msg: string; type?: "ok" | "warn" } | null>(null);

    const showToast = useCallback((msg: string, type: "ok" | "warn" = "ok") => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 2600);
    }, []);

    const { data, isLoading, error } = useQuery({
        queryKey: ["records", projectId, "annotate", offset],
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
            setLockedIds((prev) => new Set(prev).add(recordId));
        },
    });

    const saveMutation = useMutation({
        mutationFn: async ({ rec, ann }: { rec: AnnotRecord; ann: RecordAnn }) => {
            const correctedSentiment = ann.sentiment ?? rec.sentiment_llm ?? 2;
            const correctedTopic = ann.topic ?? rec.topic_llm ?? undefined;

            const calls: Promise<unknown>[] = [
                annotationsApi.saveSentiment(projectId!, {
                    record_id: rec.id, project_id: projectId!,
                    original_sentiment: rec.sentiment_llm ?? 2, corrected_sentiment: correctedSentiment,
                    is_correction: correctedSentiment !== rec.sentiment_llm,
                    correction_reason: ann.sentiment_reason ?? undefined,
                    original_topic: rec.topic_llm ?? undefined, corrected_topic: correctedTopic,
                    topic_reason: ann.topic_reason ?? undefined,
                }),
            ];

            for (const p of PILARS) {
                const pa = ann.pilars[p.key];
                if (!pa || pa.value === undefined) continue;
                const llmVal = (rec as any)[p.key] as number | undefined;
                calls.push(annotationsApi.savePilar(projectId!, {
                    record_id: rec.id, project_id: projectId!, pilar: p.key,
                    original_value: llmVal ?? 2, corrected_value: pa.value,
                    is_correction: pa.value !== llmVal, correction_reason: pa.reason ?? undefined,
                }));
            }

            for (const f of TEXT_FIELDS) {
                const fa = ann.fields[f.key];
                if (!fa || fa.value === undefined) continue;
                const llmVal = ((rec as any)[f.key] as string | undefined) ?? "";
                calls.push(annotationsApi.saveField(projectId!, {
                    record_id: rec.id, project_id: projectId!, field_name: f.key,
                    original_text: llmVal, corrected_text: fa.value,
                    is_correction: fa.value !== llmVal, correction_reason: fa.reason ?? undefined,
                }));
            }

            await Promise.all(calls);
        },
        onSuccess: (_, { rec }) => {
            setSaving((prev) => { const n = { ...prev }; delete n[rec.id]; return n; });
            setAnnotations((prev) => { const n = { ...prev }; delete n[rec.id]; return n; });
            qc.invalidateQueries({ queryKey: ["records", projectId, "annotate"] });
            showToast("Guardado ✓");
        },
        onError: (_, { rec }) => {
            setSaving((prev) => { const n = { ...prev }; delete n[rec.id]; return n; });
            showToast("Error al guardar", "warn");
        },
    });

    const getAnn = (recId: string) => annotations[recId] ?? emptyAnn();
    const setAnn = (recId: string, patch: Partial<RecordAnn>) =>
        setAnnotations((prev) => ({ ...prev, [recId]: { ...emptyAnn(), ...prev[recId], ...patch } }));
    const setPilar = (recId: string, key: string, patch: { value?: number; reason?: string }) =>
        setAnnotations((prev) => {
            const cur = prev[recId] ?? emptyAnn();
            return { ...prev, [recId]: { ...cur, pilars: { ...cur.pilars, [key]: { ...cur.pilars[key], ...patch } } } };
        });
    const setField = (recId: string, key: string, patch: FieldState) =>
        setAnnotations((prev) => {
            const cur = prev[recId] ?? emptyAnn();
            return { ...prev, [recId]: { ...cur, fields: { ...cur.fields, [key]: { ...cur.fields[key], ...patch } } } };
        });

    const handleSave = (rec: AnnotRecord) => {
        const ann = getAnn(rec.id);

        const unconfirmed = TEXT_FIELDS.filter(f => {
            const llmVal = ((rec as any)[f.key] as string | undefined) ?? "";
            const fa = ann.fields[f.key];
            return llmVal && fa?.value === undefined;
        });

        if (unconfirmed.length > 0) {
            const names = unconfirmed.map(f => f.label).join(", ");

            const ok = window.confirm(
                `⚠ Los siguientes campos tienen valor del LLM pero no has revisado ni confirmado:\n\n${names}\n\n¿Guardar igualmente?`
            );

            if (!ok) return;
        }


        const sentCorrected = (ann.sentiment ?? rec.sentiment_llm ?? 2) !== rec.sentiment_llm;
        if (sentCorrected && !ann.sentiment_reason) { showToast("Falta el motivo de la corrección de sentimiento", "warn"); return; }
        for (const p of PILARS) {
            const pa = ann.pilars[p.key];
            if (pa && pa.value !== undefined && pa.value !== (rec as any)[p.key] && !pa.reason) {
                showToast(`Falta el motivo para "${p.label}"`, "warn"); return;
            }
        }
        for (const f of TEXT_FIELDS) {
            const fa = ann.fields[f.key];
            const llmVal = ((rec as any)[f.key] as string | undefined) ?? "";
            if (fa && fa.value !== undefined && fa.value !== llmVal && !fa.reason) {
                showToast(`Falta el motivo para "${f.label}"`, "warn"); return;
            }
        }
        setSaving((prev) => ({ ...prev, [rec.id]: true }));
        saveMutation.mutate({ rec, ann });
    };

    if (isLoading) return <PageMsg>Cargando registros...</PageMsg>;
    if (error) return <PageMsg>Error al cargar: {String(error)}</PageMsg>;
    if (!projectId) return <PageMsg>Falta el proyecto</PageMsg>;

    const { records, total, pending, done } = data!;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    return (
        <div style={S.page}>
            <div style={S.topbar}>
                <span style={S.topbarTitle}>Anotar</span>
                <span style={S.badge}>{pending} pendientes</span>
            </div>

            <div style={S.content}>
                <ProjectContextBar projectId={projectId} />

                <div style={S.progressCard}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 11, color: "#6b7080" }}>Progreso</span>
                        <span style={{ fontSize: 11, fontFamily: "monospace", color: "#dde1ec" }}>{pct}%  ({done}/{total})</span>
                    </div>
                    <div style={S.progressTrack}><div style={{ ...S.progressFill, width: `${pct}%` }} /></div>
                </div>

                {records.length === 0 && (
                    <div style={S.emptyState}>
                        <div style={{ fontSize: 28, marginBottom: 8 }}>🎉</div>
                        <div style={{ fontWeight: 500, color: "#dde1ec" }}>¡Todo anotado por ti!</div>
                        <div style={{ fontSize: 12, color: "#6b7080", marginTop: 4 }}>No quedan registros pendientes en esta página.</div>
                    </div>
                )}

                {records.map((rec) => {
                    const ann = getAnn(rec.id);
                    const lockErr = lockErrors[rec.id];
                    const isLocked = rec.locked_by_other;
                    const hasLock = lockedIds.has(rec.id);
                    const unlocked = hasLock && !isLocked;
                    const currentSent = ann.sentiment ?? rec.sentiment_llm ?? 2;

                    return (
                        <div key={rec.id} style={S.recordCard}>
                            {/* Metadatos + contenido */}
                            <div style={S.recordMeta}>
                                <span style={{ ...S.platBadge, color: platColor(rec.platform) }}>{platIcon(rec.platform)} {rec.platform ?? "?"}</span>
                                {rec.tipo && <span style={S.tipoBadge}>{rec.tipo}</span>}
                                <span style={{ fontSize: 10, color: "#6b7080" }}>{rec.fecha}</span>
                                {(rec.world_city || rec.world_country || rec.lang) && (
                                    <span style={S.worldBadge}>
                                        🌍 {[rec.world_city, rec.world_country].filter(Boolean).join(", ") || "—"}{rec.lang ? ` · ${rec.lang}` : ""}
                                    </span>
                                )}
                            </div>

                            {isLocked && !lockErr && (
                                <div style={S.lockWarn}>
                                    🔒 Este registro está siendo anotado por otra persona.
                                    {rec.locked_until && ` Lock expira: ${new Date(rec.locked_until).toLocaleTimeString()}`}
                                </div>
                            )}
                            {lockErr && <div style={S.lockError}>⚠ {lockErr}</div>}

                            {rec.url_post && (
                                <div style={{ marginBottom: 8 }}>
                                    <a href={rec.url_post} target="_blank" rel="noopener noreferrer" style={S.link}>
                                        🔗 Ver post original en {rec.platform || "la plataforma"} ↗
                                    </a>
                                </div>
                            )}

                            {rec.cuerpo_padre && (
                                <div style={{ ...S.ctxBlock, borderLeft: "2px solid #9b72ef" }}>
                                    <div style={S.ctxLabel}>Post raíz (contexto)</div>
                                    {rec.titulo_padre && <div style={S.ctxLine}><strong>[Título]</strong> {rec.titulo_padre}</div>}
                                    <div style={{ ...S.ctxLine, color: "#6b7080" }}>
                                        {rec.cuerpo_padre.slice(0, 300)}{rec.cuerpo_padre.length > 300 ? "…" : ""}
                                    </div>
                                </div>
                            )}

                            <div style={S.sectionLabel}>Contenido a clasificar</div>
                            <div style={{ ...S.contentBlock, borderLeftColor: sentColor(rec.sentiment_llm) }}>{rec.content}</div>

                            {!hasLock && !isLocked && !lockErr && (
                                <button style={S.lockBtn} onClick={() => lockMutation.mutate(rec.id)} disabled={lockMutation.isPending}>
                                    🔓 Abrir para anotar
                                </button>
                            )}

                            {unlocked && (
                                <>
                                    {/* Tema / topic */}
                                    <FieldGroup title="Tema / topic" llmValue={rec.topic_llm} justif={rec.justif_topic}>
                                        <input style={S.input}
                                            value={ann.topic ?? rec.topic_llm ?? ""}
                                            onChange={(e) => setAnn(rec.id, { topic: e.target.value })} />
                                        {ann.topic !== undefined && ann.topic !== rec.topic_llm && (
                                            <ReasonBox value={ann.topic_reason} onChange={(v) => setAnn(rec.id, { topic_reason: v })} />
                                        )}
                                    </FieldGroup>

                                    {/* Sentimiento */}
                                    <FieldGroup title="Sentimiento" llmValue={sentLabel(rec.sentiment_llm)} justif={rec.justif_sentimiento}>
                                        <div style={S.sentBtns}>
                                            {SENT_OPTS.map((opt) => (
                                                <button key={opt.v}
                                                    style={{ ...S.sentBtn, ...(currentSent === opt.v ? { borderColor: opt.color, color: opt.color, background: opt.color + "18" } : {}) }}
                                                    onClick={() => setAnn(rec.id, { sentiment: opt.v })}>
                                                    <span style={{ display: "block", fontSize: 16 }}>{opt.icon}</span>{opt.label}
                                                </button>
                                            ))}
                                        </div>
                                        {currentSent !== rec.sentiment_llm && (
                                            <ReasonBox value={ann.sentiment_reason} onChange={(v) => setAnn(rec.id, { sentiment_reason: v })} />
                                        )}
                                    </FieldGroup>



                                    {/* Pertinencia, posición, idioma, geolocalización, código país */}
                                    <div style={S.sectionLabel}>Pertinencia, posición, idioma y geolocalización</div>
                                    <div style={S.fieldGrid}>
                                        {TEXT_FIELDS.map((f) => {
                                            const llmVal = ((rec as any)[f.key] as string | undefined) ?? "";
                                            const fa = ann.fields[f.key] ?? {};
                                            const justif = f.justifKey ? ((rec as any)[f.justifKey] as string | undefined) : undefined;
                                            const current = fa.value ?? llmVal;
                                            return (
                                                <div key={f.key} style={S.smallCard}>
                                                    <div style={{ fontSize: 10, fontWeight: 600, color: "#28bfb0", marginBottom: 4 }}>{f.label}</div>
                                                    {justif && <div style={S.justifText}>“{justif}”</div>}
                                                    {/* Seleccionar tipo de control según el campo */}
                                                    {f.key === "pertinencia" ? (
                                                        <select style={{ ...S.input, marginTop: 6 }} value={current}
                                                            onChange={(e) => setField(rec.id, f.key, { value: e.target.value })}>
                                                            <option value="">— elige —</option>
                                                            {PERTINENCIA_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                                                        </select>
                                                    ) : f.key === "posicion" ? (
                                                        <select style={{ ...S.input, marginTop: 6 }} value={current}
                                                            onChange={(e) => setField(rec.id, f.key, { value: e.target.value })}>
                                                            <option value="">— elige —</option>
                                                            {POSICION_OPTS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                                                        </select>
                                                    ) : f.key === "world_continent" ? (
                                                        <select style={{ ...S.input, marginTop: 6 }} value={current}
                                                            onChange={(e) => setField(rec.id, f.key, { value: e.target.value })}>
                                                            <option value="">— elige —</option>
                                                            {CONTINENT_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                                                        </select>
                                                    ) : f.key === "world_country" ? (
                                                        <>
                                                            <input list={`countries-${rec.id}`} style={{ ...S.input, marginTop: 6 }} value={current}
                                                                onChange={(e) => setField(rec.id, f.key, { value: e.target.value })} />
                                                            <datalist id={`countries-${rec.id}`}>
                                                                {COUNTRIES_RAW.map((c: any) => (
                                                                    <option key={c.iso2} value={c.iso2}>{c.iso2} — {c.aliases[0]}</option>
                                                                ))}
                                                            </datalist>
                                                        </>
                                                    ) : f.key === "lang" ? (
                                                        <>
                                                            <input list={`langs-${rec.id}`} style={{ ...S.input, marginTop: 6 }} value={current}
                                                                onChange={(e) => setField(rec.id, f.key, { value: e.target.value })} />
                                                            <datalist id={`langs-${rec.id}`}>
                                                                {LANGUAGES_RAW.map((l: any) => (
                                                                    <option key={l.iso1} value={l.iso1}>{l.iso1} — {l.aliases[0]}</option>
                                                                ))}
                                                            </datalist>
                                                        </>
                                                    ) : (
                                                        <input style={{ ...S.input, marginTop: 6 }} value={current}
                                                            onChange={(e) => setField(rec.id, f.key, { value: e.target.value })} />
                                                    )}
                                                    <div style={S.iaTag}>IA: {llmVal || "—"}</div>
                                                    {current !== llmVal && (
                                                        <ReasonBox compact value={fa.reason} onChange={(v) => setField(rec.id, f.key, { reason: v })} />
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>



                                    {/* Pilares */}
                                    <div style={S.sectionLabel}>Pilares de aceptación</div>
                                    <div style={S.fieldGrid}>
                                        {PILARS.map((p) => {
                                            const llmVal = (rec as any)[p.key] as number | undefined;
                                            const pa = ann.pilars[p.key] ?? {};
                                            const sel = pa.value !== undefined ? pa.value : llmVal;
                                            const justif = (rec as any)[p.justifKey] as string | undefined;
                                            return (
                                                <div key={p.key} style={S.smallCard}>
                                                    <div style={{ fontSize: 10, fontWeight: 600, color: p.color, marginBottom: 4 }}>{p.label}</div>
                                                    {justif && <div style={S.justifText}>“{justif}”</div>}
                                                    <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                                                        {[{ v: 1, l: "+1" }, { v: 0, l: "0" }, { v: -1, l: "−1" }, { v: 2, l: "N/A" }].map((btn) => (
                                                            <button key={btn.v}
                                                                style={{ flex: 1, padding: "5px 2px", borderRadius: 5, border: `1.5px solid ${sel === btn.v ? p.color : "#252830"}`, fontSize: 11, fontWeight: 500, background: sel === btn.v ? p.color + "18" : "#181b22", color: sel === btn.v ? p.color : "#6b7080", cursor: "pointer" }}
                                                                onClick={() => setPilar(rec.id, p.key, { value: btn.v })}>
                                                                {btn.l}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <div style={S.iaTag}>IA: {pilarLabel(llmVal)}</div>
                                                    {sel !== llmVal && (
                                                        <ReasonBox compact value={pa.reason} onChange={(v) => setPilar(rec.id, p.key, { reason: v })} />
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
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

function FieldGroup({ title, llmValue, justif, children }: { title: string; llmValue?: string | number | null; justif?: string | null; children: React.ReactNode }) {
    return (
        <div style={{ marginBottom: 14, paddingTop: 10, borderTop: "1px solid #252830" }}>
            <div style={S.sectionLabel}>{title}</div>
            <div style={S.iaTag}>IA: {llmValue ?? "—"}</div>
            {justif && <div style={S.justifText}>“{justif}”</div>}
            <div style={{ marginTop: 6 }}>{children}</div>
        </div>
    );
}

function ReasonBox({ value, onChange, compact }: { value?: string; onChange: (v: string) => void; compact?: boolean }) {
    return (
        <textarea style={{ ...S.textarea, marginTop: 6 }} rows={compact ? 1 : 2}
            placeholder="Motivo de la corrección..."
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)} />
    );
}

function PageMsg({ children }: { children: React.ReactNode }) {
    return <div style={{ padding: 40, color: "#6b7080", fontSize: 13 }}>{children}</div>;
}

const S: Record<string, React.CSSProperties> = {
    page: { display: "flex", flexDirection: "column", height: "100vh", background: "#0a0b0e" },
    topbar: { height: 48, background: "#111318", borderBottom: "1px solid #252830", display: "flex", alignItems: "center", padding: "0 22px", gap: 12, flexShrink: 0 },
    topbarTitle: { fontSize: 13, fontWeight: 500, color: "#dde1ec", flex: 1 },
    badge: { fontSize: 10, padding: "2px 8px", borderRadius: 100, background: "#181b22", border: "1px solid var(--accent)", color: "var(--accent2)", fontFamily: "monospace" },
    content: { flex: 1, overflowY: "auto", padding: 22, maxWidth: 900 },
    progressCard: { background: "#181b22", border: "1px solid #252830", borderRadius: 8, padding: 14, marginBottom: 18 },
    progressTrack: { height: 3, background: "#252830", borderRadius: 2, overflow: "hidden" },
    progressFill: { height: "100%", background: "#4e7bef", borderRadius: 2, transition: "width 0.3s" },
    recordCard: { background: "#111318", border: "1px solid #252830", borderRadius: 12, padding: 16, marginBottom: 14 },
    recordMeta: { display: "flex", alignItems: "center", gap: 7, marginBottom: 10, flexWrap: "wrap" },
    platBadge: { fontSize: 12, fontWeight: 600 },
    tipoBadge: { fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "rgba(78,123,239,0.12)", color: "#7a9bf5", border: "1px solid rgba(78,123,239,0.25)", fontFamily: "monospace", fontWeight: 700 },
    worldBadge: { fontSize: 9, padding: "2px 7px", borderRadius: 100, background: "rgba(40,191,176,0.1)", color: "#28bfb0", border: "1px solid rgba(40,191,176,0.25)", fontFamily: "monospace" },
    lockWarn: { background: "rgba(232,150,42,0.1)", border: "1px solid rgba(232,150,42,0.3)", borderRadius: 6, padding: "8px 10px", fontSize: 12, color: "#e8962a", marginBottom: 10 },
    lockError: { background: "rgba(224,82,82,0.1)", border: "1px solid rgba(224,82,82,0.3)", borderRadius: 6, padding: "8px 10px", fontSize: 12, color: "#e05252", marginBottom: 10 },
    link: { fontSize: 11, color: "#28bfb0", textDecoration: "none" },
    ctxBlock: { background: "#0a0b0e", border: "1px solid #252830", borderRadius: 6, padding: "10px 12px", marginBottom: 10, fontSize: 11 },
    ctxLabel: { fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "#6b7080", fontWeight: 600, marginBottom: 5 },
    ctxLine: { borderLeft: "2px solid #30343f", paddingLeft: 8, color: "#6b7080", marginBottom: 3 },
    sectionLabel: { fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", color: "#6b7080", marginBottom: 4, fontWeight: 600 },
    contentBlock: { fontSize: 13, lineHeight: 1.7, color: "#dde1ec", background: "#181b22", borderRadius: 6, padding: 12, margin: "6px 0 10px", borderLeft: "3px solid #30343f" },
    justifText: { fontSize: 11, color: "#6b7080", fontStyle: "italic", lineHeight: 1.5 },
    sentBtns: { display: "flex", gap: 6, flexWrap: "wrap" },
    sentBtn: { flex: 1, minWidth: 70, padding: "9px 6px", borderRadius: 6, border: "1.5px solid #252830", fontSize: 11, fontWeight: 500, cursor: "pointer", textAlign: "center", background: "#181b22", color: "#6b7080" },
    fieldGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 },
    smallCard: { background: "#181b22", border: "1px solid #252830", borderRadius: 8, padding: 10 },
    iaTag: { fontSize: 10, color: "#6b7080", fontFamily: "monospace", marginTop: 4 },
    lockBtn: { marginTop: 8, marginBottom: 8, padding: "7px 14px", borderRadius: 6, border: "1px solid #252830", background: "transparent", color: "#6b7080", fontSize: 12, cursor: "pointer" },
    textarea: { background: "#0a0b0e", border: "1px solid #252830", borderRadius: 6, color: "#dde1ec", padding: "7px 10px", fontSize: 11, width: "100%", resize: "vertical" },
    input: { background: "#0a0b0e", border: "1px solid #252830", borderRadius: 6, color: "#dde1ec", padding: "7px 10px", fontSize: 12, width: "100%" },
    saveBtn: { padding: "7px 14px", borderRadius: 6, background: "#4e7bef", color: "#fff", border: "none", fontSize: 12, fontWeight: 500, cursor: "pointer" },
    pageBtn: { padding: "6px 12px", borderRadius: 6, border: "1px solid #252830", background: "transparent", color: "#6b7080", fontSize: 12, cursor: "pointer" },
    emptyState: { textAlign: "center", padding: "48px 20px", color: "#6b7080" },
    toast: { position: "fixed", bottom: 20, right: 20, background: "#181b22", border: "1px solid #30343f", borderRadius: 8, padding: "10px 16px", fontSize: 12, zIndex: 200 },
};
