import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback, useRef, useEffect } from "react";
import { judgeApi, annotationsApi, projectsApi } from "../services/api";
import type { KeywordItem } from "../types";
import { HelpIcon } from "./AnnotateView";

const sentLabel = (v?: number) => ({ 1: "↑ Positivo", "-1": "↓ Negativo", 0: "→ Neutro", 2: "✕ No relac." }[String(v ?? "")] ?? "—");
const sentColor = (v?: number) => ({ 1: "var(--green)", "-1": "var(--red)", 0: "var(--muted)", 2: "var(--border2)" }[String(v ?? "")] ?? "var(--muted)");
const reviewBadge = (d?: string) => d === "accept" ? <span style={{ color: "var(--green)", fontSize: 9 }}> ✓revisado</span> : d === "reject" ? <span style={{ color: "var(--red)", fontSize: 9 }}> ✗rechazado</span> : null;

const S: Record<string, React.CSSProperties> = {
    page: { display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)" },
    topbar: { height: 48, background: "var(--surface)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", padding: "0 22px", gap: 12, flexShrink: 0 },
    content: { flex: 1, overflowY: "auto", padding: 22, maxWidth: 960 },
    recCard: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r2)", padding: 16, marginBottom: 16 },
    toast: { position: "fixed" as const, bottom: 20, right: 20, background: "var(--card)", border: "1px solid var(--border2)", borderRadius: "var(--r)", padding: "10px 16px", fontSize: 12, zIndex: 200 },
    // ── Selector de candidatos (LLM / anotadores / nueva asignación) ──
    candRow: { display: "flex", gap: 6, flexWrap: "wrap" as const, marginBottom: 8 },
    candCard: { flex: "1 1 130px", minWidth: 130, textAlign: "left" as const, background: "var(--bg)", border: "1.5px solid var(--border)", borderRadius: "var(--r)", padding: "7px 10px", cursor: "pointer", fontFamily: "inherit", color: "inherit" },
    candCardActive: { border: "1.5px solid var(--green)", background: "rgba(46,194,126,0.1)" },
    candCardNew: { border: "1.5px dashed var(--border2)" },
    candHead: { fontSize: 9, color: "var(--muted)", marginBottom: 3 },
    candValue: { fontSize: 11, fontWeight: 600, color: "var(--text)" },
    candJustif: { fontSize: 9, fontStyle: "italic" as const, color: "var(--muted)", marginTop: 2 },
    finalLabel: { fontSize: 9, color: "var(--amber)", margin: "6px 0 4px" },
    finalInput: { flex: 1, minWidth: 140, background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)", color: "var(--text)", padding: "5px 8px", fontSize: 11, fontFamily: "inherit" },
    saveBtn: { padding: "5px 12px", borderRadius: "var(--r)", background: "var(--accent)", color: "#fff", border: "none", fontSize: 11, cursor: "pointer" },
    saveBtnOff: { background: "var(--border)", cursor: "default" as const },
    savedTag: { fontSize: 11, color: "var(--green)", marginTop: 5, background: "rgba(46,194,126,0.08)", border: "1px solid var(--green)", borderRadius: "var(--r)", padding: "8px 10px" },
    undoLink: { fontSize: 9, color: "var(--muted)", background: "transparent", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" as const, marginTop: 4, display: "block" },
    altBlock: { border: "1px solid var(--border)", borderRadius: "var(--r)", overflow: "hidden", marginBottom: 6 },
    altQuestion: { fontSize: 10, color: "var(--muted)", padding: "7px 10px", background: "var(--bg)" },
    altRow: { display: "block", width: "100%", textAlign: "left" as const, background: "var(--card)", border: "none", borderTop: "1px solid var(--border)", padding: "8px 10px", cursor: "pointer", fontFamily: "inherit", color: "inherit" },
    altRowDisabled: { cursor: "default" as const, opacity: 0.6 },
    rejectAllBtn: { width: "100%", textAlign: "center" as const, padding: "6px 10px", borderRadius: "var(--r)", border: "1.5px dashed var(--border2)", background: "transparent", color: "var(--muted)", fontSize: 10, fontWeight: 600, cursor: "pointer", marginBottom: 8 },
};

const SENT_OPTS = [
    { v: 1, icon: "↑", label: "Positivo", color: "var(--green)" },
    { v: -1, icon: "↓", label: "Negativo", color: "var(--red)" },
    { v: 0, icon: "→", label: "Neutro", color: "var(--muted)" },
    { v: 2, icon: "✕", label: "No relac.", color: "var(--border2)" },
];

// ── Selección de candidatos: LLM / cada anotador / "otro valor" ────────────
// Sustituye a los antiguos enlaces sueltos "← valor" / "← justif." por
// tarjetas clicables con estado seleccionado visible, en línea con el
// patrón CONFIRMO/NO CONFIRMO de AnnotateView.tsx (mismo verde = elegido).
type Candidate = { id: string; icon: string; label: string; value?: string | number; justif?: string };

const sourceTag = (id?: string) => id === "llm" ? "LLM" : (id === "new" || !id) ? "JUEZ" : `ANOTADOR (@${id})`;

function JudgeCandidates({ candidates, onPick, formatValue, disabled }: {
    candidates: Candidate[];
    onPick: (c: Candidate) => void;
    formatValue?: (v?: string | number) => string;
    disabled?: boolean;
}) {
    return (
        <div style={S.altBlock}>
            <div style={S.altQuestion}>¿Alguna de las siguientes anotaciones es correcta?</div>
            {candidates.map((c) => (
                <button key={c.id} type="button" disabled={disabled} onClick={() => onPick(c)}
                    style={{ ...S.altRow, ...(disabled ? S.altRowDisabled : {}) }}>
                    <div style={S.candHead}>{c.icon} {c.label}</div>
                    <div style={S.candValue}>{formatValue ? formatValue(c.value) : (c.value || "—")}</div>
                    {c.justif && <div style={S.candJustif}>"{c.justif}"</div>}
                </button>
            ))}
        </div>
    );
}

