import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback } from "react";
import { reviewApi } from "../services/api";

const sentLabel = (v?: number) => ({ 1: "↑ Positivo", "-1": "↓ Negativo", 0: "→ Neutro", 2: "✕ No relac." }[String(v ?? "")] ?? String(v ?? "—"));

const S: Record<string, React.CSSProperties> = {
  page: { display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)" },
  topbar: { height: 48, background: "var(--surface)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", padding: "0 22px", gap: 12, flexShrink: 0 },
  content: { flex: 1, overflowY: "auto", padding: 22, maxWidth: 960 },
  card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r2)", padding: 16, marginBottom: 12 },
  toast: { position: "fixed" as const, bottom: 20, right: 20, background: "var(--card)", border: "1px solid var(--border2)", borderRadius: "var(--r)", padding: "10px 16px", fontSize: 12, zIndex: 200 },
};

export default function ReviewView() {
  const { id: projectId } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 2600);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["review-pending", projectId],
    queryFn: () => reviewApi.pending(projectId!),
    enabled: !!projectId,
  });

  const decideMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "accept" | "reject" }) =>
      reviewApi.decide(id, decision),
    onSuccess: (_, { decision }) => {
      qc.invalidateQueries({ queryKey: ["review-pending", projectId] });
      showToast(decision === "accept" ? "Corrección aceptada ✓" : "Corrección rechazada ✗");
    },
    onError: () => showToast("Error al guardar decisión", false),
  });

  if (isLoading) return <div style={{ padding: 40, color: "var(--muted)" }}>Cargando...</div>;

  return (
    <div style={S.page}>
      <div style={S.topbar}>
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", flex: 1 }}>Revisión de anotaciones</span>
        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 100, background: "var(--card)", border: "1px solid var(--accent)", color: "var(--accent2)", fontFamily: "monospace" }}>
          {data?.length ?? 0} pendientes
        </span>
      </div>
      <div style={S.content}>
        {!data?.length && (
          <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--muted)" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
            <div style={{ fontWeight: 500, color: "var(--text)", marginBottom: 4 }}>Todo revisado</div>
            <div style={{ fontSize: 12 }}>No hay correcciones pendientes de revisar.</div>
          </div>
        )}

        {data?.map((ann) => (
          <div key={ann.id} style={S.card}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 100, background: "rgba(155,114,239,0.12)", color: "var(--purple)", border: "1px solid rgba(155,114,239,0.3)", fontFamily: "monospace", fontWeight: 600, textTransform: "uppercase" as const }}>
                {ann.annotation_type}
              </span>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>👤 {ann.annotator_name}</span>
            </div>

            {ann.record_id !== "keyword" && (
              <div style={{ fontSize: 12, lineHeight: 1.7, color: "var(--text)", background: "var(--card)", borderRadius: "var(--r)", padding: 10, margin: "8px 0", borderLeft: "3px solid var(--border2)" }}>
                (ver registro #{ann.record_id.slice(0, 8)})
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10, fontSize: 11 }}>
              <div style={{ background: "var(--bg)", padding: 10, borderRadius: "var(--r)", border: "1px solid var(--border)" }}>
                <div style={{ color: "var(--muted)", marginBottom: 4 }}>🤖 Original (LLM)</div>
                {ann.annotation_type === "sentiment" && <div>{sentLabel(ann.original_sentiment)} | {ann.original_topic || "—"}</div>}
                {ann.annotation_type === "pilar" && <div>{ann.pilar}: {ann.original_value}</div>}
                {ann.annotation_type === "keyword" && <div>{ann.corrected_topic}</div>}
                {ann.annotation_type === "field" && <div>{ann.field_name}: {ann.original_text || "—"}</div>}
              </div>
              <div style={{ background: "rgba(78,123,239,0.08)", padding: 10, borderRadius: "var(--r)", border: "1px solid rgba(78,123,239,0.25)" }}>
                <div style={{ color: "var(--accent2)", marginBottom: 4 }}>👤 Corrección humana</div>
                {ann.annotation_type === "sentiment" && <div>{sentLabel(ann.corrected_sentiment)} | {ann.corrected_topic || "—"}</div>}
                {ann.annotation_type === "pilar" && <div>{ann.pilar}: {ann.corrected_value}</div>}
                {ann.annotation_type === "field" && <div>{ann.field_name}: {ann.corrected_text || "—"}</div>}
                {ann.annotation_type === "keyword" && <div>{ann.is_correction ? "Rechazada" : "Aceptada"}</div>}
              </div>
            </div>

            {ann.correction_reason && (
              <div style={{ fontSize: 11, color: "var(--amber)", marginBottom: 12 }}>
                <strong>Motivo:</strong> {ann.correction_reason}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                style={{ padding: "6px 12px", borderRadius: "var(--r)", border: "1px solid rgba(224,82,82,0.3)", background: "rgba(224,82,82,0.08)", color: "var(--red)", fontSize: 11, fontWeight: 500 }}
                onClick={() => decideMutation.mutate({ id: ann.id, decision: "reject" })}>
                ✗ Rechazar
              </button>
              <button
                style={{ padding: "6px 12px", borderRadius: "var(--r)", border: "1px solid rgba(46,194,126,0.3)", background: "rgba(46,194,126,0.08)", color: "var(--green)", fontSize: 11, fontWeight: 500 }}
                onClick={() => decideMutation.mutate({ id: ann.id, decision: "accept" })}>
                ✓ Aceptar
              </button>
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