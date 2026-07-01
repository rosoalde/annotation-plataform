// ── Enums ──────────────────────────────────────────────────────────────────
export type UserRole = "annotator" | "reviewer" | "judge" | "admin";
export type UserStatus = "pending" | "approved" | "rejected";
export type RecordStatus = "pending" | "annotated_partial" | "annotated" | "judged";
export type AnnotationType = "sentiment" | "pillar" | "keyword";
export type ReviewDecision = "accept" | "reject";

// ── Auth ───────────────────────────────────────────────────────────────────
export interface AuthUser {
    id: string;
    username: string;
    role: UserRole;
    status: UserStatus;
    email?: string;
}

export interface RegisterResponse {
    id: string;
    username: string;
    email: string;
    role: UserRole;
    status: UserStatus;
    message: string;
}

export interface TokenResponse {
    access_token: string;
    token_type: string;
    user_id: string;
    username: string;
    role: UserRole;
    status: UserStatus;
}

// ── Admin: user approval ─────────────────────────────────────────────────
export interface PendingUser {
    id: string;
    username: string;
    email: string;
    role: UserRole;
    status: UserStatus;
    created_at: string;
}

export interface AppUser extends PendingUser { }

// ── Projects ───────────────────────────────────────────────────────────────
export interface Project {
    id: string;
    name: string;
    tema: string;
    desc_tema: string;
    population_scope: string;
    output_folder?: string;
    created_at: string;
    keywords?: KeywordItem[];
}

// ── Records ────────────────────────────────────────────────────────────────
export interface WorldData {
    continent?: string;
    country?: string;
    region?: string;
    city?: string;
}

export interface Record {
    id: string;
    external_id?: string;
    content: string;
    platform?: string;
    tipo?: string;
    fecha?: string;
    fuente?: string;
    titulo_padre?: string;
    cuerpo_padre?: string;
    descripcion_padre?: string;
    tweet_anterior?: string;
    idioma_ia?: string;
    // Produced by the LLM re-analysis pass, imported as CSV columns:
    // lang, world_continent, world_country, world_region, world_city
    lang?: string;
    world_continent?: string;
    world_country?: string;
    world_region?: string;
    world_city?: string;
    sentiment_llm?: number;
    topic_llm?: string;
    legitimacion?: number;
    efectividad?: number;
    justicia_equidad?: number;
    confianza_institucional?: number;
    url_post?: string;
    pertinencia?: string;
    justif_pertinencia?: string;
    posicion?: string;
    justif_posicion?: string;
    justif_topic?: string;
    justif_sentimiento?: string;
    justif_legitimacion?: string;
    justif_efectividad?: string;
    justif_justicia_equidad?: string;
    justif_confianza_institucional?: string;
    justif_lang?: string;
    justif_continente?: string;
    justif_pais?: string;
    justif_region?: string;
    justif_ciudad?: string;
    codigo_pais?: string;
    status: RecordStatus;
    locked_by_other: boolean;
    locked_until?: string;
}

export interface RecordListResponse {
    records: Record[];
    total: number;
    pending: number;   // server-computed: never negative
    done: number;
    offset: number;
    limit: number;
}

// ── Annotations ────────────────────────────────────────────────────────────
export interface SentimentAnnotationCreate {
    record_id: string;
    project_id: string;
    original_sentiment: number;
    corrected_sentiment: number;
    is_correction: boolean;
    correction_reason?: string;
    original_topic?: string;
    corrected_topic?: string;
    topic_reason?: string;
    expected_version?: number;
}

export interface PillarAnnotationCreate {
    record_id: string;
    project_id: string;
    pillar: string;
    original_value: number;
    corrected_value: number;
    is_correction: boolean;
    correction_reason?: string;
    expected_version?: number;
}

export interface KeywordDecisionCreate {
    project_id: string;
    keyword: string;
    accepted: boolean;
    reason?: string;
    type?: string;
    languages?: string;
}

export interface KeywordItem {
    id: string;
    keyword: string;
    type: string;
    accepted?: boolean;
    reason?: string;
    languages?: string;
    reviewer_decision?: ReviewDecision;
}

export interface AnnotationResponse {
    id: string;
    record_id: string;
    annotation_type: AnnotationType;
    is_correction: boolean;
    created_at: string;
    version: number;
}


export interface FieldAnnotationCreate {
    record_id: string;
    project_id: string;
    field_name: string;
    original_text: string;
    corrected_text: string;
    is_correction: boolean;
    correction_reason: string;
}

export interface ProjectUpdate {
    name: string;
    tema: string;
    desc_tema: string;
    population_scope: string;
}
// ── Review ─────────────────────────────────────────────────────────────────
export interface ReviewAnnotation {
    id: string;
    record_id: string;
    annotation_type: AnnotationType;
    annotator_name: string;
    original_sentiment?: number;
    corrected_sentiment?: number;
    correction_reason?: string;
    original_topic?: string;
    corrected_topic?: string;
    original_value?: number;
    corrected_value?: number;
    pillar?: string;
    is_correction: boolean;
    reviewer_decision?: ReviewDecision;
    created_at: string;
}

// ── Judge ──────────────────────────────────────────────────────────────────
export interface JudgeAnnotation {
    id: string;
    annotator: string;
    corrected_sentiment?: number;
    correction_reason?: string;
    corrected_topic?: string;
    corrected_value?: number;
    pillar?: string;
    field_name?: string;
    corrected_text?: string;
    is_correction: boolean;
    judge_final_value?: number;
}

export interface JudgeRecord {
    record: Record;
    annotations: JudgeAnnotation[];
}

// ── Stats ──────────────────────────────────────────────────────────────────
export interface ProjectStats {
    total_records: number;
    pending: number;
    annotated_partial: number;
    annotated: number;
    judged: number;
    total_annotations: number;
    total_corrections: number;
}

// ── API error ──────────────────────────────────────────────────────────────
export interface ApiError {
    error?: string;
    message?: string;
    detail?: string | object;
}

export interface CsvImportResult {
    imported: number;
    skipped: number;
    errors: Array<{ fila: number; error: string }>;
    project_updated: boolean;
}