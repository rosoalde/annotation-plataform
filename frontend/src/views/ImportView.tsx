/**
 * ImportView
 * Carga de datos CSV + metadatos del proyecto en 3 pasos:
 *   1. Selección de archivos (CSV obligatorio, JSON de metadatos opcional)
 *   2. Preview del CSV (primeras 5 filas + resumen de columnas)
 *   3. Confirmar importación → llama POST /records/import-csv
 *
 * Solo accesible para admin y reviewer (controlado por la ruta en main.tsx).
 * Sigue el mismo patrón visual que SentimentView / PilarsView.
 */
import { useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { recordsApi } from "../services/api";
import type { CsvImportResult } from "../types";
import ProjectContextBar from "../components/ProjectContextBar";

// ── Helpers ───────────────────────────────────────────────────────────────
// AÑADIR después de parseCsvPreview (línea ~29):
const CSV_COLUMN_MAP: Record<string, string> = {
    "contenido": "content",
    "sent_subtopic": "sentiment_llm",
    "subtopic": "topic_llm",
    "idioma": "lang",
    "continente": "world_continent",
    "pais": "world_country",
    "region": "world_region",
    "ciudad": "world_city",
    "justicia_eq": "justicia_equidad",
    "confianza": "confianza_institucional",
    "sent_subtopic_just": "justif_sentimiento",
    "subtopic_just": "justif_topic",
    "posicion_just": "justif_posicion",
    "idioma_just": "justif_lang",
    "continente_just": "justif_continente",
    "pais_just": "justif_pais",
    "region_just": "justif_region",
    "ciudad_just": "justif_ciudad",
    "legitimacion_just": "justif_legitimacion",
    "efectividad_just": "justif_efectividad",
    "justicia_eq_just": "justif_justicia_equidad",
    "confianza_just": "justif_confianza_institucional",
    "titulo_video": "titulo_padre",
    "canal": "fuente",
    "uri": "url_post",
};
function parseCsvPreview(text: string): { headers: string[]; rows: string[][] } {
    // Manejar BOM de Excel
    const clean = text.replace(/^\uFEFF/, "");
    // const lines = clean.split(/\r?\n/).filter(Boolean);
    const lines: string[] = [];
    let inQuote = false;
    let current = "";
    for (const char of clean) {
        if (char === '"') { inQuote = !inQuote; current += char; }
        else if ((char === "\n" || char === "\r") && !inQuote) {
            if (current.trim()) lines.push(current);
            current = "";
        } else { current += char; }
    }
    if (current.trim()) lines.push(current);
    if (lines.length === 0) return { headers: [], rows: [] };
    const delimiter = lines[0]?.includes(";") && !lines[0]?.includes(",") ? ";" : ",";
    const split = (line: string) => line.split(delimiter).map((c) => c.replace(/^"|"$/g, "").trim());
    const rawHeaders = split(lines[0]);
    const headers = rawHeaders.map(h => CSV_COLUMN_MAP[h] ?? h);
    const rows = lines.slice(1, 6).map(split);   // primeras 5 filas
    return { headers, rows };
}



// Columnas del CSV que esta plataforma reconoce (para mostrar al usuario qué se detectó)
const KNOWN_COLS = new Set([
    "external_id", "content", "platform", "tipo", "fecha", "fuente",
    "titulo_padre", "cuerpo_padre", "descripcion_padre", "tweet_anterior",
    "idioma", "lang", "world_continent", "world_country", "world_region", "world_city",
    "sentiment_llm", "topic_llm", "legitimacion", "efectividad",
    "justicia_equidad", "confianza_institucional",
    "relevancia_ia", "pertinente", "model_reasoning",
    "url_post", "pertinencia", "justif_pertinencia", "posicion", "justif_posicion",
    "justif_topic", "justif_sentimiento",
    "justif_legitimacion", "justif_efectividad", "justif_justicia_equidad",
    "justif_confianza_institucional", "justif_lang", "justif_continente",
    "justif_pais", "justif_region", "justif_ciudad", //"codigo_pais",
]);

type Step = 1 | 2 | 3;

interface MetaForm {
    name: string;
    desc_tema: string;
    population_scope: string;
}

// ── Componente principal ───────────────────────────────────────────────────

export default function ImportView() {
    const { id: projectId } = useParams<{ id: string }>();
    const navigate = useNavigate();

    const [step, setStep] = useState<Step>(1);
    const [csvFile, setCsvFile] = useState<File | null>(null);
    const [csvText, setCsvText] = useState<string>("");
    const [preview, setPreview] = useState<{ headers: string[]; rows: string[][] } | null>(null);
    const [meta, setMeta] = useState<MetaForm>({ name: "", desc_tema: "", population_scope: "" });
    const [result, setResult] = useState<CsvImportResult | null>(null);
    const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
    const csvInputRef = useRef<HTMLInputElement>(null);

    const showToast = useCallback((msg: string, ok = true) => {
        setToast({ msg, ok });
        setTimeout(() => setToast(null), 3000);
    }, []);

    // Leer CSV al seleccionarlo
    const handleCsvChange = async (file: File) => {
        setCsvFile(file);
        const text = await file.text();
        setCsvText(text);
        setPreview(parseCsvPreview(text));
    };

    const importMutation = useMutation({
        mutationFn: () => {
            const metaPayload = Object.fromEntries(
                Object.entries(meta).filter(([, v]) => v.trim() !== "")
            );
            return recordsApi.importCsv(projectId!, csvFile!, metaPayload);
        },
        onSuccess: (data) => {
            setResult(data);
            setStep(3);
        },
        onError: (err: any) => {
            const detail = err?.response?.data?.detail;
            showToast(typeof detail === "string" ? detail : "Error al importar", false);
        },
    });

    const knownCount = preview ? preview.headers.filter((h) => KNOWN_COLS.has(h)).length : 0;
    const unknownCount = preview ? preview.headers.length - knownCount : 0;
    const estimatedRows = csvText
        ? csvText.split(/\r?\n/).filter(Boolean).length - 1
        : 0;

    return (
        <div style={S.page}>
            <div style={S.topbar}>
                <span style={S.topbarTitle}>⬆ Importar datos CSV</span>
                <StepBadge step={step} />
            </div>

            <div style={S.content}>
                <ProjectContextBar projectId={projectId!} />
                {/* ── PASO 1: Selección de archivos ──────────────────── */}
                {step === 1 && (
                    <>
                        <SectionLabel>Archivo CSV de posts/comentarios</SectionLabel>
                        <DropZone
                            accept=".csv"
                            file={csvFile}
                            label="posts_anotados.csv"
                            hint="El CSV debe tener cabecera. Columnas extra son ignoradas."
                            inputRef={csvInputRef}
                            onChange={handleCsvChange}
                        />

                        {preview && (
                            <div style={S.infoBox}>
                                <span style={{ color: "var(--green)" }}>✓ {estimatedRows} filas detectadas</span>
                                <span style={{ color: "var(--text)", marginLeft: 12 }}>
                                    {knownCount} columnas reconocidas
                                </span>
                                {unknownCount > 0 && (
                                    <span style={{ color: "var(--muted)", marginLeft: 12 }}>
                                        · {unknownCount} columnas extra (ignoradas)
                                    </span>
                                )}
                            </div>
                        )}

                        <SectionLabel style={{ marginTop: 24 }}>
                            Metadatos del proyecto <span style={{ color: "var(--muted)", fontWeight: 400 }}>(opcional)</span>
                        </SectionLabel>
                        <div style={S.card}>
                            <FieldRow label="Nombre del proyecto (sobreescribe el actual)">
                                <input style={S.input} placeholder="Ej: Análisis político Andalucía 2024"
                                    value={meta.name}
                                    onChange={(e) => setMeta((p) => ({ ...p, name: e.target.value }))} />
                            </FieldRow>
                            <FieldRow label="Descripción técnica del tema">
                                <textarea style={S.textarea} rows={3}
                                    placeholder="Descripción generada por el LLM, editable..."
                                    value={meta.desc_tema}
                                    onChange={(e) => setMeta((p) => ({ ...p, desc_tema: e.target.value }))} />
                            </FieldRow>
                            <FieldRow label="Contexto geográfico (population_scope)">
                                <input style={S.input} placeholder="Ej: Andalucía, España"
                                    value={meta.population_scope}
                                    onChange={(e) => setMeta((p) => ({ ...p, population_scope: e.target.value }))} />
                            </FieldRow>
                        </div>

                        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
                            <button
                                style={{ ...S.primaryBtn, opacity: !csvFile ? 0.45 : 1 }}
                                disabled={!csvFile}
                                onClick={() => setStep(2)}>
                                Ver preview →
                            </button>
                        </div>
                    </>
                )}

                {/* ── PASO 2: Preview del CSV ─────────────────────────── */}
                {step === 2 && preview && (
                    <>
                        <SectionLabel>Vista previa del CSV</SectionLabel>
                        <div style={S.statsRow}>
                            <StatChip color="var(--green)" label="Filas a importar" value={estimatedRows} />
                            <StatChip color="var(--accent2)" label="Columnas reconocidas" value={knownCount} />
                            <StatChip color="var(--muted)" label="Columnas extra" value={unknownCount} />
                        </div>

                        <div style={{ overflowX: "auto", marginBottom: 16 }}>
                            <table style={S.table}>
                                <thead>
                                    <tr>
                                        {preview.headers.map((h) => (
                                            <th key={h} style={{
                                                ...S.th,
                                                color: KNOWN_COLS.has(h) ? "var(--accent2)" : "var(--muted)",
                                            }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {preview.rows.map((row, i) => (
                                        <tr key={i} style={i % 2 === 0 ? {} : { background: "var(--card)" }}>
                                            {row.map((cell, j) => (
                                                <td key={j} style={S.td} title={cell}>
                                                    {cell.length > 60 ? cell.slice(0, 60) + "…" : cell}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Columnas no reconocidas */}
                        {unknownCount > 0 && (
                            <div style={{ ...S.infoBox, borderColor: "var(--border2)" }}>
                                <span style={{ color: "var(--muted)", fontSize: 11 }}>
                                    ⚠ Columnas ignoradas: {preview.headers.filter((h) => !KNOWN_COLS.has(h)).join(", ")}
                                </span>
                            </div>
                        )}

                        {/* Columna content obligatoria */}
                        {!preview.headers.includes("content") && (
                            <div style={{ ...S.infoBox, borderColor: "var(--red)", color: "var(--red)" }}>
                                ✗ La columna <code>content</code> es obligatoria y no se encontró en el CSV.
                            </div>
                        )}

                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
                            <button style={S.ghostBtn} onClick={() => setStep(1)}>← Atrás</button>
                            <button
                                style={{
                                    ...S.primaryBtn,
                                    opacity: !preview.headers.includes("content") ? 0.45 : 1
                                }}
                                disabled={!preview.headers.includes("content") || importMutation.isPending}
                                onClick={() => importMutation.mutate()}>
                                {importMutation.isPending
                                    ? "Importando..."
                                    : `Importar ${estimatedRows} registros →`}
                            </button>
                        </div>
                    </>
                )}

                {/* ── PASO 3: Resultado ───────────────────────────────── */}
                {step === 3 && result && (
                    <>
                        <div style={S.successBanner}>
                            <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
                            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>
                                Importación completada
                            </div>
                        </div>

                        <div style={S.statsRow}>
                            <StatChip color="var(--green)" label="Importados" value={result.imported} />
                            <StatChip color="var(--amber)" label="Omitidos" value={result.skipped} />
                            <StatChip color="var(--red)" label="Errores" value={result.errors.length} />
                        </div>

                        {result.errors.length > 0 && (
                            <>
                                <SectionLabel style={{ marginTop: 16 }}>Filas con errores</SectionLabel>
                                <div style={{ ...S.card, maxHeight: 200, overflowY: "auto" }}>
                                    {result.errors.map((e, i) => (
                                        <div key={i} style={{ fontSize: 11, color: "var(--red)", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                                            <span style={{ fontFamily: "monospace" }}>Fila {e.fila}:</span> {e.error}
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}

                        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                            <button style={S.ghostBtn} onClick={() => {
                                setStep(1); setCsvFile(null); setCsvText(""); setPreview(null); setResult(null);
                            }}>
                                Importar otro CSV
                            </button>
                            <button style={S.primaryBtn}
                                onClick={() => navigate(`/projects/${projectId}/anotar`)}>
                                Ir a anotar →
                            </button>
                        </div>
                    </>
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

// ── Sub-componentes ────────────────────────────────────────────────────────

function StepBadge({ step }: { step: Step }) {
    return (
        <div style={{ display: "flex", gap: 4 }}>
            {([1, 2, 3] as Step[]).map((s) => (
                <span key={s} style={{
                    width: 22, height: 22, borderRadius: "50%", display: "flex",
                    alignItems: "center", justifyContent: "center",
                    fontSize: 10, fontFamily: "monospace", fontWeight: 600,
                    background: step === s ? "var(--accent)" : step > s ? "rgba(46,194,126,0.2)" : "var(--card)",
                    color: step === s ? "#fff" : step > s ? "var(--green)" : "var(--muted)",
                    border: `1px solid ${step === s ? "var(--accent)" : step > s ? "rgba(46,194,126,0.3)" : "var(--border)"}`,
                }}>
                    {step > s ? "✓" : s}
                </span>
            ))}
        </div>
    );
}

function SectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
    return (
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "var(--muted)", marginBottom: 10, ...style }}>
            {children}
        </div>
    );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{label}</div>
            {children}
        </div>
    );
}

function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: "10px 14px", textAlign: "center" as const, minWidth: 90 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: "monospace" }}>{value}</div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{label}</div>
        </div>
    );
}

function DropZone({
    accept, file, label, hint, inputRef, onChange
}: {
    accept: string; file: File | null; label: string; hint: string;
    inputRef: React.RefObject<HTMLInputElement>; onChange: (f: File) => void;
}) {
    const [drag, setDrag] = useState(false);
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault(); setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) onChange(f);
    };
    return (
        <div
            style={{
                border: `1.5px dashed ${drag ? "var(--accent)" : file ? "var(--green)" : "var(--border2)"}`,
                borderRadius: "var(--r2)", padding: "24px 20px", textAlign: "center" as const,
                cursor: "pointer", transition: "all 0.15s", marginBottom: 10,
                background: file ? "rgba(46,194,126,0.05)" : "transparent",
            }}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}>
            <input ref={inputRef} type="file" accept={accept} style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onChange(f); }} />
            <div style={{ fontSize: 24, marginBottom: 6 }}>{file ? "📄" : "⬆"}</div>
            {file ? (
                <>
                    <div style={{ fontSize: 13, color: "var(--green)", fontWeight: 500 }}>{file.name}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                        {(file.size / 1024).toFixed(0)} KB — haz clic para cambiar
                    </div>
                </>
            ) : (
                <>
                    <div style={{ fontSize: 13, color: "var(--text)" }}>{label}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>Arrastra o haz clic</div>
                    <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 3 }}>{hint}</div>
                </>
            )}
        </div>
    );
}

// ── Estilos ────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
    page: { display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)" },
    topbar: { height: 48, background: "var(--surface)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", padding: "0 22px", gap: 12, flexShrink: 0 },
    topbarTitle: { fontSize: 13, fontWeight: 500, color: "var(--text)", flex: 1 },
    content: { flex: 1, overflowY: "auto", padding: 22, maxWidth: 860 },
    card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r2)", padding: 16, marginBottom: 12 },
    infoBox: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: "8px 12px", marginBottom: 10, fontSize: 12 },
    statsRow: { display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" as const },
    input: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)", color: "var(--text)", padding: "8px 11px", fontSize: 13, width: "100%" },
    textarea: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)", color: "var(--text)", padding: "8px 11px", fontSize: 13, width: "100%", resize: "vertical" as const },
    table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 11, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r)" },
    th: { padding: "8px 10px", borderBottom: "1px solid var(--border)", fontWeight: 600, textAlign: "left" as const, whiteSpace: "nowrap" as const, fontFamily: "monospace", fontSize: 10, letterSpacing: "0.05em" },
    td: { padding: "6px 10px", borderBottom: "1px solid var(--border)", color: "var(--muted)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const },
    primaryBtn: { padding: "8px 16px", borderRadius: "var(--r)", background: "var(--accent)", color: "#fff", border: "none", fontSize: 12, fontWeight: 500, cursor: "pointer", transition: "opacity 0.12s" },
    ghostBtn: { padding: "8px 16px", borderRadius: "var(--r)", background: "transparent", color: "var(--muted)", border: "1px solid var(--border)", fontSize: 12, cursor: "pointer" },
    successBanner: { textAlign: "center" as const, padding: "28px 20px", background: "rgba(46,194,126,0.07)", border: "1px solid rgba(46,194,126,0.2)", borderRadius: "var(--r2)", marginBottom: 16 },
    toast: { position: "fixed" as const, bottom: 20, right: 20, background: "var(--card)", border: "1px solid var(--border2)", borderRadius: "var(--r)", padding: "10px 16px", fontSize: 12, zIndex: 200 },
};