// Grupo completo para un campo de TEXTO: fila de candidatos + inputs
// editables de valor/justificación final + guardar. Usado por pertinencia,
// postura, topic y los 5 campos de geolocalización — antes cada uno
// repetía esta misma estructura por separado.
function TextFieldGroup({
    label, helpKey, accent, jKey, llmCandidate, annotatorCandidates,
    judgeFields, setJudgeFields, adoptedFrom, setAdoptedFrom,
    savedValue, savedReason, savedSource, onSave, onUndo,
}: {
    label: string; helpKey?: string; accent: string; jKey: string;
    llmCandidate: Candidate; annotatorCandidates: Candidate[];
    judgeFields: Record<string, string | number | boolean | undefined>;
    setJudgeFields: React.Dispatch<React.SetStateAction<Record<string, string | number | boolean | undefined>>>;
    adoptedFrom: Record<string, string>;
    setAdoptedFrom: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    savedValue?: string; savedReason?: string; savedSource?: string;
    onSave: (finalText: string, reason: string | undefined, source: string) => Promise<unknown>;
    onUndo: () => Promise<unknown>;
}) {
    const isDismissed = judgeFields[`${jKey}__dismissed`] === true;
    const candidates: Candidate[] = [llmCandidate, ...annotatorCandidates];
    const selectedSource = isDismissed ? undefined : (adoptedFrom[jKey] ?? savedSource);
    const displayValue = isDismissed ? undefined : ((judgeFields[jKey] as string) ?? savedValue);
    const displayReason = isDismissed ? undefined : ((judgeFields[`${jKey}__reason`] as string) ?? savedReason);
    const isDeciding = judgeFields[`${jKey}__deciding`] === true;
    const isSaving = judgeFields[`${jKey}__saving`] === true;
    const isResolved = !isDeciding && selectedSource !== undefined && displayValue !== undefined;
    const draft = (judgeFields[`${jKey}__draft`] as string) ?? "";
    const draftReason = (judgeFields[`${jKey}__draftReason`] as string) ?? "";

    const clearLocal = () => setJudgeFields(p => {
        const n = { ...p };
        delete n[`${jKey}__saving`]; delete n[`${jKey}__deciding`];
        return n;
    });

    const accept = async (c: Candidate) => {
        setJudgeFields(p => ({ ...p, [`${jKey}__saving`]: true }));
        try {
            await onSave((c.value as string) ?? "", c.justif, c.id);
            setJudgeFields(p => { const n = { ...p, [jKey]: c.value ?? "", [`${jKey}__reason`]: c.justif ?? "" }; delete n[`${jKey}__dismissed`]; return n; });
            setAdoptedFrom(p => ({ ...p, [jKey]: c.id }));
            clearLocal();
        } catch { clearLocal(); }
    };

    const saveManual = async () => {
        setJudgeFields(p => ({ ...p, [`${jKey}__saving`]: true }));
        try {
            await onSave(draft, draftReason || undefined, "new");
            setJudgeFields(p => { const n = { ...p, [jKey]: draft, [`${jKey}__reason`]: draftReason }; delete n[`${jKey}__draft`]; delete n[`${jKey}__draftReason`]; delete n[`${jKey}__dismissed`]; return n; });
            setAdoptedFrom(p => ({ ...p, [jKey]: "new" }));
            clearLocal();
        } catch { clearLocal(); }
    };

    return (
        <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 9, fontWeight: 600, color: accent, marginBottom: 5, textTransform: "uppercase" as const, letterSpacing: "0.05em", display: "flex", alignItems: "center" }}>{label}{helpKey && <HelpIcon fieldKey={helpKey} />}</div>
            {isResolved ? (
                <div style={S.savedTag}>
                    <strong>✓ ACEPTADA — {sourceTag(selectedSource)}</strong>
                    <div>Valor: {displayValue || "—"}</div>
                    {displayReason && <div style={S.candJustif}>Justificación: "{displayReason}"</div>}
                    <button style={S.undoLink} onClick={async () => {
                        // Borra también la decisión guardada en el servidor:
                        // si no, al volver a abrir el registro reaparece la
                        // opción anterior como si siguiera elegida.
                        try { await onUndo(); } catch { }
                        setAdoptedFrom(p => { const n = { ...p }; delete n[jKey]; return n; });
                        setJudgeFields(p => { const n = { ...p }; delete n[jKey]; delete n[`${jKey}__reason`]; delete n[`${jKey}__draft`]; delete n[`${jKey}__draftReason`]; delete n[`${jKey}__deciding`]; n[`${jKey}__dismissed`] = true; return n; });
                    }}>↶ Deshacer</button>
                </div>
            ) : isDeciding ? (
                <div>
                    <div style={S.finalLabel}>Nuevo valor:</div>
                    <input style={S.finalInput} value={draft} onChange={e => setJudgeFields(p => ({ ...p, [`${jKey}__draft`]: e.target.value }))} />
                    <div style={S.finalLabel}>Nueva justificación:</div>
                    <input style={S.finalInput} value={draftReason} onChange={e => setJudgeFields(p => ({ ...p, [`${jKey}__draftReason`]: e.target.value }))} />
                    <div style={{ display: "flex", gap: 10, marginTop: 6, alignItems: "center" }}>
                        <button disabled={isSaving || !draft || !draftReason} onClick={saveManual}
                            style={{ ...S.saveBtn, ...((isSaving || !draft || !draftReason) ? S.saveBtnOff : {}) }}>Guardar →</button>
                        <button style={S.undoLink} onClick={() => setJudgeFields(p => { const n = { ...p }; delete n[`${jKey}__deciding`]; return n; })}>↶ Deshacer</button>
                    </div>
                </div>
            ) : (
                <>
                    <JudgeCandidates candidates={candidates} onPick={accept} disabled={isSaving} />
                    <button style={S.rejectAllBtn} disabled={isSaving} onClick={() => setJudgeFields(p => ({ ...p, [`${jKey}__deciding`]: true }))}>
                        ✕ NINGUNA ES CORRECTA
                    </button>
                </>
            )}
        </div>
    );
}

