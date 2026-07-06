import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback, useRef } from "react";
import { judgeApi, annotationsApi, projectsApi } from "../services/api";
import type { KeywordItem } from "../types";

const sentLabel = (v?: number) => ({ 1: "↑ Positivo", "-1": "↓ Negativo", 0: "→ Neutro", 2: "✕ No relac." }[String(v ?? "")] ?? "—");
const sentColor = (v?: number) => ({ 1: "var(--green)", "-1": "var(--red)", 0: "var(--muted)", 2: "var(--border2)" }[String(v ?? "")] ?? "var(--muted)");

const S: Record<string, React.CSSProperties> = {
    page: { display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)" },
    topbar: { height: 48, background: "var(--surface)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", padding: "0 22px", gap: 12, flexShrink: 0 },
    content: { flex: 1, overflowY: "auto", padding: 22, maxWidth: 960 },
    recCard: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r2)", padding: 16, marginBottom: 16 },
    toast: { position: "fixed" as const, bottom: 20, right: 20, background: "var(--card)", border: "1px solid var(--border2)", borderRadius: "var(--r)", padding: "10px 16px", fontSize: 12, zIndex: 200 },
};

const SENT_OPTS = [
    { v: 1, icon: "↑", label: "Positivo", color: "var(--green)" },
    { v: -1, icon: "↓", label: "Negativo", color: "var(--red)" },
    { v: 0, icon: "→", label: "Neutro", color: "var(--muted)" },
    { v: 2, icon: "✕", label: "No relac.", color: "var(--border2)" },
];

