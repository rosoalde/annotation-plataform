"""
/home/romina/annotation-plataform/DataPreparation/analyze_schema.py — pipeline principal de análisis LLM.

Uso:
    python analyze_schema.py                  # todos los proyectos del JSON
    python analyze_schema.py bikesharing      # solo un proyecto por nombre
"""

import json
import logging
import sys
from pathlib import Path

from config import ANALYSIS_DB_PATH
from utils import find_source_csvs, run_file


EXCLUDED_PROJECTS = {
    # "bikesharing",
    # "Caminos_escolares_seguros",
    # "Control_velocidad",
    # "Plazas_accesibles_aparcamiento",
    # "regularización_inmigrantes",
    # "semáforos_accesibles",
    # "Teletrabajo",
    # "transporte_VLC_área_metropolitana", #<-ojo este
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("analyze_schema")


def load_projects() -> list:
    db_path = Path(ANALYSIS_DB_PATH)
    if not db_path.exists():
        raise FileNotFoundError(f"No se encuentra analysis_db_clean.json en: {db_path}")
    with open(db_path, encoding="utf-8") as f:
        return json.load(f)


def run_project(project: dict) -> list:
    name          = project.get("project_name", "sin_nombre")
    tema          = project["tema"]
    desc_tema     = project["desc_tema"]
    output_folder = project["output_folder"]
    sources       = project.get("sources", ["youtube", "reddit", "bluesky"])

    logger.info("=== Proyecto: %s ===", name)
    logger.info("  tema:          %s", tema)
    logger.info("  output_folder: %s", output_folder)
    logger.info("  sources:       %s", sources)

    csvs = find_source_csvs(output_folder, sources)
    if not csvs:
        logger.warning("  ⚠ No se encontraron CSVs en %s", output_folder)
        return []

    from utils import SubTopicRegistry   # evita circular si utils ya importó analyze_schema
    registry = SubTopicRegistry(output_folder)
    logger.info("  subtopic_registry: %d subtopics cargados de sesión anterior", len(registry.get()))

    results = []
    for csv_path in csvs:
        logger.info("  → Procesando: %s", csv_path.name)
        try:
            out = run_file(csv_path, tema, desc_tema, subtopic_registry=registry)
            if out:
                results.append(out)
        except Exception as exc:
            logger.error("  ERROR en %s: %s", csv_path.name, exc)

    return results


def main(project_filter: str = None) -> dict:
    projects = load_projects()
    logger.info("Cargados %d proyectos de analysis_db_clean.json", len(projects))

    all_results = {}
    for project in projects:
        name = project.get("project_name", "")
        if project_filter and name != project_filter:
            continue
        if name in EXCLUDED_PROJECTS:
                    logger.info("⏭ Proyecto excluido: %s", name)
                    continue
        all_results[name] = run_project(project)

    # Resumen final
    logger.info("\n=== RESUMEN FINAL ===")
    total = 0
    for name, outs in all_results.items():
        logger.info("  %-40s  %d archivos generados", name, len(outs))
        total += len(outs)
    logger.info("  TOTAL: %d archivos", total)

    return all_results


if __name__ == "__main__":
    filtro = sys.argv[1] if len(sys.argv) > 1 else None
    main(filtro)