// Igual que TextFieldGroup pero con un valor final de botones fijos en vez
// de texto libre — usado por Sentimiento y cada Pilar.
function PickerFieldGroup({
    label, helpKey, accent, jKey, llmCandidate, annotatorCandidates, options, formatValue,
    judgeFields, setJudgeFields, adoptedFrom, setAdoptedFrom,
    savedValue, savedReason, savedSource, onSave, onUndo,
}: {
    label: string;
    helpKey?: string;
    accent: string;
    jKey: string;
    llmCandidate: Candidate;
    annotatorCandidates: Candidate[];
    options: Array<{ v: number; label: string; icon?: string; color?: string }>;
    formatValue: (v?: string | number) => string;
    judgeFields: Record<string, string | number | boolean | undefined>;
    setJudgeFields: React.Dispatch<React.SetStateAction<Record<string, string | number | boolean | undefined>>>;
    adoptedFrom: Record<string, string>;
    setAdoptedFrom: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    savedValue?: number;
    savedReason?: string;
    savedSource?: string;
    onSave: (finalValue: number, reason: string | undefined, source: string) => Promise<unknown>;
    onUndo: () => Promise<unknown>;
}) {
    const candidates: Candidate[] = [llmCandidate, ...annotatorCandidates];
    const isDismissed = judgeFields[`${jKey}__dismissed`] === true;
    const selectedSource = isDismissed ? undefined : (adoptedFrom[jKey] ?? savedSource);
    const displayValue = isDismissed ? undefined : ((judgeFields[jKey] as number | undefined) ?? savedValue);
    const displayReason = isDismissed ? undefined : ((judgeFields[`${jKey}__reason`] as string) ?? savedReason);
    const isDeciding = judgeFields[`${jKey}__deciding`] === true;
    const isSaving = judgeFields[`${jKey}__saving`] === true;
    const isResolved = !isDeciding && selectedSource !== undefined && displayValue !== undefined;
    const draft = judgeFields[`${jKey}__draft`] as number | undefined;
    const draftReason = (judgeFields[`${jKey}__draftReason`] as string) ?? "";

    const clearLocal = () => setJudgeFields(p => {
        const n = { ...p };
        delete n[`${jKey}__saving`]; delete n[`${jKey}__deciding`];
        return n;
    });

    const accept = async (c: Candidate) => {
        setJudgeFields(p => ({ ...p, [`${jKey}__saving`]: true }));
        try {
            await onSave(c.value as number, c.justif, c.id);
            setJudgeFields(p => { const n = { ...p, [jKey]: c.value as number, [`${jKey}__reason`]: c.justif ?? "" }; delete n[`${jKey}__dismissed`]; return n; });
            setAdoptedFrom(p => ({ ...p, [jKey]: c.id }));
            clearLocal();
        } catch { clearLocal(); }
    };

    const saveManual = async () => {
        if (draft === undefined) return;
        setJudgeFields(p => ({ ...p, [`${jKey}__saving`]: true }));
        try {
            await onSave(draft, draftReason || undefined, "new");
            setJudgeFields(p => { const n = { ...p, [jKey]: draft, [`${jKey}__reason`]: draftReason }; delete n[`${jKey}__draft`]; delete n[`${jKey}__draftReason`]; delete n[`${jKey}__dismissed`]; return n; });
            setAdoptedFrom(p => ({ ...p, [jKey]: "new" }));
            clearLocal();
        } catch { clearLocal(); }
    };

    return (
        <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 9, fontWeight: 600, color: accent, marginBottom: 5, textTransform: "uppercase" as const, letterSpacing: "0.05em", display: "flex", alignItems: "center" }}>{label}{helpKey && <HelpIcon fieldKey={helpKey} />}</div>
            {isResolved ? (
                <div style={S.savedTag}>
                    <strong>✓ ACEPTADA — {sourceTag(selectedSource)}</strong>
                    <div>Valor: {formatValue(displayValue)}</div>
                    {displayReason && <div style={S.candJustif}>Justificación: "{displayReason}"</div>}
                    <button style={S.undoLink} onClick={async () => {
                        // Borra también la decisión guardada en el servidor:
                        // si no, al volver a abrir el registro reaparece la
                        // opción anterior como si siguiera elegida.
                        try { await onUndo(); } catch { }
                        setAdoptedFrom(p => { const n = { ...p }; delete n[jKey]; return n; });
                        setJudgeFields(p => { const n = { ...p }; delete n[jKey]; delete n[`${jKey}__reason`]; delete n[`${jKey}__draft`]; delete n[`${jKey}__draftReason`]; delete n[`${jKey}__deciding`]; n[`${jKey}__dismissed`] = true; return n; });
                    }}>↶ Deshacer</button>
                </div>
            ) : isDeciding ? (
                <div>
                    <div style={S.finalLabel}>Nuevo valor:</div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" as const, marginBottom: 6 }}>
                        {options.map(opt => {
                            const sel = draft === opt.v;
                            const c = opt.color ?? accent;
                            return (
                                <button key={opt.v} type="button"
                                    style={{ flex: 1, minWidth: 60, padding: "6px 4px", borderRadius: "var(--r)", border: `1.5px solid ${sel ? c : "var(--border)"}`, fontSize: 11, fontWeight: 500, background: sel ? c + "18" : "var(--card)", color: sel ? c : "var(--muted)", cursor: "pointer", textAlign: "center" as const }}
                                    onClick={() => setJudgeFields(p => ({ ...p, [`${jKey}__draft`]: opt.v }))}>
                                    {opt.icon} {opt.label}
                                </button>
                            );
                        })}
                    </div>
                    <div style={S.finalLabel}>Nueva justificación:</div>
                    <input style={{ ...S.finalInput, fontSize: 10 }} value={draftReason}
                        onChange={e => setJudgeFields(p => ({ ...p, [`${jKey}__draftReason`]: e.target.value }))} />
                    <div style={{ display: "flex", gap: 10, marginTop: 6, alignItems: "center" }}>
                        <button disabled={isSaving || draft === undefined || !draftReason} onClick={saveManual}
                            style={{ ...S.saveBtn, ...((isSaving || draft === undefined || !draftReason) ? S.saveBtnOff : {}) }}>Guardar →</button>
                        <button style={S.undoLink} onClick={() => setJudgeFields(p => { const n = { ...p }; delete n[`${jKey}__deciding`]; return n; })}>↶ Deshacer</button>
                    </div>
                </div>
            ) : (
                <>
                    <JudgeCandidates candidates={candidates} onPick={accept} formatValue={formatValue} disabled={isSaving} />
                    <button style={S.rejectAllBtn} disabled={isSaving} onClick={() => setJudgeFields(p => ({ ...p, [`${jKey}__deciding`]: true }))}>
                        ✕ NINGUNA ES CORRECTA
                    </button>
                </>
            )}
        </div>
    );
}

