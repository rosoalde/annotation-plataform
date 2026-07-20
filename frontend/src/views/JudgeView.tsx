import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback, useRef } from "react";
import { judgeApi, annotationsApi, projectsApi } from "../services/api";
import type { KeywordItem } from "../types";

const sentLabel = (v?: number) => ({ 1: "↑ Positivo", "-1": "↓ Negativo", 0: "→ Neutro", 2: "✕ No relac." }[String(v ?? "")] ?? "—");
const sentColor = (v?: number) => ({ 1: "var(--green)", "-1": "var(--red)", 0: "var(--muted)", 2: "var(--border2)" }[String(v ?? "")] ?? "var(--muted)");
const reviewBadge = (d?: string) => d === "accept" ? <span style={{ color: "var(--green)", fontSize: 9 }}> ✓revisado</span> : d === "reject" ? <span style={{ color: "var(--red)", fontSize: 9 }}> ✗rechazado</span> : null;

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
        mutationFn: ({ annotationId, finalValue, reason }: { annotationId: string; finalValue: number; reason?: string }) =>
            judgeApi.decide(annotationId, finalValue, reason),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["judge-records", projectId] });
            showToast("Campo guardado ✓");
        },
        onError: () => showToast("Error al guardar", false),
    });

    const judgeFieldTextMutation = useMutation({
        mutationFn: ({ annotationId, finalText, reason }: { annotationId: string; finalText: string; reason?: string }) =>
            judgeApi.decideText(annotationId, finalText, reason),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["judge-records", projectId] });
            showToast("Campo guardado ✓");
        },
        onError: () => showToast("Error al guardar", false),
    });

    const judgeDecideNewMutation = useMutation({
        mutationFn: (data: Parameters<typeof judgeApi.decideNew>[0]) => judgeApi.decideNew(data),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["judge-records", projectId] });
            showToast("Decisión guardada ✓");
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

    // Mismo listado que AnnotateView.tsx — se muestran todos aunque ningún
    // anotador los haya corregido, para que el juez pueda decidir igual.
    const TEXT_FIELDS: Array<{ key: string; label: string; justifKey: string | null }> = [
        { key: "pertinencia", label: "Pertinencia", justifKey: "justif_pertinencia" },
        { key: "posicion", label: "Posición", justifKey: "justif_posicion" },
        // { key: "idioma_ia", label: "Idioma (detección original)", justifKey: null },
        // { key: "lang", label: "Idioma (reanálisis)", justifKey: "justif_lang" },
        { key: "lang", label: "Idioma", justifKey: "justif_lang" },
        { key: "world_continent", label: "Continente", justifKey: "justif_continente" },
        { key: "world_country", label: "País", justifKey: "justif_pais" },
        { key: "world_region", label: "Región", justifKey: "justif_region" },
        { key: "world_city", label: "Ciudad", justifKey: "justif_ciudad" },
        // { key: "codigo_pais", label: "Código país (ISO)", justifKey: null },
    ];

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
                    {([
                        { mode: "judge", label: "Gold Standard" },
                        { mode: "annotators", label: "Anotadores" },
                        { mode: "all", label: "Completo" },
                    ] as const).map(({ mode, label }) => (
                        <div key={mode} style={{ display: "flex", gap: 3 }}>
                            <button
                                disabled={exporting}
                                onClick={() => handleExport("jsonl", mode as "judge" | "annotators" | "all")}
                                style={{ padding: "3px 8px", borderRadius: "var(--r)", border: "1px solid var(--border)", background: "transparent", color: "var(--accent2)", fontSize: 10, cursor: "pointer" }}>
                                {label} JSONL
                            </button>
                            <button
                                disabled={exporting}
                                onClick={() => handleExport("csv", mode as "judge" | "annotators" | "all")}
                                style={{ padding: "3px 8px", borderRadius: "var(--r)", border: "1px solid var(--border)", background: "transparent", color: "var(--accent2)", fontSize: 10, cursor: "pointer" }}>
                                {label} CSV
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
                    const savedSentiment = sentAnns.find(a => a.judge_final_value != null)?.judge_final_value;
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
                                        <button
                                            style={{ fontSize: 9, color: "var(--accent2)", background: "transparent", border: "none", cursor: "pointer", padding: "2px 0", marginTop: 4 }}
                                            onClick={() => setJudgeFields(p => ({ ...p, [`${record.id}__sentiment`]: record.sentiment_llm ?? 0 }))}>
                                            ← adoptar
                                        </button>
                                    </div>
                                    {/* Cada anotador */}
                                    {sentAnns.map(a => (
                                        <div key={a.id} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: 8 }}>
                                            <div style={{ fontSize: 9, color: "var(--muted)", marginBottom: 3 }}>👤 {a.annotator}{reviewBadge(a.reviewer_decision)}</div>
                                            <div style={{ fontSize: 12, fontWeight: 600, color: sentColor(a.corrected_sentiment) }}>{sentLabel(a.corrected_sentiment)}</div>
                                            {a.corrected_topic && <div style={{ fontSize: 10, color: "var(--muted)" }}>topic: {a.corrected_topic}</div>}
                                            {a.correction_reason && <div style={{ fontSize: 9, fontStyle: "italic", color: "var(--muted)" }}>{a.correction_reason}</div>}
                                            <button
                                                style={{ fontSize: 9, color: "var(--accent2)", background: "transparent", border: "none", cursor: "pointer", padding: "2px 0", marginTop: 4 }}
                                                onClick={() => setJudgeFields(p => ({
                                                    ...p,
                                                    [`${record.id}__sentiment`]: a.corrected_sentiment ?? record.sentiment_llm ?? 0,
                                                    [`${record.id}__sentiment_reason`]: a.correction_reason ?? "",
                                                }))}>
                                                ← adoptar
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                {/* Decisión del juez: sentimiento */}
                                <div style={{ fontSize: 9, color: "var(--amber)", marginBottom: 4 }}>⚖️ Decisión final:</div>
                                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" as const }}>
                                    {
                                        SENT_OPTS.map(opt => {
                                            const key = `${record.id}__sentiment`;
                                            const sel = (judgeFields[key] ?? savedSentiment) === opt.v;
                                            return (
                                                <button key={opt.v}
                                                    style={{ flex: 1, minWidth: 60, padding: "6px 4px", borderRadius: "var(--r)", border: `1.5px solid ${sel ? opt.color : "var(--border)"}`, fontSize: 11, fontWeight: 500, background: sel ? opt.color + "18" : "var(--card)", color: sel ? opt.color : "var(--muted)", cursor: "pointer", textAlign: "center" as const }}
                                                    onClick={() => setJudgeFields(p => ({ ...p, [`${record.id}__sentiment`]: opt.v }))}>
                                                    {opt.icon} {opt.label}
                                                </button>
                                            );
                                        })}
                                </div>
                                {savedSentiment !== undefined && judgeFields[`${record.id}__sentiment`] === undefined && (
                                    <div style={{ fontSize: 9, color: "var(--green)", marginTop: 4 }}>✓ Decisión guardada</div>
                                )}

                                {judgeFields[`${record.id}__sentiment`] !== undefined && sentAnns[0] && (
                                    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                                        <textarea
                                            rows={1}
                                            placeholder="Motivo de la decisión del juez (opcional)..."
                                            style={{
                                                background: "var(--card)",
                                                border: "1px solid var(--border)",
                                                borderRadius: "var(--r)",
                                                color: "var(--text)",
                                                padding: "5px 8px",
                                                fontSize: 10,
                                                resize: "none",
                                                fontFamily: "inherit",
                                            }}
                                            value={(judgeFields[`${record.id}__sentiment_reason`] as string) ?? ""}
                                            onChange={(e) =>
                                                setJudgeFields((p) => ({
                                                    ...p,
                                                    [`${record.id}__sentiment_reason`]: e.target.value,
                                                }))
                                            }
                                        />

                                        <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                            <button
                                                onClick={() =>
                                                    judgeFieldMutation.mutate({
                                                        annotationId: sentAnns[0].id,
                                                        finalValue: judgeFields[`${record.id}__sentiment`] as number,
                                                        reason: (judgeFields[`${record.id}__sentiment_reason`] as string) || undefined,
                                                    })
                                                }
                                                style={{
                                                    padding: "5px 12px",
                                                    borderRadius: "var(--r)",
                                                    background: "var(--accent)",
                                                    color: "#fff",
                                                    border: "none",
                                                    fontSize: 11,
                                                    cursor: "pointer",
                                                }}
                                            >
                                                Guardar sentimiento →
                                            </button>
                                        </div>
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
                                        const savedValue = annotatorVals.find(a => a.judge_final_value != null)?.judge_final_value;
                                        const sel = judgeFields[jKey] ?? savedValue;
                                        return (
                                            <div key={pilarKey} style={{ marginBottom: 8, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: 8 }}>
                                                <div style={{ fontSize: 10, fontWeight: 600, color: "var(--teal)", marginBottom: 4 }}>{pilarLabel}</div>
                                                <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(annotatorVals.length + 1, 4)}, 1fr)`, gap: 4, marginBottom: 6 }}>
                                                    <div style={{ fontSize: 10 }}>
                                                        <span style={{ color: "var(--muted)" }}>🤖 LLM: </span>
                                                        <strong>{llmVal !== undefined ? (llmVal === 2 ? "N/A" : llmVal) : "—"}</strong>
                                                        {justif && <div style={{ fontSize: 9, fontStyle: "italic", color: "var(--muted)" }}>{justif}</div>}
                                                        {llmVal !== undefined && (
                                                            <button
                                                                style={{ fontSize: 9, color: "var(--accent2)", background: "transparent", border: "none", cursor: "pointer", padding: "2px 0", marginTop: 2 }}
                                                                onClick={() => setJudgeFields(p => ({ ...p, [jKey]: llmVal, [`${jKey}__reason`]: justif ?? "" }))}>
                                                                ← adoptar
                                                            </button>
                                                        )}
                                                    </div>
                                                    {annotatorVals.length === 0 && (
                                                        <div style={{ fontSize: 10, color: "var(--muted)", fontStyle: "italic" }}>Ningún anotador tocó este pilar</div>
                                                    )}
                                                    {annotatorVals.map(a => (
                                                        <div key={a.id} style={{ fontSize: 10 }}>
                                                            <span style={{ color: "var(--muted)" }}>👤 {a.annotator}{reviewBadge(a.reviewer_decision)}: </span>
                                                            <strong>{a.corrected_value !== undefined ? (a.corrected_value === 2 ? "N/A" : a.corrected_value) : "—"}</strong>
                                                            {a.correction_reason && <div style={{ fontSize: 9, fontStyle: "italic", color: "var(--muted)" }}>{a.correction_reason}</div>}
                                                            <button
                                                                style={{ fontSize: 9, color: "var(--accent2)", background: "transparent", border: "none", cursor: "pointer", padding: 0, marginTop: 2 }}
                                                                onClick={() => setJudgeFields(p => ({ ...p, [jKey]: a.corrected_value, [`${jKey}__reason`]: a.correction_reason ?? "" }))}>
                                                                ← adoptar
                                                            </button>
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
                                                {savedValue !== undefined && judgeFields[jKey] === undefined && (
                                                    <div style={{ fontSize: 9, color: "var(--green)", marginTop: 4 }}>✓ Decisión guardada: {savedValue === 2 ? "N/A" : savedValue}</div>
                                                )}
                                                {sel !== undefined && (
                                                    <div style={{ marginTop: 6, display: "flex", flexDirection: "column" as const, gap: 4 }}>
                                                        <textarea
                                                            rows={1}
                                                            placeholder="Motivo del juez (opcional)..."
                                                            style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)", color: "var(--text)", padding: "4px 7px", fontSize: 9, resize: "none" as const, fontFamily: "inherit", width: "100%" }}
                                                            value={(judgeFields[`${jKey}__reason`] as string) ?? ""}
                                                            onChange={e => setJudgeFields(p => ({ ...p, [`${jKey}__reason`]: e.target.value }))} />
                                                        <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                                            <button
                                                                onClick={() => {
                                                                    const reason = (judgeFields[`${jKey}__reason`] as string) || undefined;
                                                                    annotatorVals[0]
                                                                        ? judgeFieldMutation.mutate({ annotationId: annotatorVals[0].id, finalValue: sel as number, reason })
                                                                        : judgeDecideNewMutation.mutate({ record_id: record.id, project_id: projectId!, annotation_type: "pilar", pilar: pilarKey, final_value: sel as number, reason });
                                                                }}
                                                                style={{ padding: "3px 10px", borderRadius: "var(--r)", background: "var(--accent)", color: "#fff", border: "none", fontSize: 10, cursor: "pointer" }}>
                                                                Guardar →
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                    {/* ── TOPIC (decisión del juez) ── */}
                                    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginBottom: 10 }}>
                                        <div style={{ fontSize: 10, fontWeight: 600, color: "var(--amber)", marginBottom: 6 }}>TOPIC</div>
                                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, marginBottom: 8 }}>
                                            {/* LLM */}
                                            <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: "6px 10px", fontSize: 10 }}>
                                                <div style={{ color: "var(--muted)", marginBottom: 2 }}>🤖 LLM: <strong style={{ color: "var(--text)" }}>{record.topic_llm || "—"}</strong></div>
                                                <button
                                                    style={{ fontSize: 9, color: "var(--accent2)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
                                                    onClick={() => setJudgeFields(p => ({ ...p, [`${record.id}__topic`]: record.topic_llm ?? "", [`${record.id}__topic__reason`]: record.justif_topic ?? "" }))}>
                                                    ← adoptar
                                                </button>
                                            </div>
                                            {/* Annotators' topic values */}
                                            {sentAnns.filter(a => a.corrected_topic).map(a => (
                                                <div key={a.id} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: "6px 10px", fontSize: 10 }}>
                                                    <div style={{ color: "var(--muted)", marginBottom: 2 }}>
                                                        👤 {a.annotator}{reviewBadge(a.reviewer_decision)}: <strong style={{ color: "var(--text)" }}>{a.corrected_topic}</strong>
                                                    </div>
                                                    {a.correction_reason && <div style={{ fontSize: 9, fontStyle: "italic", color: "var(--muted)" }}>{a.correction_reason}</div>}
                                                    <button
                                                        style={{ fontSize: 9, color: "var(--accent2)", background: "transparent", border: "none", cursor: "pointer", padding: 0, marginTop: 2 }}
                                                        onClick={() => setJudgeFields(p => ({ ...p, [`${record.id}__topic`]: a.corrected_topic ?? "", [`${record.id}__topic__reason`]: a.correction_reason ?? "" }))}>
                                                        ← adoptar
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                        {/* Judge's topic input */}
                                        {(() => {
                                            const savedTopic = fieldAnns.find(a => a.field_name === "topic" && a.judge_final_text != null)?.judge_final_text;
                                            const jTopicKey = `${record.id}__topic`;
                                            const topicDraft = (judgeFields[jTopicKey] as string) ?? savedTopic ?? "";
                                            const topicReason = (judgeFields[`${jTopicKey}__reason`] as string) ?? "";
                                            const existingAnn = fieldAnns.find(a => a.field_name === "topic");
                                            return (
                                                <div>
                                                    <div style={{ fontSize: 9, color: "var(--amber)", marginBottom: 4 }}>⚖️ Topic final del juez:</div>
                                                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
                                                        <input
                                                            style={{ flex: 1, minWidth: 140, background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)", color: "var(--text)", padding: "5px 8px", fontSize: 11, fontFamily: "inherit" }}
                                                            placeholder="Topic final..."
                                                            value={topicDraft}
                                                            onChange={e => setJudgeFields(p => ({ ...p, [jTopicKey]: e.target.value }))} />
                                                        <input
                                                            style={{ flex: 1, minWidth: 140, background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)", color: "var(--text)", padding: "5px 8px", fontSize: 10, fontFamily: "inherit" }}
                                                            placeholder="Motivo (opcional)..."
                                                            value={topicReason}
                                                            onChange={e => setJudgeFields(p => ({ ...p, [`${jTopicKey}__reason`]: e.target.value }))} />
                                                        <button
                                                            disabled={!topicDraft}
                                                            onClick={() => existingAnn
                                                                ? judgeFieldTextMutation.mutate({ annotationId: existingAnn.id, finalText: topicDraft, reason: topicReason || undefined })
                                                                : judgeDecideNewMutation.mutate({
                                                                    record_id: record.id, project_id: projectId!,
                                                                    annotation_type: "field", field_name: "topic",
                                                                    final_text: topicDraft, reason: topicReason || undefined,
                                                                })}
                                                            style={{ padding: "5px 12px", borderRadius: "var(--r)", background: topicDraft ? "var(--accent)" : "var(--border)", color: "#fff", border: "none", fontSize: 11, cursor: topicDraft ? "pointer" : "default" }}>
                                                            Guardar topic →
                                                        </button>
                                                    </div>
                                                    {savedTopic != null && judgeFields[jTopicKey] === undefined && (
                                                        <div style={{ fontSize: 9, color: "var(--green)", marginTop: 4 }}>✓ Topic guardado: {savedTopic}</div>
                                                    )}
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </div>
                            )}

                            {/* ── CAMPOS DE TEXTO (posición, geoloc, idioma...) ── */}
                            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginBottom: 10 }}>
                                <div style={{ fontSize: 10, fontWeight: 600, color: "var(--amber)", marginBottom: 6 }}>CAMPOS DE TEXTO</div>
                                {TEXT_FIELDS.map(({ key: fieldKey, label, justifKey }) => {
                                    const llmVal = (record as any)[fieldKey] as string | undefined;
                                    const llmJustif = justifKey ? (record as any)[justifKey] as string | undefined : undefined;
                                    const fieldVals = fieldsByKey[fieldKey] ?? [];
                                    const existing = fieldVals[0];
                                    const savedText = fieldVals.find(a => a.judge_final_text != null)?.judge_final_text;
                                    const jKey = `${record.id}__field__${fieldKey}`;
                                    const draft = (judgeFields[jKey] as string) ?? savedText ?? "";
                                    return (
                                        <div key={fieldKey} style={{ marginBottom: 6, display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" as const }}>
                                            <span style={{ fontSize: 9, fontWeight: 600, color: "var(--purple)", minWidth: 100 }}>{label}</span>
                                            <span style={{ fontSize: 10, color: "var(--muted)" }}>LLM: <strong style={{ color: "var(--text)" }}>{llmVal || "—"}</strong>
                                                {llmVal && <button style={{ fontSize: 9, color: "var(--accent2)", background: "transparent", border: "none", cursor: "pointer", padding: "0 0 0 4px" }}
                                                    onClick={() => setJudgeFields(p => ({ ...p, [jKey]: llmVal, [`${jKey}__reason`]: llmJustif ?? "" }))}>← adoptar</button>}
                                            </span>
                                            {fieldVals.length === 0 && (
                                                <span style={{ fontSize: 10, color: "var(--muted)", fontStyle: "italic" }}>Ningún anotador lo corrigió</span>
                                            )}
                                            {fieldVals.map(a => (
                                                <div key={a.id} style={{ fontSize: 10, color: "var(--muted)", display: "flex", alignItems: "baseline", gap: 4 }}>
                                                    👤 {a.annotator}{reviewBadge(a.reviewer_decision)}: <strong style={{ color: "var(--text)" }}>{a.corrected_text ?? "—"}</strong>
                                                    {a.correction_reason && <em style={{ fontSize: 9 }}> ({a.correction_reason})</em>}
                                                    <button
                                                        style={{ fontSize: 9, color: "var(--accent2)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
                                                        onClick={() => setJudgeFields(p => ({ ...p, [jKey]: a.corrected_text ?? "", [`${jKey}__reason`]: a.correction_reason ?? "" }))}>
                                                        ← adoptar
                                                    </button>
                                                </div>
                                            ))}

                                            <input
                                                style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)", color: "var(--text)", padding: "3px 7px", fontSize: 10, width: 120 }}
                                                placeholder="Valor juez..."
                                                value={draft}
                                                onChange={e => setJudgeFields(p => ({ ...p, [jKey]: e.target.value }))} />
                                            <input
                                                style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)", color: "var(--text)", padding: "3px 7px", fontSize: 9, width: 120 }}
                                                placeholder="Motivo (opcional)..."
                                                value={(judgeFields[`${jKey}__reason`] as string) ?? ""}
                                                onChange={e => setJudgeFields(p => ({ ...p, [`${jKey}__reason`]: e.target.value }))} />
                                            <button
                                                disabled={!draft}
                                                onClick={() => {
                                                    const reason = (judgeFields[`${jKey}__reason`] as string) || undefined;
                                                    existing
                                                        ? judgeFieldTextMutation.mutate({ annotationId: existing.id, finalText: draft, reason })
                                                        : judgeDecideNewMutation.mutate({ record_id: record.id, project_id: projectId!, annotation_type: "field", field_name: fieldKey, final_text: draft, reason });
                                                }}
                                                style={{ padding: "3px 10px", borderRadius: "var(--r)", background: draft ? "var(--accent)" : "var(--border)", color: "#fff", border: "none", fontSize: 10, cursor: draft ? "pointer" : "default" }}>
                                                Guardar
                                            </button>

                                            {savedText !== undefined && judgeFields[jKey] === undefined && (
                                                <span style={{ fontSize: 9, color: "var(--green)" }}>✓ guardado</span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
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