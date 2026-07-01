import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback, useRef } from "react";
import { judgeApi } from "../services/api";

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
                {!data?.length && (
                    <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--muted)" }}>
                        <div style={{ fontSize: 28, marginBottom: 8 }}>⚖️</div>
                        <div style={{ fontWeight: 500, color: "var(--text)", marginBottom: 4 }}>Sin registros listos para juzgar</div>
                        <div style={{ fontSize: 12 }}>Los registros aparecen aquí cuando dos anotadores los han completado.</div>
                    </div>
                )}

                {data?.map(({ record, annotations }) => (
                    <div key={record.id} style={S.recCard}>
                        <div style={{ fontSize: 9, textTransform: "uppercase" as const, letterSpacing: "0.1em", color: "var(--muted)", marginBottom: 4 }}>[Registro a juzgar]</div>
                        <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--text)", background: "var(--card)", borderRadius: "var(--r)", padding: 12, margin: "8px 0", borderLeft: `3px solid ${sentColor(record.sentiment_llm)}` }}>
                            {record.content}
                        </div>

                        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
                            🤖 LLM: <strong style={{ color: sentColor(record.sentiment_llm) }}>{sentLabel(record.sentiment_llm)}</strong>
                            {record.topic_llm && <> · topic: {record.topic_llm}</>}
                            {record.world_country && <> · 🌍 {[record.world_city, record.world_country].filter(Boolean).join(", ")}</>}
                            {record.lang && <> · {record.lang}</>}
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(annotations.length, 2)}, 1fr)`, gap: 8, marginBottom: 12 }}>
                            {annotations.map((ann) => (
                                <div key={ann.id} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: 10 }}>
                                    <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>👤 {ann.annotator}</div>
                                    {ann.corrected_sentiment !== undefined && (
                                        <div style={{ fontSize: 12, color: sentColor(ann.corrected_sentiment), fontWeight: 600 }}>
                                            {sentLabel(ann.corrected_sentiment)}
                                        </div>
                                    )}
                                    {ann.pillar && <div style={{ fontSize: 11, color: "var(--teal)" }}>{ann.pillar}: {ann.corrected_value}</div>}
                                    {ann.correction_reason && <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 3 }}>{ann.correction_reason}</div>}
                                </div>
                            ))}
                        </div>

                        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                            <div style={{ fontSize: 11, color: "var(--amber)", marginBottom: 7, fontWeight: 500 }}>⚖️ Tu decisión final:</div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
                                {SENT_OPTS.map((opt) => {
                                    const ann = annotations[0];
                                    if (!ann) return null;
                                    const sel = decisions[ann.id] === opt.v;
                                    return (
                                        <button key={opt.v}
                                            style={{ flex: 1, minWidth: 70, padding: "8px 4px", borderRadius: "var(--r)", border: `1.5px solid ${sel ? opt.color : "var(--border)"}`, fontSize: 11, fontWeight: 500, background: sel ? opt.color + "18" : "var(--card)", color: sel ? opt.color : "var(--muted)", cursor: "pointer", textAlign: "center" as const }}
                                            onClick={() => setDecisions((p) => ({ ...p, [ann.id]: opt.v }))}>
                                            <span style={{ display: "block", fontSize: 16 }}>{opt.icon}</span>
                                            {opt.label}
                                        </button>
                                    );
                                })}
                            </div>
                            {annotations[0] && decisions[annotations[0].id] !== undefined && (
                                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                                    <button
                                        onClick={() => {
                                            const ann = annotations[0];
                                            decideMutation.mutate({ annotationId: ann.id, finalValue: decisions[ann.id] });
                                        }}
                                        style={{ padding: "7px 14px", borderRadius: "var(--r)", background: "var(--accent)", color: "#fff", border: "none", fontSize: 12, fontWeight: 500 }}>
                                        Guardar decisión →
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {toast && (
                <div style={{ ...S.toast, color: toast.ok ? "var(--green)" : "var(--amber)" }}>
                    {toast.ok ? "✓ " : "⚠ "}{toast.msg}
                </div>
            )}
        </div>
    );
}