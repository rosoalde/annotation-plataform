"""
/home/romina/annotation-plataform/DataPreparation/reprocess_missing.py — Reprocesado dirigido a columnas completamente vacías.

Sigue la misma convención que analyze_schema.py: lee los proyectos desde
analysis_db_clean.json (tema, desc_tema, output_folder, sources) y descubre
los CSVs ya analizados en cada output_folder por glob — no hay que pasar
rutas ni tema/desc_tema a mano.

Para cada CSV ya analizado (los que terminan en OUTPUT_SUFFIX, ej.
"_reanalizado_schema.csv"):
  1. Calcula qué columnas (dentro de DEFAULT_OUTPUT) están vacías en TODAS
     (o casi todas, según --threshold) las filas.
  2. Si no hay ninguna columna así, no toca el archivo.
  3. Si hay columnas vacías, llama de nuevo al LLM fila por fila, pero
     SOLO sobrescribe esas columnas puntuales — el resto de los valores
     ya calculados en la fila queda intacto.

Uso:
    python reprocess_missing.py                    # todos los proyectos del JSON
    python reprocess_missing.py bikesharing         # solo un proyecto
    python reprocess_missing.py bikesharing --threshold 0.9
    python reprocess_missing.py bikesharing --fields pertinente_just   # solo esa columna
    python reprocess_missing.py --fields pertinente_just # todos los proyectos, solo esa columna
"""

import argparse
import json
import logging
from pathlib import Path

import pandas as pd

from analyze_schema import load_projects
from config import OUTPUT_SUFFIX, MODEL_NAME, TEMPERATURE, MAX_TOKENS, MAX_RETRIES, TOP_K
from schema import ANALYZE_POST_TOOL
from utils import (
    DEFAULT_OUTPUT,
    SAVE_EVERY,
    SubTopicRegistry,
    _atomic_save,
    _is_empty,
    validate_completeness,
    build_context,
    call_model,
    detect_social,
    get_client,
    prepare_dataframe,
    ensure_output_columns,
    safe_text,
)