export default function JudgeView() {
    const { id: projectId } = useParams<{ id: string }>();
    const qc = useQueryClient();

    const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
    const [decisions, setDecisions] = useState<Record<string, number>>({});

    const [judgeFields, setJudgeFields] = useState<Record<string, string | number>>({});
    const [editingDesc, setEditingDesc] = useState(false);
    const [descDraft, setDescDraft] = useState("");

    const updateProjectMutation = useMutation({
        mutationFn: (desc_tema: string) => projectsApi.update(projectId!, { desc_tema }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["project", projectId] });
            setEditingDesc(false);
            showToast("Descripción actualizada ✓");
        },
        onError: () => showToast("Error al guardar descripción", false),
    });

    // Decisión del juez sobre un campo entero de un record (guarda en judge_final_value de la primera anotación de ese tipo)
    const judgeFieldMutation = useMutation({
        mutationFn: ({ annotationId, finalValue }: { annotationId: string; finalValue: number }) =>
            judgeApi.decide(annotationId, finalValue),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["judge-records", projectId] });
            showToast("Campo guardado ✓");
        },
        onError: () => showToast("Error al guardar", false),
    });

    const PILAR_LABELS: Record<string, string> = {
        legitimacion: "Legitimación",
        efectividad: "Efectividad",
        justicia_equidad: "Justicia y equidad",
        confianza_institucional: "Confianza institucional",
    };
    const PILAR_OPTS = [{ v: 1, l: "+1" }, { v: 0, l: "0" }, { v: -1, l: "−1" }, { v: 2, l: "N/A" }];

    const [exporting, setExporting] = useState(false);
    const downloadRef = useRef<HTMLAnchorElement>(null);

    const handleExport = async (format: "jsonl" | "csv", mode: "judge" | "annotators" | "all") => {
        if (!projectId) return;
        setExporting(true);
        try {
            const result = await judgeApi.export(projectId, format, mode);
            const blob = new Blob([result.data], {
                type: format === "csv" ? "text/csv;charset=utf-8;" : "application/jsonl",
            });
            const url = URL.createObjectURL(blob);
            const a = downloadRef.current!;
            a.href = url;
            a.download = `export_${mode}_${projectId.slice(0, 8)}.${format}`;
            a.click();
            URL.revokeObjectURL(url);
            showToast(`Descargado: ${result.count} registros (${mode})`);
        } catch {
            showToast("Error al exportar", false);
        } finally {
            setExporting(false);
        }
    };

    const showToast = useCallback((msg: string, ok = true) => {
        setToast({ msg, ok });
        setTimeout(() => setToast(null), 2600);
    }, []);

    const { data, isLoading } = useQuery({
        queryKey: ["judge-records", projectId],
        queryFn: () => judgeApi.records(projectId!),
        enabled: !!projectId,
    });
    const { data: keywords } = useQuery({
        queryKey: ["keywords", projectId],
        queryFn: () => annotationsApi.listKeywords(projectId!) as Promise<KeywordItem[]>,
        enabled: !!projectId,
    });

    const { data: project } = useQuery({
        queryKey: ["project", projectId],
        queryFn: () => projectsApi.get(projectId!),
        enabled: !!projectId,
    });

    const judgeKwMutation = useMutation({
        mutationFn: ({ kwId, accepted, reason }: { kwId: string; accepted: boolean; reason?: string }) =>
            annotationsApi.judgeKeyword(projectId!, kwId, {
                project_id: projectId!, keyword: "", accepted, reason,
            }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["keywords", projectId] });
            showToast("Decisión de keyword guardada ✓");
        },
        onError: () => showToast("Error al guardar keyword", false),
    });

    const [kwRejectReason, setKwRejectReason] = useState<Record<string, string>>({});
    const [kwRejectPending, setKwRejectPending] = useState<string | null>(null);

    const decideMutation = useMutation({
        mutationFn: ({ annotationId, finalValue }: { annotationId: string; finalValue: number }) =>
            judgeApi.decide(annotationId, finalValue),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["judge-records", projectId] });
            showToast("Decisión guardada ✓");
        },
        onError: () => showToast("Error al guardar", false),
    });

    if (isLoading) return <div style={{ padding: 40, color: "var(--muted)" }}>Cargando registros para juzgar...</div>;

    return (
        <div style={S.page}>
            <div style={S.topbar}>
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", flex: 1 }}>⚖️ Decisiones del juez</span>
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 100, background: "var(--card)", border: "1px solid var(--border)", color: "var(--accent2)", fontFamily: "monospace" }}>
                    {data?.length ?? 0} registros
                </span>
                <a ref={downloadRef} style={{ display: "none" }} />
                <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                    <span style={{ fontSize: 10, color: "var(--accent2)", alignSelf: "center" }}>Exportar:</span>
                    {(["judge", "annotators", "all"] as const).map((mode) => (
                        <div key={mode} style={{ display: "flex", gap: 3 }}>
                            <button
                                disabled={exporting}
                                onClick={() => handleExport("jsonl", mode)}
                                style={{ padding: "3px 8px", borderRadius: "var(--r)", border: "1px solid var(--border)", background: "transparent", color: "var(--accent2)", fontSize: 10, cursor: "pointer" }}>
                                {mode} JSONL
                            </button>
                            <button
                                disabled={exporting}
                                onClick={() => handleExport("csv", mode)}
                                style={{ padding: "3px 8px", borderRadius: "var(--r)", border: "1px solid var(--border)", background: "transparent", color: "var(--accent2)", fontSize: 10, cursor: "pointer" }}>
                                CSV
                            </button>
                        </div>
                    ))}
                </div>
            </div>
            <div style={S.content}>
                {/* ── DESCRIPCIÓN DEL TEMA (editable por el juez) ── */}
                {project && (
                    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r2)", padding: 14, marginBottom: 16 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: "var(--amber)", marginBottom: 6 }}>📋 CONTEXTO DEL PROYECTO — Decisión final del juez</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 11 }}>
                            <div><span style={{ color: "var(--muted)" }}>Tema: </span><strong style={{ color: "var(--text)" }}>{project.tema}</strong></div>
                            <div><span style={{ color: "var(--muted)" }}>Ámbito: </span><strong style={{ color: "var(--text)" }}>{project.population_scope || "—"}</strong></div>
                        </div>
                        <div style={{ marginTop: 8 }}>
                            <div style={{ fontSize: 9, color: "var(--muted)", marginBottom: 4 }}>Descripción del tema (editable por el juez):</div>
                            {editingDesc ? (
                                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                    <textarea autoFocus rows={3}
                                        style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)", color: "var(--text)", padding: "7px 10px", fontSize: 12, width: "100%", resize: "vertical" as const, fontFamily: "inherit" }}
                                        value={descDraft}
                                        onChange={e => setDescDraft(e.target.value)} />
                                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                                        <button disabled={updateProjectMutation.isPending}
                                            onClick={() => updateProjectMutation.mutate(descDraft.trim())}
                                            style={{ padding: "4px 12px", borderRadius: "var(--r)", background: "var(--accent)", color: "#fff", border: "none", fontSize: 11, cursor: "pointer" }}>
                                            {updateProjectMutation.isPending ? "Guardando..." : "Guardar"}
                                        </button>
                                        <button onClick={() => setEditingDesc(false)}
                                            style={{ padding: "4px 12px", borderRadius: "var(--r)", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer" }}>
                                            Cancelar
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                                    <span style={{ flex: 1, fontSize: 12, color: "var(--text)", lineHeight: 1.5 }}>
                                        {project.desc_tema || <em style={{ color: "var(--muted)" }}>Sin descripción</em>}
                                    </span>
                                    <button onClick={() => { setDescDraft(project.desc_tema ?? ""); setEditingDesc(true); }}
                                        style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13, padding: "0 2px", opacity: 0.6 }}>✎</button>
                                </div>
                            )}
                        </div>
                    </div>
                )}
                {!data?.length && (
                    <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--muted)" }}>
                        <div style={{ fontSize: 28, marginBottom: 8 }}>⚖️</div>
                        <div style={{ fontWeight: 500, color: "var(--text)", marginBottom: 4 }}>Sin registros listos para juzgar</div>
                        <div style={{ fontSize: 12 }}>Los registros aparecen aquí cuando dos anotadores los han completado.</div>
                    </div>
                )}

                {data?.map(({ record, annotations }) => {
                    // Separar anotaciones por tipo
                    const sentAnns = annotations.filter(a => a.annotation_type === "sentiment");
                    const pilarAnns = annotations.filter(a => a.annotation_type === "pilar");
                    const fieldAnns = annotations.filter(a => a.annotation_type === "field");
                    // Agrupar pilares por nombre
                    const pilarsByKey: Record<string, typeof pilarAnns> = {};
                    for (const a of pilarAnns) {
                        if (a.pilar) { pilarsByKey[a.pilar] = pilarsByKey[a.pilar] ?? []; pilarsByKey[a.pilar].push(a); }
                    }
                    // Agrupar fields por nombre
                    const fieldsByKey: Record<string, typeof fieldAnns> = {};
                    for (const a of fieldAnns) {
                        if (a.field_name) { fieldsByKey[a.field_name] = fieldsByKey[a.field_name] ?? []; fieldsByKey[a.field_name].push(a); }
                    }

                    return (
                        <div key={record.id} style={S.recCard}>
                            {/* ── Cabecera del record ── */}
                            <div style={{ fontSize: 9, textTransform: "uppercase" as const, letterSpacing: "0.1em", color: "var(--muted)", marginBottom: 4 }}>
                                [{record.platform ?? "?"} · {record.tipo ?? "?"} · {record.fecha ?? "?"}]
                                {record.url_post && <> · <a href={record.url_post} target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal)", fontSize: 9 }}>🔗 ver post</a></>}
                            </div>

                            {/* Contexto padre si existe */}
                            {record.cuerpo_padre && (
                                <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: "8px 10px", marginBottom: 8, fontSize: 11, color: "var(--muted)", borderLeft: "2px solid var(--purple)" }}>
                                    {record.titulo_padre && <div style={{ fontWeight: 600, marginBottom: 3 }}>{record.titulo_padre}</div>}
                                    <div>{record.cuerpo_padre.slice(0, 300)}{record.cuerpo_padre.length > 300 ? "…" : ""}</div>
                                </div>
                            )}

                            {/* Contenido principal */}
                            <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--text)", background: "var(--card)", borderRadius: "var(--r)", padding: 12, margin: "8px 0", borderLeft: `3px solid ${sentColor(record.sentiment_llm)}` }}>
                                {record.content}
                            </div>

                            {/* Metadatos del record */}
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 10, color: "var(--muted)", marginBottom: 10 }}>
                                {record.lang && <span>🌐 Idioma LLM: <strong style={{ color: "var(--text)" }}>{record.lang}</strong>{record.justif_lang && <em> — {record.justif_lang}</em>}</span>}
                                {record.world_country && <span>🌍 País LLM: <strong style={{ color: "var(--text)" }}>{[record.world_city, record.world_region, record.world_country].filter(Boolean).join(", ")}</strong>{record.justif_pais && <em> — {record.justif_pais}</em>}</span>}
                                {record.pertinencia && <span>📌 Pertinencia LLM: <strong style={{ color: "var(--text)" }}>{record.pertinencia}</strong>{record.justif_pertinencia && <em> — {record.justif_pertinencia}</em>}</span>}
                                {record.posicion && <span>🎯 Posición LLM: <strong style={{ color: "var(--text)" }}>{record.posicion}</strong>{record.justif_posicion && <em> — {record.justif_posicion}</em>}</span>}
                            </div>

                            {/* ── SENTIMIENTO ── */}
                            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginBottom: 10 }}>
                                <div style={{ fontSize: 10, fontWeight: 600, color: "var(--amber)", marginBottom: 6 }}>SENTIMIENTO</div>
                                <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(sentAnns.length + 1, 4)}, 1fr)`, gap: 6, marginBottom: 6 }}>
                                    {/* LLM */}
                                    <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: 8 }}>
                                        <div style={{ fontSize: 9, color: "var(--muted)", marginBottom: 3 }}>🤖 LLM</div>
                                        <div style={{ fontSize: 12, fontWeight: 600, color: sentColor(record.sentiment_llm) }}>{sentLabel(record.sentiment_llm)}</div>
                                        {record.topic_llm && <div style={{ fontSize: 10, color: "var(--muted)" }}>topic: {record.topic_llm}</div>}
                                        {record.justif_sentimiento && <div style={{ fontSize: 9, fontStyle: "italic", color: "var(--muted)" }}>{record.justif_sentimiento}</div>}
                                    </div>
                                    {/* Cada anotador */}
                                    {sentAnns.map(a => (
                                        <div key={a.id} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: 8 }}>
                                            <div style={{ fontSize: 9, color: "var(--muted)", marginBottom: 3 }}>👤 {a.annotator}</div>
                                            <div style={{ fontSize: 12, fontWeight: 600, color: sentColor(a.corrected_sentiment) }}>{sentLabel(a.corrected_sentiment)}</div>
                                            {a.corrected_topic && <div style={{ fontSize: 10, color: "var(--muted)" }}>topic: {a.corrected_topic}</div>}
                                            {a.correction_reason && <div style={{ fontSize: 9, fontStyle: "italic", color: "var(--muted)" }}>{a.correction_reason}</div>}
                                        </div>
                                    ))}
                                </div>
                                {/* Decisión del juez: sentimiento */}
                                <div style={{ fontSize: 9, color: "var(--amber)", marginBottom: 4 }}>⚖️ Decisión final:</div>
                                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" as const }}>
                                    {SENT_OPTS.map(opt => {
                                        const key = `${record.id}__sentiment`;
                                        const sel = judgeFields[key] === opt.v;
                                        return (
                                            <button key={opt.v}
                                                style={{ flex: 1, minWidth: 60, padding: "6px 4px", borderRadius: "var(--r)", border: `1.5px solid ${sel ? opt.color : "var(--border)"}`, fontSize: 11, fontWeight: 500, background: sel ? opt.color + "18" : "var(--card)", color: sel ? opt.color : "var(--muted)", cursor: "pointer", textAlign: "center" as const }}
                                                onClick={() => setJudgeFields(p => ({ ...p, [`${record.id}__sentiment`]: opt.v }))}>
                                                {opt.icon} {opt.label}
                                            </button>
                                        );
                                    })}
                                </div>
                                {judgeFields[`${record.id}__sentiment`] !== undefined && sentAnns[0] && (
                                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                                        <button onClick={() => judgeFieldMutation.mutate({ annotationId: sentAnns[0].id, finalValue: judgeFields[`${record.id}__sentiment`] as number })}
                                            style={{ padding: "5px 12px", borderRadius: "var(--r)", background: "var(--accent)", color: "#fff", border: "none", fontSize: 11, cursor: "pointer" }}>
                                            Guardar sentimiento →
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* ── PILARES ── */}
                            {Object.keys(PILAR_LABELS).length > 0 && (
                                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginBottom: 10 }}>
                                    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--amber)", marginBottom: 6 }}>PILARES</div>
                                    {Object.entries(PILAR_LABELS).map(([pilarKey, pilarLabel]) => {
                                        const llmVal = (record as any)[pilarKey] as number | undefined;
                                        const justifKey = `justif_${pilarKey}` as keyof typeof record;
                                        const justif = (record as any)[justifKey] as string | undefined;
                                        const annotatorVals = pilarsByKey[pilarKey] ?? [];
                                        const jKey = `${record.id}__${pilarKey}`;
                                        const sel = judgeFields[jKey];
                                        return (
                                            <div key={pilarKey} style={{ marginBottom: 8, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: 8 }}>
                                                <div style={{ fontSize: 10, fontWeight: 600, color: "var(--teal)", marginBottom: 4 }}>{pilarLabel}</div>
                                                <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(annotatorVals.length + 1, 4)}, 1fr)`, gap: 4, marginBottom: 6 }}>
                                                    <div style={{ fontSize: 10 }}>
                                                        <span style={{ color: "var(--muted)" }}>🤖 LLM: </span>
                                                        <strong>{llmVal !== undefined ? (llmVal === 2 ? "N/A" : llmVal) : "—"}</strong>
                                                        {justif && <div style={{ fontSize: 9, fontStyle: "italic", color: "var(--muted)" }}>{justif}</div>}
                                                    </div>
                                                    {annotatorVals.map(a => (
                                                        <div key={a.id} style={{ fontSize: 10 }}>
                                                            <span style={{ color: "var(--muted)" }}>👤 {a.annotator}: </span>
                                                            <strong>{a.corrected_value !== undefined ? (a.corrected_value === 2 ? "N/A" : a.corrected_value) : "—"}</strong>
                                                            {a.correction_reason && <div style={{ fontSize: 9, fontStyle: "italic", color: "var(--muted)" }}>{a.correction_reason}</div>}
                                                        </div>
                                                    ))}
                                                </div>
                                                <div style={{ display: "flex", gap: 4 }}>
                                                    {PILAR_OPTS.map(opt => (
                                                        <button key={opt.v}
                                                            style={{ flex: 1, padding: "4px 2px", borderRadius: 4, border: `1.5px solid ${sel === opt.v ? "var(--teal)" : "var(--border)"}`, fontSize: 10, fontWeight: 500, background: sel === opt.v ? "rgba(40,191,176,0.15)" : "var(--card)", color: sel === opt.v ? "var(--teal)" : "var(--muted)", cursor: "pointer" }}
                                                            onClick={() => setJudgeFields(p => ({ ...p, [jKey]: opt.v }))}>
                                                            {opt.l}
                                                        </button>
                                                    ))}
                                                </div>
                                                {sel !== undefined && annotatorVals[0] && (
                                                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                                                        <button onClick={() => judgeFieldMutation.mutate({ annotationId: annotatorVals[0].id, finalValue: sel as number })}
                                                            style={{ padding: "3px 10px", borderRadius: "var(--r)", background: "var(--accent)", color: "#fff", border: "none", fontSize: 10, cursor: "pointer" }}>
                                                            Guardar →
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* ── CAMPOS DE TEXTO (posición, geoloc, idioma...) ── */}
                            {Object.keys(fieldsByKey).length > 0 && (
                                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginBottom: 10 }}>
                                    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--amber)", marginBottom: 6 }}>CAMPOS CORREGIDOS POR ANOTADORES</div>
                                    {Object.entries(fieldsByKey).map(([fieldKey, fieldVals]) => {
                                        const llmVal = (record as any)[fieldKey] as string | undefined;
                                        const jKey = `${record.id}__field__${fieldKey}`;
                                        return (
                                            <div key={fieldKey} style={{ marginBottom: 6, display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" as const }}>
                                                <span style={{ fontSize: 9, fontWeight: 600, color: "var(--purple)", minWidth: 100 }}>{fieldKey}</span>
                                                <span style={{ fontSize: 10, color: "var(--muted)" }}>LLM: <strong style={{ color: "var(--text)" }}>{llmVal || "—"}</strong></span>
                                                {fieldVals.map(a => (
                                                    <span key={a.id} style={{ fontSize: 10, color: "var(--muted)" }}>
                                                        👤 {a.annotator}: <strong style={{ color: "var(--text)" }}>{a.corrected_text ?? "—"}</strong>
                                                        {a.correction_reason && <em style={{ fontSize: 9 }}> ({a.correction_reason})</em>}
                                                    </span>
                                                ))}
                                                <input
                                                    style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)", color: "var(--text)", padding: "3px 7px", fontSize: 10, width: 120 }}
                                                    placeholder="Valor juez..."
                                                    value={(judgeFields[jKey] as string) ?? ""}
                                                    onChange={e => setJudgeFields(p => ({ ...p, [jKey]: e.target.value }))} />
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
                {/* ── SECCIÓN KEYWORDS DEL PROYECTO ── */}
                {keywords && keywords.length > 0 && (
                    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r2)", padding: 16, marginBottom: 16 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--amber)", marginBottom: 10 }}>
                            🔑 Keywords del proyecto — Decisión final del juez
                        </div>
                        {keywords.map((kw) => (
                            <div key={kw.id} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{ flex: 1, fontSize: 13, color: "var(--text)" }}>{kw.keyword}</span>
                                    <span style={{ fontSize: 10, color: "var(--muted)" }}>{kw.type}</span>
                                    {/* Estado de anotadores */}
                                    <span style={{ fontSize: 10, color: kw.accepted === true ? "var(--green)" : kw.accepted === false ? "var(--red)" : "var(--muted)" }}>
                                        Anot: {kw.accepted === true ? "✓ aceptada" : kw.accepted === false ? "✗ rechazada" : "—"}
                                    </span>
                                    {/* Decisión del juez */}
                                    <span style={{ fontSize: 10, fontWeight: 600, color: kw.reviewer_decision === "accept" ? "var(--green)" : kw.reviewer_decision === "reject" ? "var(--red)" : "var(--amber)" }}>
                                        Juez: {kw.reviewer_decision === "accept" ? "✓" : kw.reviewer_decision === "reject" ? "✗" : "pendiente"}
                                    </span>
                                    <button style={{ padding: "3px 8px", borderRadius: "var(--r)", border: "1px solid var(--border)", background: "transparent", color: "var(--green)", fontSize: 11, cursor: "pointer" }}
                                        onClick={() => judgeKwMutation.mutate({ kwId: kw.id, accepted: true })}>✓</button>
                                    <button style={{ padding: "3px 8px", borderRadius: "var(--r)", border: "1px solid var(--border)", background: "transparent", color: "var(--red)", fontSize: 11, cursor: "pointer" }}
                                        onClick={() => setKwRejectPending(kwRejectPending === kw.id ? null : kw.id)}>✗</button>
                                </div>
                                {kw.reason && kwRejectPending !== kw.id && (
                                    <div style={{ fontSize: 11, color: "var(--muted)", fontStyle: "italic" }}>Motivo anot: {kw.reason}</div>
                                )}
                                {kwRejectPending === kw.id && (
                                    <div style={{ display: "flex", gap: 6 }}>
                                        <input autoFocus
                                            style={{ flex: 1, background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)", color: "var(--text)", padding: "5px 8px", fontSize: 11 }}
                                            placeholder="Motivo del rechazo (obligatorio)..."
                                            value={kwRejectReason[kw.id] ?? ""}
                                            onChange={(e) => setKwRejectReason(prev => ({ ...prev, [kw.id]: e.target.value }))} />
                                        <button
                                            disabled={!kwRejectReason[kw.id]?.trim() || judgeKwMutation.isPending}
                                            style={{ padding: "5px 10px", borderRadius: "var(--r)", background: "var(--red)", color: "#fff", border: "none", fontSize: 11, cursor: "pointer", opacity: kwRejectReason[kw.id]?.trim() ? 1 : 0.4 }}
                                            onClick={() => judgeKwMutation.mutate({ kwId: kw.id, accepted: false, reason: kwRejectReason[kw.id] })}>
                                            Confirmar
                                        </button>
                                        <button style={{ padding: "5px 10px", borderRadius: "var(--r)", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer" }}
                                            onClick={() => setKwRejectPending(null)}>Cancelar</button>
                                    </div>
                                )}
                            </div>
                        ))}
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