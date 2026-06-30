/**
 * ProjectContextBar
 *  - Barra fija con el contexto del proyecto (tema, descripción, ámbito).
 *  - Se monta una sola vez arriba de la lista de registros en AnnotateView,
 *    para que el anotador nunca pierda de vista para qué proyecto está anotando.
 */
import { useQuery } from "@tanstack/react-query";
import { projectsApi } from "../services/api";

export default function ProjectContextBar({ projectId }: { projectId: string }) {
    const { data: project, isLoading } = useQuery({
        queryKey: ["project", projectId],
        queryFn: () => projectsApi.get(projectId),
        enabled: !!projectId,
        staleTime: 60_000,
    });

    if (isLoading || !project) return null;

    return (
        <div style={S.bar}>
            <div style={S.row}>
                <span style={S.label}>Tema</span>
                <span style={S.value}>{project.tema || "—"}</span>
            </div>
            {project.desc_tema && (
                <div style={S.row}>
                    <span style={S.label}>Descripción</span>
                    <span style={{ ...S.value, color: "var(--muted)" }}>{project.desc_tema}</span>
                </div>
            )}
            {project.population_scope && (
                <div style={S.row}>
                    <span style={S.label}>Ámbito</span>
                    <span style={{ ...S.value, color: "var(--teal)" }}>🌍 {project.population_scope}</span>
                </div>
            )}
        </div>
    );
}

const S: Record<string, React.CSSProperties> = {
    bar: {
        position: "sticky" as const,
        top: 0,
        zIndex: 10,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r)",
        padding: "10px 14px",
        marginBottom: 16,
        display: "flex",
        flexDirection: "column" as const,
        gap: 4,
    },
    row: { display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" as const },
    label: {
        fontSize: 9,
        textTransform: "uppercase" as const,
        letterSpacing: "0.1em",
        color: "var(--muted)",
        fontWeight: 600,
        minWidth: 78,
        flexShrink: 0,
    },
    value: { fontSize: 12, color: "var(--text)", lineHeight: 1.5 },
};