EXCLUDED_PROJECTS = {
    "bikesharing",
    "Caminos_escolares_seguros",
    "Control_velocidad",
    "Plazas_accesibles_aparcamiento",
    "regularizacion_inmigrantes",
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("reprocess_missing")


def is_missing(value) -> bool:
    """Mismo criterio de 'vacío' usado en el resto del pipeline."""
    if value is None:
        return True
    text = str(value).strip()
    return text == "" or text.lower() in ("nan", "none", "[]", "n/a")


def find_analyzed_csvs(output_folder: str, sources: list) -> list:
    """
    Igual que find_source_csvs() en utils.py, pero busca los CSVs YA
    ANALIZADOS (los que terminan en OUTPUT_SUFFIX), no los originales.
    """
    folder = Path(output_folder)
    if not folder.exists():
        logger.warning("output_folder no existe: %s", folder)
        return []
    candidates = list(folder.glob(f"*{OUTPUT_SUFFIX}"))
    result = []
    for p in candidates:
        stem = p.name[: -len(OUTPUT_SUFFIX)] if p.name.endswith(OUTPUT_SUFFIX) else p.stem
        social = detect_social(stem)
        if social and social in sources:
            result.append(p)
    return sorted(result)


def find_empty_columns(df: pd.DataFrame, threshold: float = 1.0, fields: list = None) -> dict:
    """
    Devuelve {columna: fracción_vacía} para las columnas cuya fracción de
    valores vacíos sea >= threshold (1.0 = 100%, todas vacías).

    Si `fields` viene con una lista, SOLO se evalúan esas columnas
    (en vez de barrer todo DEFAULT_OUTPUT) — así no se cuela ninguna
    otra columna vacía que no pediste completar.
    """
    total = len(df)
    result = {}
    cols_to_check = fields if fields else list(DEFAULT_OUTPUT.keys())
    for col in cols_to_check:
        if col not in df.columns:
            result[col] = 1.0
            continue
        empty_count = df[col].apply(is_missing).sum()
        frac = empty_count / total if total else 0.0
        if frac >= threshold:
            result[col] = frac
    return result


def build_partial_tool(fields: list) -> dict:
    """
    Construye una versión reducida de ANALYZE_POST_TOOL que solo declara
    (y por lo tanto solo le pide al LLM) los campos indicados en `fields`,
    reusando las descripciones ya escritas en schema.py. Así el modelo no
    vuelve a razonar sobre las otras ~20 propiedades que ya están bien.
    """
    full_props = ANALYZE_POST_TOOL["function"]["parameters"]["properties"]
    unknown = [f for f in fields if f not in full_props]
    if unknown:
        raise ValueError(f"Campos no reconocidos en schema.py: {unknown}")

    return {
        "type": "function",
        "function": {
            "name": "complete_missing_fields",
            "description": (
                "Analiza un contenido de redes sociales respecto a un tema dado, pero "
                "EXCLUSIVAMENTE para completar los campos indicados a continuación "
                "(el resto del análisis ya fue hecho y no debe repetirse): "
                + ", ".join(fields) + ". "
                "Devuelve SIEMPRE un único objeto JSON con únicamente estas propiedades."
            ),
            "parameters": {
                "type": "object",
                "required": list(fields),
                "properties": {k: full_props[k] for k in fields},
            },
        },
    }


def build_partial_prompt(tema: str, desc_tema: str, contenido: str, fields: list) -> str:
    """Prompt corto: contexto habitual + solo la descripción de los campos pedidos."""
    full_props = ANALYZE_POST_TOOL["function"]["parameters"]["properties"]
    campos_txt = "\n".join(f"- {f}: {full_props[f]['description']}" for f in fields)
    return (
        f"=== TEMA DE ANÁLISIS ===\n{tema}\n\n"
        f"=== DESCRIPCIÓN DEL TEMA ===\n{desc_tema}\n\n"
        f"=== CONTENIDO A ANALIZAR ===\n{contenido}\n\n"
        "=== INSTRUCCIONES ===\n"
        "Este contenido ya fue analizado completamente. Los siguientes campos quedaron\n"
        "vacíos o ausentes y son lo ÚNICO que debés completar ahora:\n\n"
        f"{campos_txt}\n\n"
        "No evalúes ni devuelvas ningún otro campo. Basate únicamente en el [CONTENIDO]\n"
        "(y el tema/descripción de arriba como contexto) para responder estos campos puntuales."
    )


def call_model_partial(tema: str, desc_tema: str, contenido: str, fields: list) -> dict:
    """
    Igual que call_model() en utils.py, pero con un tool schema y un prompt
    reducidos a únicamente los `fields` pedidos — no vuelve a pedirle al LLM
    que analice el resto de las ~20 dimensiones del schema completo.
    """
    tool = build_partial_tool(fields)
    messages = [
        {"role": "system", "content": (
            "Eres un experto en análisis de opinión pública en redes sociales. "
            "Se te pide completar ÚNICAMENTE unos campos puntuales de un análisis ya "
            "existente. Devuelve EXCLUSIVAMENTE una tool call a "
            "`complete_missing_fields`, sin texto libre fuera de ella."
        )},
        {"role": "user", "content": build_partial_prompt(tema, desc_tema, contenido, fields)},
    ]

    last_err = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = get_client().chat.completions.create(
                model=MODEL_NAME,
                messages=messages,
                tools=[tool],
                tool_choice={"type": "function", "function": {"name": "complete_missing_fields"}},
                temperature=TEMPERATURE,
                max_tokens=MAX_TOKENS,
                extra_body={"top_k": TOP_K},
            )
            msg = resp.choices[0].message
            tool_calls = getattr(msg, "tool_calls", None) or []
            if tool_calls:
                args = tool_calls[0].function.arguments
                if isinstance(args, str):
                    args = json.loads(args)
                return {k: args.get(k, DEFAULT_OUTPUT.get(k, "")) for k in fields}

            content = msg.content or "{}"
            try:
                args = json.loads(content)
            except json.JSONDecodeError:
                args = {}
            return {k: args.get(k, DEFAULT_OUTPUT.get(k, "")) for k in fields}

        except Exception as exc:
            last_err = exc
            logger.warning("Intento %d/%d fallido (partial): %s", attempt + 1, MAX_RETRIES, exc)

    raise RuntimeError(f"Modelo no respondió tras {MAX_RETRIES} intentos (partial)") from last_err


def reprocess_csv(csv_path: Path, tema: str, desc_tema: str,
                   output_folder: str, threshold: float = 1.0, fields: list = None) -> Path:
    base_name = csv_path.name[: -len(OUTPUT_SUFFIX)] if csv_path.name.endswith(OUTPUT_SUFFIX) else csv_path.stem
    social = detect_social(base_name)
    if social is None:
        raise RuntimeError(f"No se pudo detectar la red social a partir de: {csv_path.name}")

    df = prepare_dataframe(csv_path)
    if df.empty:
        raise RuntimeError(f"El CSV está vacío tras la limpieza: {csv_path.name}")

    df = ensure_output_columns(df)

    # 1. Diagnóstico: % de vacío por columna (panorama completo)
    total = len(df)
    logger.info("  Diagnóstico de vacíos por columna (%d filas):", total)
    for col in DEFAULT_OUTPUT:
        frac = (df[col].apply(is_missing).sum() / total) if total else 0.0
        if frac > 0:
            logger.info("    %-22s %5.1f%% vacío", col, frac * 100)

    # 2. Columnas que superan el umbral (restringido a `fields` si se especificó)
    empty_cols = find_empty_columns(df, threshold=threshold, fields=fields)
    if not empty_cols:
        objetivo = fields if fields else "cualquier columna del schema"
        logger.info("  %s no alcanza el umbral de %.0f%% vacío. Nada que reprocesar.", objetivo, threshold * 100)
        return csv_path

    logger.info("  Columnas a reprocesar (>= %.0f%% vacías): %s", threshold * 100, list(empty_cols.keys()))
    target_fields = list(empty_cols.keys())
    modo = "parcial (solo estos campos)" if fields else "completo (call_model de utils.py)"
    logger.info("  Modo de llamada al LLM: %s", modo)

    # Columnas 100% vacías en el CSV original suelen quedar como dtype float64 (todo NaN).
    # Forzamos object para poder escribir strings sin que pandas rechace el cambio de tipo.
    for col in target_fields:
        if col in df.columns:
            df[col] = df[col].astype(object)

    registry  = SubTopicRegistry(output_folder)
    out_path  = csv_path.with_name(csv_path.stem + "_reprocesado.csv")

    # Filas pendientes: aquellas donde alguno de los target_fields sigue vacío
    # (más preciso que _processed_ok porque los --fields pueden variar entre ejecuciones)
    def _needs_reprocess(row) -> bool:
        return any(_is_empty(row.get(f)) for f in target_fields)

    pending_idxs  = [idx for idx, row in df.iterrows() if _needs_reprocess(row)]
    total_pending = len(pending_idxs)
    logger.info("  %d filas pendientes de %d totales", total_pending, len(df))

    ok = error = 0

    for batch_start in range(0, total_pending, SAVE_EVERY):
        batch = pending_idxs[batch_start : batch_start + SAVE_EVERY]

        for idx in batch:
            row      = df.loc[idx]
            contenido = safe_text(row.get("contenido"))
            if not contenido:
                continue
            contexto = build_context(row, df, social)
            if contexto == "BORRADO":
                continue
            try:
                if fields:
                    result = call_model_partial(tema, desc_tema, contexto, target_fields)
                else:
                    result = call_model(tema, desc_tema, contexto, subtopic_registry=registry)
                for k in target_fields:
                    v = result.get(k, DEFAULT_OUTPUT[k])
                    df.at[idx, k] = json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else str(v)
                ok += 1
            except Exception as exc:
                logger.error("  Error reprocesando fila %d: %s", idx, exc)
                error += 1

        # Guardado atómico al final de cada lote
        _atomic_save(df, out_path)
        done = batch_start + len(batch)
        logger.info("  💾 %d/%d  [ok=%d error=%d]", done, total_pending, ok, error)

    # Validación final si el reproceso fue de *_just fields
    if any(f.endswith("_just") for f in target_fields):
        validate_completeness(df, out_path.name)

    logger.info(
        "  ✅ %s  [columnas=%s | ok=%d  error=%d]",
        out_path.name, target_fields, ok, error,
    )
    return out_path


def run_project(project: dict, threshold: float = 1.0, fields: list = None) -> None:
    name          = project.get("project_name", "sin_nombre")
    tema          = project["tema"]
    desc_tema     = project["desc_tema"]
    output_folder = project["output_folder"]
    sources       = project.get("sources", ["youtube", "reddit", "bluesky"])

    logger.info("=== Proyecto: %s ===", name)
    csvs = find_analyzed_csvs(output_folder, sources)
    if not csvs:
        logger.warning("  ⚠ No se encontraron CSVs ya analizados (*%s) en %s", OUTPUT_SUFFIX, output_folder)
        return

    for csv_path in csvs:
        logger.info(" → Revisando: %s", csv_path.name)
        try:
            reprocess_csv(csv_path, tema, desc_tema, output_folder, threshold, fields)
        except Exception as exc:
            logger.error("  ERROR en %s: %s", csv_path.name, exc)


def main(project_filter: str = None, threshold: float = 1.0, fields: list = None) -> None:
    projects = load_projects()
    logger.info("Cargados %d proyectos de analysis_db_clean.json", len(projects))
    for project in projects:
        name = project.get("project_name", "")
        if project_filter and name != project_filter:
            continue
        if name in EXCLUDED_PROJECTS:
            logger.info("⏭ Proyecto excluido: %s", name)
            continue
        run_project(project, threshold, fields)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("project_filter", nargs="?", default=None,
                         help="Nombre del proyecto a reprocesar (por defecto: todos)")
    parser.add_argument("--threshold", type=float, default=1.0,
                         help="Fracción mínima de vacíos para considerar una columna 'vacía' (default: 1.0 = 100%%)")
    parser.add_argument("--fields", nargs="+", default=None,
                         help="Columnas puntuales a completar (ej: --fields pertinente_just). "
                              "Si no se pasa, se evalúan todas las columnas del schema.")
    args = parser.parse_args()

    main(args.project_filter, args.threshold, args.fields)