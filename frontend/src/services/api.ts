import axios, { AxiosError } from "axios";
import type {
    TokenResponse, RegisterResponse, Project, RecordListResponse, AnnotationResponse,
    SentimentAnnotationCreate, PilarAnnotationCreate, KeywordDecisionCreate, FieldAnnotationCreate,
    ReviewAnnotation, ReviewDecision, JudgeRecord, ProjectStats,
    PendingUser, AppUser, UserRole, CsvImportResult,
} from "../types";

//const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8007/api";
const BASE = "/api";

export const http = axios.create({ baseURL: BASE });

http.interceptors.request.use((config) => {
    const token = localStorage.getItem("token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

http.interceptors.response.use(
    (r) => r,
    (err: AxiosError<{ detail?: any }>) => {
        if (err.response?.status === 409) {
            const detail = err.response.data?.detail;
            const msg = typeof detail === "object" ? detail.message : detail ?? "Conflicto de concurrencia";
            throw new LockConflictError(msg);
        }
        if (err.response?.status === 403) {
            const detail = err.response.data?.detail;
            const msg = typeof detail === "string" ? detail : "Cuenta no aprobada o sin permisos";
            throw new AccountPendingError(msg);
        }
        throw err;
    }
);

export class LockConflictError extends Error {
    constructor(message: string) { super(message); this.name = "LockConflictError"; }
}
export class AccountPendingError extends Error {
    constructor(message: string) { super(message); this.name = "AccountPendingError"; }
}

// ── Auth ──────────────────────────────────────────────────────────────────
export const authApi = {
    // Self-registration → account created as "pending", NO token returned.
    register: (data: { username: string; email: string; password: string; role: string }) =>
        http.post<RegisterResponse>("/auth/register", data).then((r) => r.data),

    login: (username: string, password: string) =>
        http.post<TokenResponse>("/auth/login", { username, password }).then((r) => r.data),

    me: () => http.get("/auth/me").then((r) => r.data),

    changePassword: (currentPassword: string, newPassword: string) =>
        http.post("/auth/change-password", { current_password: currentPassword, new_password: newPassword }).then((r) => r.data),
};

// ── Admin: approval workflow ───────────────────────────────────────────────
export const adminApi = {
    pendingUsers: () => http.get<PendingUser[]>("/admin/users/pending").then((r) => r.data),
    allUsers: () => http.get<AppUser[]>("/admin/users").then((r) => r.data),

    decide: (userId: string, decision: "approve" | "reject", role?: UserRole) =>
        http.post(`/admin/users/${userId}/decision`, { decision, role }).then((r) => r.data),

    changeRole: (userId: string, role: UserRole) =>
        http.post(`/admin/users/${userId}/role?role=${role}`).then((r) => r.data),

    resetPassword: (userId: string, newPassword?: string) =>
        http.post(`/admin/users/${userId}/reset-password`, { new_password: newPassword }).then((r) => r.data),
};

// ── Projects ──────────────────────────────────────────────────────────────
export const projectsApi = {
    list: () => http.get<Project[]>("/projects").then((r) => r.data),
    get: (id: string) => http.get<Project>(`/projects/${id}`).then((r) => r.data),
    create: (data: Partial<Project>) => http.post<Project>("/projects", data).then((r) => r.data),
    update: (id: string, data: Partial<Project>) => http.put<Project>(`/projects/${id}`, data).then((r) => r.data),
    stats: (projectId: string) => http.get<ProjectStats>(`/projects/${projectId}/stats`).then((r) => r.data),
};

// ── Records ───────────────────────────────────────────────────────────────
export const recordsApi = {
    list: (projectId: string, params?: { platform?: string; annotation_type?: string; limit?: number; offset?: number }) =>
        http.get<RecordListResponse>(`/projects/${projectId}/records`, { params }).then((r) => r.data),

    acquireLock: (projectId: string, recordId: string) =>
        http.post(`/projects/${projectId}/records/${recordId}/lock`).then((r) => r.data),

    releaseLock: (projectId: string, recordId: string) =>
        http.delete(`/projects/${projectId}/records/${recordId}/lock`).then((r) => r.data),

    importRecords: (projectId: string, items: object[]) =>
        http.post(`/projects/${projectId}/records/import`, items).then((r) => r.data),

    importCsv: (projectId: string, csvFile: File, metaJson?: object) => {
        const form = new FormData();
        form.append("csv_file", csvFile);
        form.append("meta_json", JSON.stringify(metaJson ?? {}));
        return http.post<CsvImportResult>(
            `/projects/${projectId}/records/import-csv`,
            form
        ).then((r) => r.data);
    },
};

// ── Annotations ───────────────────────────────────────────────────────────
export const annotationsApi = {
    saveSentiment: (projectId: string, data: SentimentAnnotationCreate) =>
        http.post<AnnotationResponse>(`/projects/${projectId}/annotations/sentiment`, data).then((r) => r.data),

    savePilar: (projectId: string, data: PilarAnnotationCreate) =>
        http.post<AnnotationResponse>(`/projects/${projectId}/annotations/pilar`, data).then((r) => r.data),

    saveKeyword: (projectId: string, data: KeywordDecisionCreate) =>
        http.post(`/projects/${projectId}/keywords`, data).then((r) => r.data),

    listKeywords: (projectId: string) =>
        http.get(`/projects/${projectId}/keywords`).then((r) => r.data),

    saveField: (projectId: string, data: FieldAnnotationCreate) =>
        http.post<AnnotationResponse>(`/projects/${projectId}/annotations/field`, data).then((r) => r.data),

    decideKeyword: (projectId: string, keywordId: string, data: KeywordDecisionCreate) =>
        http.patch(`/projects/${projectId}/keywords/${keywordId}`, data).then((r) => r.data),

    judgeKeyword: (projectId: string, keywordId: string, data: KeywordDecisionCreate) =>
        http.patch(`/projects/${projectId}/keywords/${keywordId}/judge`, data).then((r) => r.data),
};

// ── Review ────────────────────────────────────────────────────────────────
export const reviewApi = {
    pending: (projectId: string) =>
        http.get<ReviewAnnotation[]>(`/projects/${projectId}/review/pending`).then((r) => r.data),

    decide: (annotationId: string, decision: ReviewDecision) =>
        http.post(`/annotations/${annotationId}/review`, { annotation_id: annotationId, decision }).then((r) => r.data),
};

// ── Judge ─────────────────────────────────────────────────────────────────
export const judgeApi = {
    records: (projectId: string, params?: { annotation_type?: string; limit?: number; offset?: number }) =>
        http.get<JudgeRecord[]>("/judge/records", { params: { project_id: projectId, ...params } }).then((r) => r.data),

    decide: (annotationId: string, finalValue: number, reason?: string) =>
        http.post(`/judge/decide/${annotationId}`, { annotation_id: annotationId, final_value: finalValue, reason }).then((r) => r.data),

    decideText: (annotationId: string, finalText: string, reason?: string) =>
        http.post(`/judge/decide/${annotationId}`, { annotation_id: annotationId, final_text: finalText, reason }).then((r) => r.data),

    decideNew: (data: {
        record_id: string; project_id: string; annotation_type: "pilar" | "field";
        pilar?: string; field_name?: string; final_value?: number; final_text?: string; reason?: string;
    }) => http.post("/judge/decide-new", data).then((r) => r.data),

    reset: (projectId: string) =>
        http.delete(`/judge/reset/${projectId}`).then((r) => r.data),

    export: (projectId: string, format: "jsonl" | "csv" = "jsonl", mode: "judge" | "annotators" | "all" = "all") =>
        http.get(`/judge/export/${projectId}`, { params: { format, mode } }).then((r) => r.data),
};