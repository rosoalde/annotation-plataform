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

        {(() => {
          const groups = new Map<string, typeof data>();
          for (const ann of data ?? []) {
            if (!groups.has(ann.record_id)) groups.set(ann.record_id, []);
            groups.get(ann.record_id)!.push(ann);
          }
          return [...groups.entries()].map(([recordId, anns]) => {
            const first = anns[0];
            return (
              <div key={recordId} style={{ ...S.card, padding: 0, overflow: "hidden" }}>
                {recordId !== "keyword" && (
                  <div style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)", padding: "10px 14px" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 9, textTransform: "uppercase" as const, letterSpacing: "0.1em", color: "var(--muted)" }}>
                        {first.record_platform ?? "?"} · {first.record_tipo ?? "?"} · {first.record_fecha ?? "?"}
                      </span>
                      {first.record_url_post && (
                        <a href={first.record_url_post} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: 10, color: "var(--teal)", textDecoration: "none" }}>🔗 ver post</a>
                      )}
                    </div>
                    {first.record_cuerpo_padre && (
                      <div style={{ fontSize: 11, color: "var(--muted)", background: "var(--surface)", borderLeft: "2px solid var(--purple)", padding: "6px 8px", borderRadius: "var(--r)", marginBottom: 6 }}>
                        {first.record_titulo_padre && <strong>[{first.record_titulo_padre}] </strong>}
                        {first.record_cuerpo_padre.slice(0, 200)}{first.record_cuerpo_padre.length > 200 ? "…" : ""}
                      </div>
                    )}
                    <div style={{ fontSize: 12, lineHeight: 1.6, color: "var(--text)", borderLeft: "3px solid var(--border2)", paddingLeft: 10 }}>
                      {first.record_content || <em style={{ color: "var(--muted)" }}>(sin contenido)</em>}
                    </div>
                  </div>
                )}
                <div style={{ padding: "10px 14px" }}>
                  {anns.map((ann) => (
                    <div key={ann.id} style={{ borderBottom: "1px solid var(--border)", paddingBottom: 10, marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 100, background: "rgba(155,114,239,0.12)", color: "var(--purple)", border: "1px solid rgba(155,114,239,0.3)", fontFamily: "monospace", fontWeight: 600, textTransform: "uppercase" as const }}>
                          {ann.annotation_type}{ann.pilar ? ` · ${ann.pilar}` : ""}{ann.field_name ? ` · ${ann.field_name}` : ""}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>👤 {ann.annotator_name}</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8, fontSize: 11 }}>
                        <div style={{ background: "var(--bg)", padding: 8, borderRadius: "var(--r)", border: "1px solid var(--border)" }}>
                          <div style={{ color: "var(--muted)", marginBottom: 4 }}>🤖 Original (LLM)</div>
                          {ann.annotation_type === "sentiment" && <div>{sentLabel(ann.original_sentiment)} | {ann.original_topic || "—"}</div>}
                          {ann.annotation_type === "pilar" && <div>{ann.pilar}: {ann.original_value ?? "—"}</div>}
                          {ann.annotation_type === "field" && <div>{ann.field_name}: {ann.original_text || "—"}</div>}
                          {ann.annotation_type === "keyword" && <div>{ann.corrected_topic}</div>}
                        </div>
                        <div style={{ background: "rgba(78,123,239,0.08)", padding: 8, borderRadius: "var(--r)", border: "1px solid rgba(78,123,239,0.25)" }}>
                          <div style={{ color: "var(--accent2)", marginBottom: 4 }}>👤 Corrección humana</div>
                          {ann.annotation_type === "sentiment" && <div>{sentLabel(ann.corrected_sentiment)} | {ann.corrected_topic || "—"}</div>}
                          {ann.annotation_type === "pilar" && <div>{ann.pilar}: {ann.corrected_value ?? "—"}</div>}
                          {ann.annotation_type === "field" && <div>{ann.field_name}: {ann.corrected_text || "—"}</div>}
                          {ann.annotation_type === "keyword" && <div>{ann.is_correction ? "Rechazada" : "Aceptada"}</div>}
                        </div>
                      </div>
                      {ann.correction_reason && (
                        <div style={{ fontSize: 11, color: "var(--amber)", marginBottom: 8 }}>
                          <strong>Motivo:</strong> {ann.correction_reason}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button
                          style={{ padding: "5px 11px", borderRadius: "var(--r)", border: "1px solid rgba(224,82,82,0.3)", background: "rgba(224,82,82,0.08)", color: "var(--red)", fontSize: 11, fontWeight: 500, cursor: "pointer" }}
                          onClick={() => decideMutation.mutate({ id: ann.id, decision: "reject" })}>
                          ✗ Rechazar
                        </button>
                        <button
                          style={{ padding: "5px 11px", borderRadius: "var(--r)", border: "1px solid rgba(46,194,126,0.3)", background: "rgba(46,194,126,0.08)", color: "var(--green)", fontSize: 11, fontWeight: 500, cursor: "pointer" }}
                          onClick={() => decideMutation.mutate({ id: ann.id, decision: "accept" })}>
                          ✓ Aceptar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          });
        })()}

      </div>

      {toast && (
        <div style={{ ...S.toast, color: toast.ok ? "var(--green)" : "var(--amber)" }}>
          {toast.ok ? "✓ " : "⚠ "}{toast.msg}
        </div>
      )}
    </div>
  );
}