export default function JudgeView() {
    const { id: projectId } = useParams<{ id: string }>();
    const qc = useQueryClient();

    const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
    // Registros que el juez ya guardó por completo con "Guardar todo y siguiente":
    // el backend los sigue devolviendo (para poder editarlos más tarde si hace
    // falta), pero acá los ocultamos de la cola para que se comporten como en
    // Anotar — al guardar, desaparecen en vez de solo bajar a la siguiente.
    // Se inicializa vacío; se sincroniza con la BD en cuanto llegan los datos.
    const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
    const [collapsedInitialized, setCollapsedInitialized] = useState(false);
    const [decisions, setDecisions] = useState<Record<string, number>>({});

    const [judgeFields, setJudgeFields] = useState<Record<string, string | number | boolean | undefined>>({});
    const [adoptedFrom, setAdoptedFrom] = useState<Record<string, string>>({});
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

    // Deshacer: borra la decisión del juez de ese campo en el servidor.
    const judgeUndoMutation = useMutation({
        mutationFn: (data: { record_id: string; project_id: string; annotation_type: string; pilar?: string; field_name?: string }) =>
            judgeApi.undo(data),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["judge-records", projectId] }),
        onError: () => showToast("Error al deshacer", false),
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
    // const TEXT_FIELDS: Array<{ key: string; label: string; justifKey: string | null }> = [
    //     { key: "pertinencia", label: "Pertinencia", justifKey: "justif_pertinencia" },
    //     { key: "posicion", label: "Posición", justifKey: "justif_posicion" },
    //     // { key: "idioma_ia", label: "Idioma (detección original)", justifKey: null },
    //     // { key: "lang", label: "Idioma (reanálisis)", justifKey: "justif_lang" },
    //     { key: "lang", label: "Idioma", justifKey: "justif_lang" },
    //     { key: "world_continent", label: "Continente", justifKey: "justif_continente" },
    //     { key: "world_country", label: "País", justifKey: "justif_pais" },
    //     { key: "world_region", label: "Región", justifKey: "justif_region" },
    //     { key: "world_city", label: "Ciudad", justifKey: "justif_ciudad" },
    //     // { key: "codigo_pais", label: "Código país (ISO)", justifKey: null },
    // ];

    const PERTINENCIA_POSTURA_FIELDS: Array<{ key: string; label: string; justifKey: string | null }> = [
        { key: "pertinencia", label: "Pertinencia", justifKey: "justif_pertinencia" },
        { key: "postura", label: "Postura", justifKey: "justif_postura" },
    ];

    const GEO_FIELDS: Array<{ key: string; label: string; justifKey: string | null }> = [
        { key: "lang", label: "Idioma", justifKey: "justif_lang" },
        { key: "world_continent", label: "Continente", justifKey: "justif_continente" },
        { key: "world_country", label: "País", justifKey: "justif_pais" },
        { key: "world_region", label: "Región", justifKey: "justif_region" },
        { key: "world_city", label: "Ciudad", justifKey: "justif_ciudad" },
    ];

    // Mismo conjunto que AnnotateView.tsx — usado por handleSaveAll para no
    // dejar afuera ningún campo de texto al guardar todo de una vez.
    const TEXT_FIELDS = [...PERTINENCIA_POSTURA_FIELDS, ...GEO_FIELDS];
    const [exporting, setExporting] = useState(false);
    const [resetting, setResetting] = useState(false);

    // Borra TODAS las decisiones del juez de este proyecto y devuelve los
    // registros a "annotated". No toca las anotaciones de los anotadores.
    const handleResetJudge = async () => {
        if (!window.confirm(
            "¿Resetear TODAS las decisiones del juez de este proyecto?\n\n" +
            "Se borrarán todos los valores y justificaciones finales que hayas guardado como juez. " +
            "Las anotaciones de los anotadores NO se tocan.\n\nEsta acción no se puede deshacer."
        )) return;
        setResetting(true);
        try {
            await judgeApi.reset(projectId!);
            // El estado local guarda las decisiones ya tomadas: si no se
            // limpia, la pantalla seguiría mostrándolas tras el reseteo.
            setJudgeFields({});
            setAdoptedFrom({});
            setCollapsedIds(new Set());
            await qc.invalidateQueries({ queryKey: ["judge-records", projectId] });
            showToast("Decisiones del juez eliminadas", true);
        } catch {
            showToast("Error al resetear las decisiones", false);
        } finally {
            setResetting(false);
        }
    };
    const downloadRef = useRef<HTMLAnchorElement>(null);

    const handleSaveAll = async (record: typeof data[0]["record"]) => {
        const recAnns = data?.find(d => d.record.id === record.id)?.annotations ?? [];
        const fieldAnns = recAnns.filter(a => a.annotation_type === "field");
        const sentAnns = recAnns.filter(a => a.annotation_type === "sentiment");
        const pilarAnns = recAnns.filter(a => a.annotation_type === "pilar");

        // Todo campo necesita una decisión del juez — ya guardada de antes,
        // o con un borrador listo para guardarse ahora mismo — igual que
        // exige la pestaña de Anotar antes de "Guardar y siguiente".
        const pending: string[] = [];
        for (const { key: fieldKey, label } of TEXT_FIELDS) {
            const jKey = `${record.id}__field__${fieldKey}`;
            const hasSaved = fieldAnns.some(a => a.field_name === fieldKey && a.judge_final_text != null);
            if (!hasSaved && judgeFields[jKey] === undefined) pending.push(label);
        }
        const topicKey = `${record.id}__topic`;
        const topicSaved = fieldAnns.some(a => a.field_name === "topic" && a.judge_final_text != null);
        if (!topicSaved && judgeFields[topicKey] === undefined) pending.push("Tema / Topic");

        const sentKey = `${record.id}__sentiment`;
        const sentSaved = sentAnns.some(a => a.judge_final_value != null);
        if (!sentSaved && judgeFields[sentKey] === undefined) pending.push("Sentimiento (topic)");

        for (const [pilarKey, pilarLabel] of Object.entries(PILAR_LABELS)) {
            const jKey = `${record.id}__${pilarKey}`;
            const hasSaved = pilarAnns.some(a => a.pilar === pilarKey && a.judge_final_value != null);
            if (!hasSaved && judgeFields[jKey] === undefined) pending.push(pilarLabel);
        }

        if (pending.length > 0) {
            showToast(`Faltan decisiones del juez en: ${pending.join(", ")}`, false);
            return;
        }

        // Guardar todos los campos que tienen draft en judgeFields para este record
        const saves: Promise<any>[] = [];

        // Sentimiento
        if (judgeFields[sentKey] !== undefined) {
            const reason = (judgeFields[`${sentKey}_reason`] as string) || undefined;
            saves.push(judgeDecideNewMutation.mutateAsync({ record_id: record.id, project_id: projectId!, annotation_type: "sentiment", final_value: judgeFields[sentKey] as number, reason, source: adoptedFrom[sentKey] ?? "new" }));
        }

        // Topic
        const topicDraft = judgeFields[topicKey] as string | undefined;
        if (topicDraft !== undefined) {
            const reason = (judgeFields[`${topicKey}__reason`] as string) || undefined;
            saves.push(judgeDecideNewMutation.mutateAsync({ record_id: record.id, project_id: projectId!, annotation_type: "field", field_name: "topic", final_text: topicDraft, reason, source: adoptedFrom[topicKey] ?? "new" }));
        }

        // Campos de texto: pertinencia, posición, idioma y geolocalización
        for (const { key: fieldKey } of TEXT_FIELDS) {
            const jKey = `${record.id}__field__${fieldKey}`;
            const draft = judgeFields[jKey] as string | undefined;
            if (draft !== undefined) {
                const reason = (judgeFields[`${jKey}__reason`] as string) || undefined;
                saves.push(judgeDecideNewMutation.mutateAsync({ record_id: record.id, project_id: projectId!, annotation_type: "field", field_name: fieldKey, final_text: draft, reason, source: adoptedFrom[jKey] ?? "new" }));
            }
        }

        // Pilares
        for (const pilarKey of Object.keys(PILAR_LABELS)) {
            const jKey = `${record.id}__${pilarKey}`;
            const sel = judgeFields[jKey] as number | undefined;
            if (sel !== undefined) {
                const reason = (judgeFields[`${jKey}__reason`] as string) || undefined;
                saves.push(judgeDecideNewMutation.mutateAsync({ record_id: record.id, project_id: projectId!, annotation_type: "pilar", pilar: pilarKey, final_value: sel, reason }));
            }
        }

        const collapseAndNext = () => {
            setCollapsedIds(prev => new Set(prev).add(record.id));
            const allData = data ?? [];
            const idx = allData.findIndex(d => d.record.id === record.id);
            const nextPending = allData.slice(idx + 1).find(d => !collapsedIds.has(d.record.id));
            if (nextPending) {
                setTimeout(() => {
                    document.getElementById(`judge-rec-${nextPending.record.id}`)?.scrollIntoView({ behavior: "smooth" });
                }, 50);
            }
        };

        if (saves.length === 0) {
            collapseAndNext();
            return;
        }

        await Promise.all(saves);
        showToast("Todo guardado ✓");
        setJudgeFields(prev => {
            const n = { ...prev };
            Object.keys(n)
                .filter(k => k.startsWith(record.id) && !k.endsWith("__saved"))
                .forEach(k => { n[`${k}__saved`] = true; });
            return n;
        });
        collapseAndNext();
    };

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
        } catch (err: any) {
            const msg = err?.response?.data?.detail ?? err?.message ?? "Error al exportar";
            showToast(`Error al exportar: ${msg}`, false);
            console.error("Export error:", err?.response ?? err);
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

    // Sincronizar collapsedIds con el estado real de la BD al cargar los datos.
    // Un registro está "juzgado" si su status es "judged" O si tiene al menos
    // una anotación con judge_final_value/judge_final_text no nulo.
    useEffect(() => {
        if (!data || collapsedInitialized) return;
        const judged = new Set(
            data
                .filter(({ record, annotations }) =>
                    record.status === "judged" ||
                    annotations.some(a => a.judge_final_value != null || a.judge_final_text != null)
                )
                .map(({ record }) => record.id)
        );
        if (judged.size > 0) setCollapsedIds(judged);
        setCollapsedInitialized(true);
    }, [data, collapsedInitialized]);

    // Oculta de la cola los registros ya guardados en esta sesión con
    // "Guardar todo y siguiente" (el backend los sigue devolviendo, para
    // poder reabrirlos después si hace falta).
    const visibleData = data;
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
                    {(data?.length ?? 0) - collapsedIds.size} pendientes / {data?.length ?? 0}
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
                    <button
                        disabled={resetting}
                        onClick={handleResetJudge}
                        style={{ padding: "3px 8px", borderRadius: "var(--r)", border: "1px solid var(--red)", background: "transparent", color: "var(--red)", fontSize: 10, cursor: resetting ? "default" : "pointer", marginLeft: 8 }}>
                        {resetting ? "Reseteando…" : "↺ Resetear decisiones"}
                    </button>
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
                {data && data.length > 0 && (
                    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r2)", padding: 14, marginBottom: 16 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                            <span style={{ fontSize: 11, color: "var(--muted)" }}>Progreso</span>
                            <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text)" }}>{collapsedIds.size} / {data.length} juzgados</span>
                        </div>
                        <div style={{ height: 3, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
                            <div style={{ height: "100%", background: "var(--accent)", borderRadius: 2, width: `${data.length > 0 ? (collapsedIds.size / data.length) * 100 : 0}%`, transition: "width 0.3s" }} />
                        </div>
                    </div>
                )}
                {!visibleData?.length && (
                    <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--muted)" }}>
                        <div style={{ fontSize: 28, marginBottom: 8 }}>⚖️</div>
                        <div style={{ fontWeight: 500, color: "var(--text)", marginBottom: 4 }}>Sin registros listos para juzgar</div>
                        <div style={{ fontSize: 12 }}>Los registros aparecen aquí cuando dos anotadores los han completado.</div>
                    </div>
                )}

                {visibleData?.map(({ record, annotations }) => {
                    // Separar anotaciones por tipo
                    const sentAnns = annotations.filter(a => a.annotation_type === "sentiment");
                    const savedSentiment = sentAnns.find(a => a.judge_final_value != null)?.judge_final_value;
                    const savedSentimentReason = sentAnns.find(a => a.judge_final_value != null)?.judge_reason ?? undefined;
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

                    if (collapsedIds.has(record.id)) {
                        return (
                            <div key={record.id} id={`judge-rec-${record.id}`}
                                style={{ ...S.recCard, borderColor: "var(--green)", opacity: 0.75 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <span style={{ fontSize: 9, color: "var(--green)", flexShrink: 0 }}>✓ Juzgado</span>
                                    <span style={{ fontSize: 9, color: "var(--muted)", flexShrink: 0 }}>
                                        [{record.platform} · {record.tipo} · {record.fecha}]
                                    </span>
                                    <span style={{ flex: 1, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                                        {record.content?.slice(0, 100)}{(record.content?.length ?? 0) > 100 ? "…" : ""}
                                    </span>
                                    <button
                                        style={{ fontSize: 10, color: "var(--muted)", background: "transparent", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: "2px 8px", cursor: "pointer", flexShrink: 0 }}
                                        onClick={() => setCollapsedIds(prev => { const n = new Set(prev); n.delete(record.id); return n; })}>
                                        Reabrir ↕
                                    </button>
                                </div>
                            </div>
                        );
                    }

                    return (
                        <div key={record.id} id={`judge-rec-${record.id}`} style={S.recCard}>
                            {/* ── Cabecera del record ── */}
                            <div style={{ fontSize: 9, textTransform: "uppercase" as const, letterSpacing: "0.1em", color: "var(--muted)", marginBottom: 4 }}>
                                [{record.platform ?? "?"} · {record.tipo ?? "?"} · {record.fecha ?? "?"}]
                                {record.url_post && <> · <a href={record.url_post} target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal)", fontSize: 9 }}>🔗 Ver post original en {rec.platform || "la plataforma"} ↗</a></>}
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
                            {/* <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 10, color: "var(--muted)", marginBottom: 10 }}>
                                {record.lang && <span>🌐 Idioma LLM: <strong style={{ color: "var(--text)" }}>{record.lang}</strong>{record.justif_lang && <em> — {record.justif_lang}</em>}</span>}
                                {record.world_country && <span>🌍 País LLM: <strong style={{ color: "var(--text)" }}>{[record.world_city, record.world_region, record.world_country].filter(Boolean).join(", ")}</strong>{record.justif_pais && <em> — {record.justif_pais}</em>}</span>}
                                {record.pertinencia && <span>📌 Pertinencia LLM: <strong style={{ color: "var(--text)" }}>{record.pertinencia}</strong>{record.justif_pertinencia && <em> — {record.justif_pertinencia}</em>}</span>}
                                {record.postura && <span>🎯 Postura LLM: <strong style={{ color: "var(--text)" }}>{record.postura}</strong>{record.justif_postura && <em> — {record.justif_postura}</em>}</span>}
                            </div> */}

                            {/* ── PERTINENCIA Y POSTURA ── */}
                            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginBottom: 10 }}>
                                <div style={{ fontSize: 10, fontWeight: 600, color: "var(--amber)", marginBottom: 6 }}>PERTINENCIA Y POSTURA</div>
                                {PERTINENCIA_POSTURA_FIELDS.map(({ key: fieldKey, label, justifKey }) => {
                                    const llmVal = (record as any)[fieldKey] as string | undefined;
                                    const llmJustif = justifKey ? (record as any)[justifKey] as string | undefined : undefined;
                                    const fieldVals = fieldsByKey[fieldKey] ?? [];
                                    const savedText = fieldVals.find(a => a.judge_final_text != null)?.judge_final_text;
                                    const savedReason = fieldVals.find(a => a.judge_final_text != null)?.judge_reason ?? undefined;
                                    const savedSource = fieldVals.find(a => a.judge_final_text != null)?.judge_source ?? undefined;
                                    const jKey = `${record.id}__field__${fieldKey}`;
                                    return (
                                        <TextFieldGroup key={fieldKey} label={label} helpKey={fieldKey} accent="var(--accent2)" jKey={jKey}
                                            llmCandidate={{ id: "llm", icon: "🤖", label: "LLM", value: llmVal, justif: llmJustif }}
                                            annotatorCandidates={fieldVals.filter(a => a.judge_final_text == null && a.judge_final_value == null).map(a => ({ id: a.annotator, icon: "👤", label: `${a.annotator}${a.reviewer_decision === "reject" ? " ✗" : a.reviewer_decision === "accept" ? " ✓" : ""}`, value: a.corrected_text, justif: a.correction_reason }))}
                                            judgeFields={judgeFields} setJudgeFields={setJudgeFields} adoptedFrom={adoptedFrom} setAdoptedFrom={setAdoptedFrom}
                                            savedValue={savedText} savedReason={savedReason} savedSource={savedSource}
                                            onSave={(finalText, reason, source) => judgeDecideNewMutation.mutateAsync({ record_id: record.id, project_id: projectId!, annotation_type: "field", field_name: fieldKey, final_text: finalText, reason, source })}
                                            onUndo={() => judgeUndoMutation.mutateAsync({ record_id: record.id, project_id: projectId!, annotation_type: "field", field_name: fieldKey })}
                                        />
                                    );
                                })}
                            </div>

                            {/* ── TOPIC ── */}
                            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginBottom: 10 }}>
                                {(() => {
                                    const savedTopic = fieldAnns.find(a => a.field_name === "topic" && a.judge_final_text != null)?.judge_final_text;
                                    const savedTopicReason = fieldAnns.find(a => a.field_name === "topic" && a.judge_final_text != null)?.judge_reason ?? undefined;
                                    const savedTopicSource = fieldAnns.find(a => a.field_name === "topic" && a.judge_final_text != null)?.judge_source ?? undefined;
                                    return (
                                        <TextFieldGroup label="Tema / Topic" helpKey="topic" accent="var(--accent2)" jKey={`${record.id}__topic`}
                                            llmCandidate={{ id: "llm", icon: "🤖", label: "LLM", value: record.topic_llm, justif: record.justif_topic }}
                                            annotatorCandidates={sentAnns.filter(a => a.corrected_topic && a.judge_final_text == null && a.judge_final_value == null).map(a => ({ id: a.annotator, icon: "👤", label: `${a.annotator}${a.reviewer_decision === "reject" ? " ✗" : a.reviewer_decision === "accept" ? " ✓" : ""}`, value: a.corrected_topic, justif: a.topic_reason }))}
                                            judgeFields={judgeFields} setJudgeFields={setJudgeFields} adoptedFrom={adoptedFrom} setAdoptedFrom={setAdoptedFrom}
                                            savedValue={savedTopic ?? undefined} savedReason={savedTopicReason} savedSource={savedTopicSource}
                                            onSave={(finalText, reason, source) => judgeDecideNewMutation.mutateAsync({ record_id: record.id, project_id: projectId!, annotation_type: "field", field_name: "topic", final_text: finalText, reason, source })}
                                            onUndo={() => judgeUndoMutation.mutateAsync({ record_id: record.id, project_id: projectId!, annotation_type: "field", field_name: "topic" })}
                                        />
                                    );
                                })()}
                            </div>


                            {/* ── SENTIMIENTO ── */}
                            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginBottom: 10 }}>
                                {(() => {
                                    const savedSentAnn = sentAnns.find(a => a.judge_final_value != null);
                                    return (
                                        <PickerFieldGroup label="Sentimiento (topic)" helpKey="sentiment" accent="var(--accent2)" jKey={`${record.id}__sentiment`}
                                            options={SENT_OPTS} formatValue={(v) => sentLabel(v as number)}
                                            llmCandidate={{ id: "llm", icon: "🤖", label: "LLM", value: record.sentiment_llm, justif: record.justif_sentimiento }}
                                            annotatorCandidates={sentAnns.filter(a => a.judge_final_text == null && a.judge_final_value == null).map(a => ({ id: a.annotator, icon: "👤", label: `${a.annotator}${a.reviewer_decision === "reject" ? " ✗" : a.reviewer_decision === "accept" ? " ✓" : ""}`, value: a.corrected_sentiment, justif: a.correction_reason }))}
                                            judgeFields={judgeFields} setJudgeFields={setJudgeFields} adoptedFrom={adoptedFrom} setAdoptedFrom={setAdoptedFrom}
                                            savedValue={savedSentAnn?.judge_final_value ?? undefined} savedReason={savedSentAnn?.judge_reason ?? undefined} savedSource={savedSentAnn?.judge_source ?? undefined}
                                            onSave={(finalValue, reason, source) => judgeDecideNewMutation.mutateAsync({ record_id: record.id, project_id: projectId!, annotation_type: "sentiment", final_value: finalValue, reason, source })}
                                            onUndo={() => judgeUndoMutation.mutateAsync({ record_id: record.id, project_id: projectId!, annotation_type: "sentiment" })}
                                        />
                                    );
                                })()}
                            </div>




                            {/* ── PILARES ── */}
                            {
                                Object.keys(PILAR_LABELS).length > 0 && (
                                    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginBottom: 10 }}>
                                        <div style={{ fontSize: 10, fontWeight: 600, color: "var(--amber)", marginBottom: 6 }}>PILARES DE ACEPTACIÓN</div>
                                        {Object.entries(PILAR_LABELS).map(([pilarKey, pilarLabel]) => {
                                            const llmVal = (record as any)[pilarKey] as number | undefined;
                                            const justif = (record as any)[`justif_${pilarKey}`] as string | undefined;
                                            const annotatorVals = pilarsByKey[pilarKey] ?? [];
                                            const jKey = `${record.id}__${pilarKey}`;
                                            const savedPilarAnn = annotatorVals.find(a => a.judge_final_value != null);
                                            return (
                                                <PickerFieldGroup key={pilarKey} label={pilarLabel} helpKey={pilarKey} accent="var(--teal)" jKey={jKey}
                                                    options={PILAR_OPTS.map(o => ({ v: o.v, label: o.l }))} formatValue={(v) => v === undefined ? "—" : v === 2 ? "N/A" : String(v)}
                                                    llmCandidate={{ id: "llm", icon: "🤖", label: "LLM", value: llmVal, justif }}
                                                    annotatorCandidates={annotatorVals.filter(a => a.judge_final_text == null && a.judge_final_value == null).map(a => ({ id: a.annotator, icon: "👤", label: `${a.annotator}${a.reviewer_decision === "reject" ? " ✗" : a.reviewer_decision === "accept" ? " ✓" : ""}`, value: a.corrected_value, justif: a.correction_reason }))}
                                                    judgeFields={judgeFields} setJudgeFields={setJudgeFields} adoptedFrom={adoptedFrom} setAdoptedFrom={setAdoptedFrom}
                                                    savedValue={savedPilarAnn?.judge_final_value ?? undefined} savedReason={savedPilarAnn?.judge_reason ?? undefined} savedSource={savedPilarAnn?.judge_source ?? undefined}
                                                    onSave={(finalValue, reason, source) => judgeDecideNewMutation.mutateAsync({ record_id: record.id, project_id: projectId!, annotation_type: "pilar", pilar: pilarKey, final_value: finalValue, reason, source })}
                                                    onUndo={() => judgeUndoMutation.mutateAsync({ record_id: record.id, project_id: projectId!, annotation_type: "pilar", pilar: pilarKey })}
                                                />
                                            );
                                        })}
                                    </div>
                                )
                            }

                            {/* ── IDIOMA Y GEOLOCALIZACIÓN ── */}
                            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginBottom: 10 }}>
                                <div style={{ fontSize: 10, fontWeight: 600, color: "var(--amber)", marginBottom: 6 }}>IDIOMA Y GEOLOCALIZACIÓN</div>
                                {GEO_FIELDS.map(({ key: fieldKey, label, justifKey }) => {
                                    const llmVal = (record as any)[fieldKey] as string | undefined;
                                    const llmJustif = justifKey ? (record as any)[justifKey] as string | undefined : undefined;
                                    const fieldVals = fieldsByKey[fieldKey] ?? [];
                                    const savedText = fieldVals.find(a => a.judge_final_text != null)?.judge_final_text;
                                    const savedReason = fieldVals.find(a => a.judge_final_text != null)?.judge_reason ?? undefined;
                                    const savedSource = fieldVals.find(a => a.judge_final_text != null)?.judge_source ?? undefined;
                                    const jKey = `${record.id}__field__${fieldKey}`;
                                    return (
                                        <TextFieldGroup key={fieldKey} label={label} helpKey={fieldKey} accent="var(--purple)" jKey={jKey}
                                            llmCandidate={{ id: "llm", icon: "🤖", label: "LLM", value: llmVal, justif: llmJustif }}
                                            annotatorCandidates={fieldVals.filter(a => a.judge_final_text == null && a.judge_final_value == null).map(a => ({ id: a.annotator, icon: "👤", label: `${a.annotator}${a.reviewer_decision === "reject" ? " ✗" : a.reviewer_decision === "accept" ? " ✓" : ""}`, value: a.corrected_text, justif: a.correction_reason }))}
                                            judgeFields={judgeFields} setJudgeFields={setJudgeFields} adoptedFrom={adoptedFrom} setAdoptedFrom={setAdoptedFrom}
                                            savedValue={savedText} savedReason={savedReason} savedSource={savedSource}
                                            onSave={(finalText, reason, source) => judgeDecideNewMutation.mutateAsync({ record_id: record.id, project_id: projectId!, annotation_type: "field", field_name: fieldKey, final_text: finalText, reason, source })}
                                            onUndo={() => judgeUndoMutation.mutateAsync({ record_id: record.id, project_id: projectId!, annotation_type: "field", field_name: fieldKey })}
                                        />
                                    );
                                })}
                            </div>
                            {/* Botón Guardar todo y siguiente */}
                            {(() => {
                                // "Completo" = cada uno de los 13 campos tiene ya una
                                // decisión del juez — guardada en el servidor, o
                                // reflejada localmente justo tras guardarla (para no
                                // esperar al refetch). Antes se miraba si había claves
                                // en judgeFields sin sufijo "__saved", pero ese sufijo
                                // ya no se usa (todo se autoguarda al elegir/escribir),
                                // así que el aviso se quedaba encendido para siempre en
                                // cuanto se tocaba un campo, y se apagaba solo al
                                // recargar — incluso con una decisión recién borrada
                                // con Deshacer.
                                const pendingFields: string[] = [];
                                for (const { key: fieldKey, label } of TEXT_FIELDS) {
                                    const jKey = `${record.id}__field__${fieldKey}`;
                                    const hasSaved = fieldAnns.some(a => a.field_name === fieldKey && a.judge_final_text != null);
                                    if (!hasSaved && judgeFields[jKey] === undefined) pendingFields.push(label);
                                }
                                const topicKey = `${record.id}__topic`;
                                const topicSaved = fieldAnns.some(a => a.field_name === "topic" && a.judge_final_text != null);
                                if (!topicSaved && judgeFields[topicKey] === undefined) pendingFields.push("Tema / Topic");
                                const sentKey = `${record.id}__sentiment`;
                                const sentSaved = sentAnns.some(a => a.judge_final_value != null);
                                if (!sentSaved && judgeFields[sentKey] === undefined) pendingFields.push("Sentimiento (topic)");
                                for (const [pilarKey, pilarLabel] of Object.entries(PILAR_LABELS)) {
                                    const jKey = `${record.id}__${pilarKey}`;
                                    const hasSaved = pilarAnns.some(a => a.pilar === pilarKey && a.judge_final_value != null);
                                    if (!hasSaved && judgeFields[jKey] === undefined) pendingFields.push(pilarLabel);
                                }
                                const hasPending = pendingFields.length > 0;
                                return (
                                    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                                        {hasPending && (
                                            <span style={{ fontSize: 10, color: "var(--amber)" }}>⚠ Faltan decisiones: {pendingFields.join(", ")}</span>
                                        )}
                                        <button
                                            onClick={() => handleSaveAll(record)}
                                            style={{ padding: "7px 16px", borderRadius: "var(--r)", background: hasPending ? "var(--border2)" : "var(--accent)", color: "#fff", border: "none", fontSize: 12, fontWeight: 500, cursor: "pointer" }}>
                                            Siguiente →
                                        </button>
                                    </div>
                                );
                            })()}
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

            {
                toast && (
                    <div style={{ ...S.toast, color: toast.ok ? "var(--green)" : "var(--amber)" }}>
                        {toast.ok ? "✓ " : "⚠ "}{toast.msg}
                    </div>
                )
            }
        </div >
    );
}