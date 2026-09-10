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
const platColor = (p?: string) => ({ reddit: "#ff4500", bluesky: "#0085ff", youtube: "#ff0000", twitter: "#1da1f2", telegram: "#008000" }[(p ?? "").toLowerCase()] ?? "#6b7080");
const platIcon = (p?: string) => ({ reddit: "🔴", bluesky: "🔵", youtube: "▶", twitter: "🐦", telegram: "📱" }[(p ?? "").toLowerCase()] ?? "🌐");

const PILARS = [
    { key: "legitimacion", label: "Legitimación", justifKey: "justif_legitimacion", color: "#7a9bf5" },
    { key: "efectividad", label: "Efectividad", justifKey: "justif_efectividad", color: "#2ec27e" },
    { key: "justicia_equidad", label: "Justicia y equidad", justifKey: "justif_justicia_equidad", color: "#28bfb0" },
    { key: "confianza_institucional", label: "Confianza instit.", justifKey: "justif_confianza_institucional", color: "#9b72ef" },
] as const;
const pilarLabel = (v?: number | null) => ({ 1: "+1", "-1": "−1", 0: "0", 2: "N/A" }[String(v ?? "")] ?? "—");
const PILAR_BTNS = [{ v: 1, l: "+1" }, { v: 0, l: "0" }, { v: -1, l: "−1" }, { v: 2, l: "N/A" }];

// Opciones para desplegables — extraídas de los recursos de la plataforma
const PERTINENCIA_OPTS = ["relevante", "irrelevante"];
const POSTURA_OPTS = [
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
const PERTINENCIA_POSTURA_FIELDS: Array<{ key: string; label: string; justifKey: string | null; color: string }> = [
    { key: "pertinencia", label: "Pertinencia", justifKey: "justif_pertinencia", color: "#e8962a" },
    { key: "postura", label: "Postura", justifKey: "justif_postura", color: "#7a9bf5" },
];

const GEO_FIELDS: Array<{ key: string; label: string; justifKey: string | null }> = [
    { key: "lang", label: "Idioma", justifKey: "justif_lang" },
    { key: "world_continent", label: "Continente", justifKey: "justif_continente" },
    { key: "world_country", label: "País", justifKey: "justif_pais" },
    { key: "world_region", label: "Región", justifKey: "justif_region" },
    { key: "world_city", label: "Ciudad", justifKey: "justif_ciudad" },
    // { key: "codigo_pais", label: "Código país (ISO)", justifKey: null },
];

const TEXT_FIELDS = [...PERTINENCIA_POSTURA_FIELDS, ...GEO_FIELDS];

// ── Ayuda contextual (i) ──────────────────────────────────────────────────
// NOTA: el contenido de "postura" y "sentiment" reproduce los ejemplos que
// definisteis vosotros. El resto (pertinencia, topic, geolocalización y los
// 4 pilares) son un primer borrador redactado a partir del significado
// habitual de cada campo — revisadlo y corregidlo antes de darlo por bueno,
// especialmente los 4 pilares, donde no tenía vuestra definición operativa
// exacta.
type HelpContent = { que: string; valores?: string; ejemplos: string; regla?: string };
export const HELP: Record<string, HelpContent> = {
    pertinencia: {
        que: "Indica si este contenido tiene relación con el tema que se está analizando en el proyecto, o si es ajeno a él (spam, publicidad, otro asunto sin relación).",
        valores: "relevante — el contenido trata sobre el tema del proyecto.\nirrelevante — no tiene relación con el tema.",
        ejemplos: "Un comentario que opina sobre el tema del proyecto → relevante.\nUn comentario publicitario o sobre un asunto totalmente distinto → irrelevante.",
    },
    postura: {
        que: "La postura indica la orientación global del autor respecto al tema de análisis (ver arriba el contexto del proyecto).",
        valores: "1 → A favor / Pro\n0 → Neutro / Mixto\n-1 → En contra / Anti\n2 → Sin postura inferible",
        ejemplos: "\"El servicio funciona muy bien.\" → Postura = 1\n\"El servicio funciona fatal.\" → Postura = -1\n\"El servicio funciona bien, pero las bicicletas están siempre rotas.\" → Postura = 1 (el balance general es favorable)",
    },
    topic: {
        que: "El topic es el aspecto o subtema concreto del que habla este fragmento dentro del tema general del proyecto (por ejemplo: \"precio\", \"atención al cliente\", \"estado del servicio\"), no el tema global en sí.",
        ejemplos: "En \"El servicio es bueno pero muy caro\", el topic podría ser \"precio\".",
        regla: "Si el fragmento toca varios aspectos a la vez, elige el que tenga más peso o sea el foco principal de la frase.",
    },
    sentiment: {
        que: "El sentimiento indica el tono emocional del autor específicamente hacia el topic que has identificado arriba — no necesariamente la postura global del autor sobre el conjunto del comentario.",
        valores: "Mismo esquema que postura: 1 positivo, 0 neutro, -1 negativo, 2 no relacionado / no determinable.",
        ejemplos: "\"El servicio es fantástico, pero las bicicletas están siempre rotas.\"\nPostura → Positiva (balance general favorable)\nTopic → Estado de las bicicletas\nSentimiento del topic → Negativo (sobre ESE aspecto concreto)",
        regla: "Pregúntate primero \"¿de qué habla el topic?\" y después \"¿qué tono tiene el autor sobre ESE aspecto?\", en vez de valorar el comentario en su conjunto (eso es la postura).",
    },
    lang: {
        que: "El idioma en el que está escrito el contenido, en formato de código ISO de dos letras.",
        ejemplos: "\"This is great\" → en\n\"Está genial\" → es",
    },
    world_continent: {
        que: "El continente de origen inferido para el autor o el contenido, a partir de señales como el idioma, la ubicación declarada o el contexto del post.",
        valores: "EU, NA, SA, AF, AS, OC, o N/A si no se puede determinar.",
        ejemplos: "Un perfil que menciona Madrid → EU.",
        regla: "Si no hay ninguna señal razonable, marca N/A en vez de adivinar.",
    },
    world_country: {
        que: "El país de origen inferido para el autor o el contenido.",
        ejemplos: "Menciones de ciudades, gentilicios o contexto claro del post permiten inferirlo (p. ej. \"aquí en Bogotá\" → Colombia).",
        regla: "Si solo intuyes el continente pero no el país, deja este campo vacío en vez de adivinar.",
    },
    world_region: {
        que: "La región o zona dentro del país (comunidad autónoma, estado, provincia...), cuando el contenido permite ese nivel de detalle.",
        ejemplos: "\"Vivo en Valencia\" → región: Comunidad Valenciana.",
        regla: "Solo rellénalo si tienes una señal clara; si solo sabes el país, déjalo vacío.",
    },
    world_city: {
        que: "La ciudad concreta de origen, cuando es identificable de forma explícita.",
        ejemplos: "\"Aquí en Sevilla llueve mucho\" → ciudad: Sevilla.",
        regla: "Es el nivel más específico de localización — solo se rellena con una mención explícita, no con una suposición.",
    },
    legitimacion: {
        que: "Indica si el autor considera que la autoridad, decisión o institución de la que habla tiene derecho a actuar como lo hace, independientemente de si está de acuerdo con el resultado.",
        valores: "1 → Se reconoce como legítima\n0 → Postura neutra o mixta\n-1 → Se cuestiona su legitimidad\n2 → No aplica / no se menciona",
        ejemplos: "\"El ayuntamiento tiene todo el derecho a regular esto\" → 1\n\"Esto se ha impuesto sin ningún derecho\" → -1",
        regla: "No confundir con \"efectividad\": aquí se juzga si la autoridad PUEDE/DEBE actuar así, no si el resultado de su acción es bueno o malo.",
    },
    efectividad: {
        que: "Indica si el autor considera que la medida, servicio o actuación de la que habla ha funcionado o conseguido su objetivo.",
        valores: "1 → Se percibe como efectiva\n0 → Mixta o neutra\n-1 → Se percibe como inefectiva / un fracaso\n2 → No aplica",
        ejemplos: "\"Ha reducido los atascos notablemente\" → 1\n\"No ha cambiado nada, sigue igual de mal\" → -1",
        regla: "Juzga el resultado práctico, no si estás de acuerdo con la decisión en sí (eso es postura o legitimación).",
    },
    justicia_equidad: {
        que: "Indica si el autor percibe la medida o situación como justa/equitativa para los distintos grupos afectados, o si señala un trato desigual.",
        valores: "1 → Se percibe como justa/equitativa\n0 → Mixta o neutra\n-1 → Se percibe como injusta/desigual\n2 → No aplica",
        ejemplos: "\"Esto beneficia a todos por igual\" → 1\n\"Esto solo favorece a unos pocos\" → -1",
        regla: "Busca menciones de trato desigual, favoritismo o reparto entre grupos, no una opinión general sobre si algo es bueno o malo.",
    },
    confianza_institucional: {
        que: "Indica si el comentario expresa confianza o desconfianza hacia la institución o autoridad responsable, más allá de la medida concreta que se discute.",
        valores: "1 → Expresa confianza\n0 → Mixta o neutra\n-1 → Expresa desconfianza / escepticismo\n2 → No aplica",
        ejemplos: "\"Confío en que lo gestionarán bien\" → 1\n\"Ya no me creo nada de lo que dicen\" → -1",
        regla: "Fíjate en si el autor habla de la institución en general (confianza) o solo de si esta medida concreta funcionó (eso es efectividad).",
    },
};

export function HelpIcon({ fieldKey }: { fieldKey: string }) {
    const [open, setOpen] = useState(false);
    const h = HELP[fieldKey];
    if (!h) return null;
    return (
        <span style={{ position: "relative", display: "inline-block", marginLeft: 5 }}>
            <button type="button" onClick={() => setOpen((o) => !o)} style={S.helpBtn} aria-label="Ayuda sobre este campo">i</button>
            {open && (
                <div style={S.helpPopover} onClick={(e) => e.stopPropagation()}>
                    <div style={S.helpSectionTitle}>¿Qué estoy viendo?</div>
                    <div style={S.helpText}>{h.que}</div>
                    {h.valores && (
                        <>
                            <div style={S.helpSectionTitle}>Valores posibles</div>
                            <div style={S.helpText}>{h.valores}</div>
                        </>
                    )}
                    <div style={S.helpSectionTitle}>Ejemplos</div>
                    <div style={S.helpText}>{h.ejemplos}</div>
                    {h.regla && (
                        <>
                            <div style={S.helpSectionTitle}>Cómo distinguir casos parecidos</div>
                            <div style={S.helpText}>{h.regla}</div>
                        </>
                    )}
                    <button type="button" style={S.helpClose} onClick={() => setOpen(false)}>Cerrar</button>
                </div>
            )}
        </span>
    );
}

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

    // Decisión CONFIRMO / NO CONFIRMO por (registro, campo). "confirmedFields"
    // = el anotador pulsó CONFIRMO (adopta valor + justificación del LLM tal cual).
    // "rejecting" = el anotador pulsó NO CONFIRMO y está viendo el formulario
    // de corrección (con valor y justificación propios, todavía vacíos hasta
    // que los rellene).
    const [confirmedFields, setConfirmedFields] = useState<Record<string, Set<string>>>({});
    const [rejecting, setRejecting] = useState<Record<string, Set<string>>>({});

    const markRejecting = (recId: string, key: string) => {
        setRejecting((prev) => ({ ...prev, [recId]: new Set([...(prev[recId] ?? []), key]) }));
        setConfirmedFields((prev) => {
            const s = new Set(prev[recId] ?? []);
            s.delete(key);
            return { ...prev, [recId]: s };
        });
    };
    // Permite deshacer una decisión (CONFIRMO o NO CONFIRMO) y volver a ver
    // los dos botones, por si el anotador se ha equivocado al pulsar.
    const backToGate = (recId: string, key: string) => {
        setConfirmedFields((prev) => { const s = new Set(prev[recId] ?? []); s.delete(key); return { ...prev, [recId]: s }; });
        setRejecting((prev) => { const s = new Set(prev[recId] ?? []); s.delete(key); return { ...prev, [recId]: s }; });
    };

    const confirmField = (recId: string, key: string) => {
        setConfirmedFields((prev) => ({ ...prev, [recId]: new Set([...(prev[recId] ?? []), key]) }));
        setRejecting((prev) => { const s = new Set(prev[recId] ?? []); s.delete(key); return { ...prev, [recId]: s }; });
        const rec = (data?.records ?? []).find((r) => r.id === recId);
        const llmVal = rec ? ((rec as any)[key] as string | undefined) ?? "" : "";
        const justifKey = TEXT_FIELDS.find((f) => f.key === key)?.justifKey;
        const llmJustif = justifKey && rec ? ((rec as any)[justifKey] as string | undefined) ?? "" : "";
        // CONFIRMO adopta valor Y justificación del LLM — el anotador no
        // tiene que volver a escribir ninguno de los dos.
        setField(recId, key, { value: llmVal, reason: llmJustif });
    };
    const confirmTopic = (recId: string) => {
        setConfirmedFields((prev) => ({ ...prev, [recId]: new Set([...(prev[recId] ?? []), "topic"]) }));
        setRejecting((prev) => { const s = new Set(prev[recId] ?? []); s.delete("topic"); return { ...prev, [recId]: s }; });
        const rec = (data?.records ?? []).find((r) => r.id === recId);
        setAnn(recId, { topic: rec?.topic_llm ?? "", topic_reason: rec?.justif_topic ?? "" });
    };
    const confirmSentiment = (recId: string) => {
        setConfirmedFields((prev) => ({ ...prev, [recId]: new Set([...(prev[recId] ?? []), "sentiment"]) }));
        setRejecting((prev) => { const s = new Set(prev[recId] ?? []); s.delete("sentiment"); return { ...prev, [recId]: s }; });
        const rec = (data?.records ?? []).find((r) => r.id === recId);
        setAnn(recId, { sentiment: rec?.sentiment_llm ?? 2, sentiment_reason: rec?.justif_sentimiento ?? "" });
    };
    const confirmPilar = (recId: string, key: string) => {
        setConfirmedFields((prev) => ({ ...prev, [recId]: new Set([...(prev[recId] ?? []), key]) }));
        setRejecting((prev) => { const s = new Set(prev[recId] ?? []); s.delete(key); return { ...prev, [recId]: s }; });
        const rec = (data?.records ?? []).find((r) => r.id === recId);
        const p = PILARS.find((pp) => pp.key === key)!;
        const llmVal = rec ? ((rec as any)[key] as number | undefined) : undefined;
        const llmJustif = rec ? ((rec as any)[p.justifKey] as string | undefined) ?? "" : "";
        setPilar(recId, key, { value: llmVal ?? 2, reason: llmJustif });
    };

    const showToast = useCallback((msg: string, type: "ok" | "warn" = "ok") => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 2600);
    }, []);

    const [refreshRecordId, setRefreshRecordId] = useState<string | null>(null);

    const { data, isLoading, error } = useQuery({
        queryKey: ["records", projectId, "annotate", offset, refreshRecordId],
        queryFn: () =>
            recordsApi.list(projectId!, {
                annotation_type: "sentiment",
                limit: LIMIT,
                offset: refreshRecordId ? 0 : offset,
                ...(refreshRecordId ? { include_record_id: refreshRecordId } : {}),
            }),
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
                if (!pa || (pa.value === undefined && pa.reason === undefined)) continue;
                const llmVal = (rec as any)[p.key] as number | undefined;
                const valueToSave = pa.value !== undefined ? pa.value : (llmVal ?? 2);
                calls.push(annotationsApi.savePilar(projectId!, {
                    record_id: rec.id, project_id: projectId!, pilar: p.key,
                    original_value: llmVal ?? 2, corrected_value: valueToSave,
                    is_correction: valueToSave !== llmVal, correction_reason: pa.reason ?? undefined,
                }));
            }

            for (const f of TEXT_FIELDS) {
                const fa = ann.fields[f.key];
                if (!fa || (fa.value === undefined && fa.reason === undefined)) continue;
                const llmVal = ((rec as any)[f.key] as string | undefined) ?? "";
                const valueToSave = fa.value !== undefined ? fa.value : llmVal;
                calls.push(annotationsApi.saveField(projectId!, {
                    record_id: rec.id, project_id: projectId!, field_name: f.key,
                    original_text: llmVal, corrected_text: valueToSave,
                    is_correction: valueToSave !== llmVal, correction_reason: fa.reason ?? undefined,
                }));
            }

            await Promise.all(calls);
        },
        onSuccess: (_, { rec }) => {
            setSaving((prev) => { const n = { ...prev }; delete n[rec.id]; return n; });
            setAnnotations((prev) => { const n = { ...prev }; delete n[rec.id]; return n; });
            setConfirmedFields((prev) => { const n = { ...prev }; delete n[rec.id]; return n; });
            setRejecting((prev) => { const n = { ...prev }; delete n[rec.id]; return n; });
            setRefreshRecordId(rec.id);
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

    const handleSaveField = async (
        rec: AnnotRecord,
        key: string
    ) => {
        const ann = getAnn(rec.id);

        try {
            setSaving((prev) => ({ ...prev, [rec.id]: true }));

            // ── Campos de texto: pertinencia, postura, idioma, geo ──
            const textField = TEXT_FIELDS.find((f) => f.key === key);

            if (textField) {
                const fa = ann.fields[key];
                const llmVal = ((rec as any)[key] as string | undefined) ?? "";
                const value = fa?.value ?? "";
                const reason = fa?.reason ?? "";

                if (!value) {
                    showToast(`Falta el valor de ${textField.label}`, "warn");
                    return;
                }

                if (!reason.trim()) {
                    showToast(`Falta la justificación de ${textField.label}`, "warn");
                    return;
                }

                await annotationsApi.saveField(projectId!, {
                    record_id: rec.id,
                    project_id: projectId!,
                    field_name: key,
                    original_text: llmVal,
                    corrected_text: value,
                    is_correction: isCorrection,
                    correction_reason: reason,
                });
            }

            // ── Tema / topic ──
            else if (key === "topic") {
                if (!ann.topic?.trim()) {
                    showToast("Falta el valor de Tema / topic", "warn");
                    return;
                }

                if (!ann.topic_reason?.trim()) {
                    showToast("Falta la justificación de Tema / topic", "warn");
                    return;
                }

                await annotationsApi.saveSentiment(projectId!, {
                    record_id: rec.id,
                    project_id: projectId!,
                    original_sentiment: rec.sentiment_llm ?? 2,
                    corrected_sentiment: rec.sentiment_llm ?? 2,
                    is_correction: true,
                    original_topic: rec.topic_llm ?? undefined,
                    corrected_topic: ann.topic,
                    topic_reason: ann.topic_reason,
                });
            }

            // ── Sentimiento ──
            else if (key === "sentiment") {
                if (ann.sentiment === undefined) {
                    showToast("Falta el valor de Sentimiento", "warn");
                    return;
                }

                if (!ann.sentiment_reason?.trim()) {
                    showToast("Falta la justificación de Sentimiento", "warn");
                    return;
                }

                await annotationsApi.saveSentiment(projectId!, {
                    record_id: rec.id,
                    project_id: projectId!,
                    original_sentiment: rec.sentiment_llm ?? 2,
                    corrected_sentiment: ann.sentiment,
                    is_correction: true,
                    correction_reason: ann.sentiment_reason,
                    original_topic: rec.topic_llm ?? undefined,
                    corrected_topic: rec.topic_llm ?? undefined,
                });
            }

            // ── Pilares ──
            else {
                const pilar = PILARS.find((p) => p.key === key);

                if (pilar) {
                    const pa = ann.pilars[key];

                    if (pa?.value === undefined) {
                        showToast(`Falta el valor de ${pilar.label}`, "warn");
                        return;
                    }

                    if (!pa.reason?.trim()) {
                        showToast(`Falta la justificación de ${pilar.label}`, "warn");
                        return;
                    }

                    const llmVal = (rec as any)[key] as number | undefined;

                    await annotationsApi.savePilar(projectId!, {
                        record_id: rec.id,
                        project_id: projectId!,
                        pilar: key,
                        original_value: llmVal ?? 2,
                        corrected_value: pa.value,
                        is_correction: true,
                        correction_reason: pa.reason,
                    });
                }
            }

            // El backend ya ha persistido la anotación.
            // Limpiamos TODO el estado React del registro para que
            // la pantalla no siga dependiendo de los valores locales.
            setAnnotations((prev) => {
                const next = { ...prev };
                delete next[rec.id];
                return next;
            });

            setConfirmedFields((prev) => {
                const next = { ...prev };
                delete next[rec.id];
                return next;
            });

            setRejecting((prev) => {
                const next = { ...prev };
                delete next[rec.id];
                return next;
            });

            // Forzamos una nueva consulta del record concreto.
            // La pantalla pasará a utilizar rec.annotator_*.
            setRefreshRecordId(rec.id);

            qc.invalidateQueries({
                queryKey: ["records", projectId, "annotate"],
            });

            showToast("Guardado ✓");

        } catch (err) {
            console.error(err);
            showToast("Error al guardar", "warn");
        } finally {
            setSaving((prev) => {
                const n = { ...prev };
                delete n[rec.id];
                return n;
            });
        }
    };
    const handleSave = (rec: AnnotRecord) => {
        const ann = getAnn(rec.id);
        const confirmed = confirmedFields[rec.id] ?? new Set<string>();
        const rejected = rejecting[rec.id] ?? new Set<string>();

        // Campos con valor del LLM que todavía no tienen ninguna decisión
        // (ni CONFIRMO ni NO CONFIRMO).
        const pending: string[] = [];
        for (const f of TEXT_FIELDS) {
            const llmVal = ((rec as any)[f.key] as string | undefined) ?? "";
            if (llmVal && !confirmed.has(f.key) && !rejected.has(f.key)) pending.push(f.label);
        }
        if (rec.topic_llm && !confirmed.has("topic") && !rejected.has("topic")) pending.push("Tema / topic");
        if (rec.sentiment_llm !== undefined && rec.sentiment_llm !== null && !confirmed.has("sentiment") && !rejected.has("sentiment")) pending.push("Sentimiento (topic)");
        for (const p of PILARS) {
            const llmVal = (rec as any)[p.key] as number | undefined;
            if (llmVal !== undefined && llmVal !== null && !confirmed.has(p.key) && !rejected.has(p.key)) pending.push(p.label);
        }
        if (pending.length > 0) {
            const ok = window.confirm(
                `⚠ Los siguientes campos no tienen decisión (ni CONFIRMO ni NO CONFIRMO):\n\n${pending.join(", ")}\n\n¿Guardar igualmente?`
            );
            if (!ok) return;
        }

        // Campos marcados NO CONFIRMO: exigir valor Y justificación propios.
        const missing: string[] = [];
        for (const f of TEXT_FIELDS) {
            if (!rejected.has(f.key)) continue;
            const fa = ann.fields[f.key];
            if (!fa?.value) missing.push(`${f.label} (valor)`);
            if (!fa?.reason) missing.push(`${f.label} (justificación)`);
        }
        if (rejected.has("topic")) {
            if (!ann.topic) missing.push("Tema / topic (valor)");
            if (!ann.topic_reason) missing.push("Tema / topic (justificación)");
        }
        if (rejected.has("sentiment")) {
            if (ann.sentiment === undefined) missing.push("Sentimiento (valor)");
            if (!ann.sentiment_reason) missing.push("Sentimiento (justificación)");
        }
        for (const p of PILARS) {
            if (!rejected.has(p.key)) continue;
            const pa = ann.pilars[p.key];
            if (pa?.value === undefined) missing.push(`${p.label} (valor)`);
            if (!pa?.reason) missing.push(`${p.label} (justificación)`);
        }
        if (missing.length > 0) {
            showToast(`Faltan datos en: ${missing.join(", ")}`, "warn");
            return;
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
                    const confirmed = confirmedFields[rec.id] ?? new Set<string>();
                    const rejected = rejecting[rec.id] ?? new Set<string>();

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
                                    {/* ── 1. PERTINENCIA Y POSTURA ─────────────────────────────── */}
                                    <div style={{ ...S.sectionLabel, marginTop: 12 }}>Pertinencia y postura</div>
                                    <div style={S.fieldGrid}>
                                        {PERTINENCIA_POSTURA_FIELDS.map((f) => {
                                            const llmVal = ((rec as any)[f.key] as string | undefined) ?? "";
                                            const fa = ann.fields[f.key] ?? {};
                                            const justif = f.justifKey ? ((rec as any)[f.justifKey] as string | undefined) : undefined;
                                            const isConfirmed = confirmed.has(f.key);
                                            const isRejecting = rejected.has(f.key);
                                            const opts = f.key === "pertinencia"
                                                ? PERTINENCIA_OPTS.map((o) => ({ v: o, label: o }))
                                                : POSTURA_OPTS;
                                            return (
                                                <div key={f.key} style={S.smallCard}>
                                                    <div style={{ fontSize: 10, fontWeight: 600, color: f.color, marginBottom: 4, display: "flex", alignItems: "center" }}>
                                                        {f.label} <HelpIcon fieldKey={f.key} />
                                                    </div>
                                                    <div style={S.iaTag}>Valor: {llmVal || "—"}</div>
                                                    {justif && <div style={S.justifText}>Justificación: "{justif}"</div>}
                                                    {isConfirmed ? (
                                                        <div style={S.confirmedTag}>
                                                            <div>
                                                                ✓ CONFIRMADO — valor: {
                                                                    (rec as any)[`annotator_${f.key}`] ?? "(sin valor)"
                                                                }
                                                            </div>

                                                            {(rec as any)[`annotator_${f.key}_reason`] && (
                                                                <div style={{ marginTop: 4 }}>
                                                                    Justificación: "{(rec as any)[`annotator_${f.key}_reason`]}"
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : isRejecting ? (
                                                        <div style={{ marginTop: 8 }}>
                                                            <div style={S.formLabel}>Nuevo valor:</div>
                                                            <select style={S.input} value={fa.value ?? ""}
                                                                onChange={(e) => setField(rec.id, f.key, { value: e.target.value })}>
                                                                <option value="">— elige —</option>
                                                                {opts.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                                                            </select>
                                                            <div style={S.formLabel}>Justificación:</div>
                                                            <ReasonBox compact value={fa.reason} onChange={(v) => setField(rec.id, f.key, { reason: v })} />
                                                            <button style={S.saveBtnSmall} onClick={() => handleSaveField(rec, f.key)} disabled={saving[rec.id]}>{saving[rec.id] ? "Guardando..." : "Guardar →"}</button>
                                                        </div>
                                                    ) : (
                                                        <div style={S.gateBtns}>
                                                            <button style={S.confirmBtn} onClick={() => confirmField(rec.id, f.key)}>✓ CONFIRMO / ESTOY DE ACUERDO</button>
                                                            <button style={S.rejectBtn} onClick={() => markRejecting(rec.id, f.key)}>✕ NO CONFIRMO / NO ESTOY DE ACUERDO</button>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* ── 2. TEMA / TOPIC ───────────────────────────────────────── */}
                                    <div style={{ ...S.sectionLabel, marginTop: 12, display: "flex", alignItems: "center" }}>
                                        Tema / topic <HelpIcon fieldKey="topic" />
                                    </div>
                                    <div style={S.iaTag}>Valor: {rec.topic_llm ?? "—"}</div>
                                    {rec.justif_topic && <div style={S.justifText}>Justificación: "{rec.justif_topic}"</div>}
                                    {confirmed.has("topic") ? (
                                        <div style={S.confirmedTag}>
                                            <div>
                                                ✓ CONFIRMADO — valor: {
                                                    rec.annotator_topic ?? "(sin valor)"
                                                }
                                            </div>

                                            {rec.annotator_topic_reason && (
                                                <div style={{ marginTop: 4 }}>
                                                    Justificación: "{rec.annotator_topic_reason}"
                                                </div>
                                            )}
                                        </div>
                                    ) : rejected.has("topic") ? (
                                        <div style={{ marginTop: 8 }}>
                                            <div style={S.formLabel}>Nuevo valor:</div>
                                            <input style={S.input} value={ann.topic ?? ""} onChange={(e) => setAnn(rec.id, { topic: e.target.value })} />
                                            <div style={S.formLabel}>Justificación:</div>
                                            <ReasonBox value={ann.topic_reason} onChange={(v) => setAnn(rec.id, { topic_reason: v })} />
                                            <button style={S.saveBtnSmall} onClick={() => handleSaveField(rec, "topic")} disabled={saving[rec.id]}>{saving[rec.id] ? "Guardando..." : "Guardar →"}</button>
                                        </div>
                                    ) : (
                                        <div style={S.gateBtns}>
                                            <button style={S.confirmBtn} onClick={() => confirmTopic(rec.id)}>✓ CONFIRMO / ESTOY DE ACUERDO</button>
                                            <button style={S.rejectBtn} onClick={() => markRejecting(rec.id, "topic")}>✕ NO CONFIRMO / NO ESTOY DE ACUERDO</button>
                                        </div>
                                    )}

                                    {/* ── 3. SENTIMIENTO (TOPIC) ─────────────────────────────────── */}
                                    <div style={{ ...S.sectionLabel, marginTop: 14, display: "flex", alignItems: "center" }}>
                                        Sentimiento (topic) <HelpIcon fieldKey="sentiment" />
                                    </div>
                                    <div style={S.iaTag}>Valor: {sentLabel(rec.sentiment_llm)}</div>
                                    {rec.justif_sentimiento && <div style={S.justifText}>Justificación: "{rec.justif_sentimiento}"</div>}
                                    {confirmed.has("sentiment") ? (
                                        <div style={S.confirmedTag}>
                                            <div>
                                                ✓ CONFIRMADO — valor: {
                                                    rec.annotator_sentiment !== undefined
                                                        ? sentLabel(rec.annotator_sentiment)
                                                        : "(sin valor)"
                                                }
                                            </div>

                                            {rec.annotator_sentiment_reason && (
                                                <div style={{ marginTop: 4 }}>
                                                    Justificación: "{rec.annotator_sentiment_reason}"
                                                </div>
                                            )}
                                        </div>
                                    ) : rejected.has("sentiment") ? (
                                        <div style={{ marginTop: 8 }}>
                                            <div style={S.formLabel}>Nuevo valor:</div>
                                            <div style={S.sentBtns}>
                                                {SENT_OPTS.map((opt) => (
                                                    <button key={opt.v}
                                                        style={{ ...S.sentBtn, ...(ann.sentiment === opt.v ? { borderColor: opt.color, color: opt.color, background: opt.color + "18" } : {}) }}
                                                        onClick={() => setAnn(rec.id, { sentiment: opt.v })}>
                                                        <span style={{ display: "block", fontSize: 16 }}>{opt.icon}</span>{opt.label}
                                                    </button>
                                                ))}
                                            </div>
                                            <div style={S.formLabel}>Justificación:</div>
                                            <ReasonBox value={ann.sentiment_reason} onChange={(v) => setAnn(rec.id, { sentiment_reason: v })} />
                                            <button style={S.saveBtnSmall} onClick={() => handleSaveField(rec, "sentiment")} disabled={saving[rec.id]}>{saving[rec.id] ? "Guardando..." : "Guardar →"}</button>
                                        </div>
                                    ) : (
                                        <div style={S.gateBtns}>
                                            <button style={S.confirmBtn} onClick={() => confirmSentiment(rec.id)}>✓ CONFIRMO / ESTOY DE ACUERDO</button>
                                            <button style={S.rejectBtn} onClick={() => markRejecting(rec.id, "sentiment")}>✕ NO CONFIRMO / NO ESTOY DE ACUERDO</button>
                                        </div>
                                    )}

                                    {/* ── 4. PILARES DE ACEPTACIÓN ──────────────────────────────── */}
                                    <div style={{ ...S.sectionLabel, marginTop: 14 }}>Pilares de aceptación</div>
                                    <div style={S.fieldGrid}>
                                        {PILARS.map((p) => {
                                            const llmVal = (rec as any)[p.key] as number | undefined;
                                            const pa = ann.pilars[p.key] ?? {};
                                            const justif = (rec as any)[p.justifKey] as string | undefined;
                                            const hasLlm = llmVal !== undefined && llmVal !== null;
                                            const isConfirmed = confirmed.has(p.key);
                                            const isRejecting = rejected.has(p.key);
                                            const pilarBtns = (sel: number | undefined, onPick: (v: number) => void) => (
                                                <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                                                    {PILAR_BTNS.map((btn) => (
                                                        <button key={btn.v}
                                                            style={{ flex: 1, padding: "5px 2px", borderRadius: 5, border: `1.5px solid ${sel === btn.v ? p.color : "#252830"}`, fontSize: 11, fontWeight: 500, background: sel === btn.v ? p.color + "18" : "#181b22", color: sel === btn.v ? p.color : "#6b7080", cursor: "pointer" }}
                                                            onClick={() => onPick(btn.v)}>
                                                            {btn.l}
                                                        </button>
                                                    ))}
                                                </div>
                                            );
                                            return (
                                                <div key={p.key} style={S.smallCard}>
                                                    <div style={{ fontSize: 10, fontWeight: 600, color: p.color, marginBottom: 4, display: "flex", alignItems: "center" }}>
                                                        {p.label} <HelpIcon fieldKey={p.key} />
                                                    </div>
                                                    <div style={S.iaTag}>Valor: {pilarLabel(llmVal)}</div>
                                                    {justif && <div style={S.justifText}>Justificación: "{justif}"</div>}
                                                    {isConfirmed ? (
                                                        <div style={S.confirmedTag}>
                                                            <div>
                                                                ✓ CONFIRMADO — valor: {
                                                                    pilarLabel(
                                                                        (rec as any)[`annotator_${p.key}`]
                                                                    )
                                                                }
                                                            </div>

                                                            {(rec as any)[`annotator_${p.key}_reason`] && (
                                                                <div style={{ marginTop: 4 }}>
                                                                    Justificación: "{(rec as any)[`annotator_${p.key}_reason`]}"
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : isRejecting ? (
                                                        <div style={{ marginTop: 8 }}>
                                                            <div style={S.formLabel}>Nuevo valor:</div>
                                                            {pilarBtns(pa.value, (v) => setPilar(rec.id, p.key, { value: v }))}
                                                            <div style={S.formLabel}>Justificación:</div>
                                                            <ReasonBox compact value={pa.reason} onChange={(v) => setPilar(rec.id, p.key, { reason: v })} />
                                                            <button style={S.saveBtnSmall} onClick={() => handleSaveField(rec, p.key)} disabled={saving[rec.id]}>{saving[rec.id] ? "Guardando..." : "Guardar →"}</button>
                                                        </div>
                                                    ) : (
                                                        <div style={S.gateBtns}>
                                                            <button style={S.confirmBtn} onClick={() => confirmPilar(rec.id, p.key)}>✓ CONFIRMO / ESTOY DE ACUERDO</button>
                                                            <button style={S.rejectBtn} onClick={() => markRejecting(rec.id, p.key)}>✕ NO CONFIRMO / NO ESTOY DE ACUERDO</button>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* ── 5. IDIOMA Y GEOLOCALIZACIÓN ───────────────────────────── */}
                                    <div style={{ ...S.sectionLabel, marginTop: 14 }}>Idioma y geolocalización</div>
                                    <div style={S.fieldGrid}>
                                        {GEO_FIELDS.map((f) => {
                                            const llmVal = ((rec as any)[f.key] as string | undefined) ?? "";
                                            const fa = ann.fields[f.key] ?? {};
                                            const justif = f.justifKey ? ((rec as any)[f.justifKey] as string | undefined) : undefined;
                                            const isConfirmed = confirmed.has(f.key);
                                            const isRejecting = rejected.has(f.key);
                                            const valueInput = (val: string, onChange: (v: string) => void) =>
                                                f.key === "world_continent" ? (
                                                    <select style={S.input} value={val} onChange={(e) => onChange(e.target.value)}>
                                                        <option value="">— elige —</option>
                                                        {CONTINENT_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
                                                    </select>
                                                ) : f.key === "world_country" ? (
                                                    <>
                                                        <input list={`countries-${rec.id}`} style={S.input} value={val} onChange={(e) => onChange(e.target.value)} />
                                                        <datalist id={`countries-${rec.id}`}>
                                                            {COUNTRIES_RAW.map((c: any) => <option key={c.iso2} value={c.iso2}>{c.iso2} — {c.aliases[0]}</option>)}
                                                        </datalist>
                                                    </>
                                                ) : f.key === "lang" ? (
                                                    <>
                                                        <input list={`langs-${rec.id}`} style={S.input} value={val} onChange={(e) => onChange(e.target.value)} />
                                                        <datalist id={`langs-${rec.id}`}>
                                                            {LANGUAGES_RAW.map((l: any) => <option key={l.iso1} value={l.iso1}>{l.iso1} — {l.aliases[0]}</option>)}
                                                        </datalist>
                                                    </>
                                                ) : (
                                                    <input style={S.input} value={val} onChange={(e) => onChange(e.target.value)} />
                                                );
                                            return (
                                                <div key={f.key} style={S.smallCard}>
                                                    <div style={{ fontSize: 10, fontWeight: 600, color: "#28bfb0", marginBottom: 4, display: "flex", alignItems: "center" }}>
                                                        {f.label} <HelpIcon fieldKey={f.key} />
                                                    </div>
                                                    <div style={S.iaTag}>Valor: {llmVal || "—"}</div>
                                                    {justif && <div style={S.justifText}>Justificación: "{justif}"</div>}
                                                    {isConfirmed ? (
                                                        <div style={S.confirmedTag}>
                                                            <div>
                                                                ✓ CONFIRMADO — valor: {
                                                                    (rec as any)[`annotator_${f.key}`] ?? "(sin valor)"
                                                                }
                                                            </div>

                                                            {(rec as any)[`annotator_${f.key}_reason`] && (
                                                                <div style={{ marginTop: 4 }}>
                                                                    Justificación: "{(rec as any)[`annotator_${f.key}_reason`]}"
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : isRejecting ? (
                                                        <div style={{ marginTop: 8 }}>
                                                            <div style={S.formLabel}>Nuevo valor:</div>
                                                            {valueInput(fa.value ?? "", (v) => setField(rec.id, f.key, { value: v }))}
                                                            <div style={S.formLabel}>Justificación:</div>
                                                            <ReasonBox compact value={fa.reason} onChange={(v) => setField(rec.id, f.key, { reason: v })} />
                                                            <button style={S.saveBtnSmall} onClick={() => handleSaveField(rec, f.key)} disabled={saving[rec.id]}>{saving[rec.id] ? "Guardando..." : "Guardar →"}</button>
                                                        </div>
                                                    ) : (
                                                        <div style={S.gateBtns}>
                                                            <button style={S.confirmBtn} onClick={() => confirmField(rec.id, f.key)}>✓ CONFIRMO / ESTOY DE ACUERDO</button>
                                                            <button style={S.rejectBtn} onClick={() => markRejecting(rec.id, f.key)}>✕ NO CONFIRMO / NO ESTOY DE ACUERDO</button>
                                                        </div>
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

function ReasonBox({ value, onChange, compact }: { value?: string; onChange: (v: string) => void; compact?: boolean }) {
    return (
        <textarea style={{ ...S.textarea, marginTop: 6 }} rows={compact ? 1 : 2}
            placeholder="Justificación de tu asignación (por qué este valor es el correcto)..."
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
    // ── Patrón CONFIRMO / NO CONFIRMO ──
    gateBtns: { display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" },
    confirmBtn: { flex: 1, minWidth: 120, padding: "7px 6px", borderRadius: 6, border: "1.5px solid #2ec27e", background: "rgba(46,194,126,0.12)", color: "#2ec27e", fontSize: 10, fontWeight: 600, cursor: "pointer" },
    rejectBtn: { flex: 1, minWidth: 120, padding: "7px 6px", borderRadius: 6, border: "1.5px solid #e05252", background: "rgba(224,82,82,0.1)", color: "#e05252", fontSize: 10, fontWeight: 600, cursor: "pointer" },
    confirmedTag: { fontSize: 11, color: "#2ec27e", fontWeight: 600, marginTop: 8, padding: "5px 8px", background: "rgba(46,194,126,0.08)", borderRadius: 5 },
    formLabel: { fontSize: 9, color: "#6b7080", marginTop: 6, marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.05em" },
    undoBtn: { fontSize: 9, color: "#6b7080", background: "transparent", border: "none", cursor: "pointer", padding: "5px 0 0", display: "block" },
    // ── Ayuda contextual (i) ──
    helpBtn: { width: 14, height: 14, borderRadius: "50%", border: "1px solid #6b7080", background: "transparent", color: "#6b7080", fontSize: 9, fontStyle: "italic", lineHeight: "12px", padding: 0, cursor: "pointer", fontFamily: "serif" },
    helpPopover: { position: "absolute", top: 18, left: 0, zIndex: 50, width: 260, background: "#0a0b0e", border: "1px solid #30343f", borderRadius: 8, padding: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.5)" },
    helpSectionTitle: { fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", color: "#7a9bf5", fontWeight: 700, marginTop: 8 },
    helpText: { fontSize: 11, color: "#dde1ec", lineHeight: 1.5, whiteSpace: "pre-line", marginTop: 2 },
    helpClose: { marginTop: 10, fontSize: 10, color: "#6b7080", background: "transparent", border: "1px solid #252830", borderRadius: 5, padding: "3px 8px", cursor: "pointer" },
};