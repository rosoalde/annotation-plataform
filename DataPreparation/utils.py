"""
utils.py — helpers compartidos para el pipeline de análisis LLM.
"""

import json
import logging
import time
import threading
from pathlib import Path
from typing import Optional, List

import pandas as pd
from openai import OpenAI

from config import (
    MODEL_NAME, BASE_URL, API_KEY,
    TEMPERATURE, TOP_K, MAX_TOKENS, MAX_RETRIES, OUTPUT_SUFFIX,
)
from schema import ANALYZE_POST_TOOL
def call_model(tema: str, desc_tema: str, contenido: str, topic_registry: "TopicRegistry | None" = None) -> dict:
    from prompts import build_system_prompt, build_user_prompt  # ← aquí
    known_topics = topic_registry.get() if topic_registry else []
    messages = [
        {"role": "system", "content": build_system_prompt()},
        {"role": "user",   "content": build_user_prompt(tema, desc_tema, contenido, known_topics)},
    ]
logger = logging.getLogger(__name__)

# ── Tablas de normalización ────────────────────────────────────────────────────

COUNTRY_TO_CONTINENT = {
    "ES":"EU","PT":"EU","FR":"EU","DE":"EU","IT":"EU","GB":"EU","IE":"EU",
    "NL":"EU","BE":"EU","CH":"EU","AT":"EU","SE":"EU","NO":"EU","DK":"EU",
    "FI":"EU","PL":"EU","CZ":"EU","SK":"EU","HU":"EU","RO":"EU","BG":"EU","GR":"EU",
    "US":"NA","CA":"NA","MX":"NA","CR":"NA","PA":"NA","GT":"NA","HN":"NA",
    "SV":"NA","NI":"NA","DO":"NA","PR":"NA",
    "BR":"SA","AR":"SA","CL":"SA","CO":"SA","PE":"SA","UY":"SA",
    "EC":"SA","VE":"SA","PY":"SA","BO":"SA",
    "ZA":"AF","NG":"AF","MA":"AF","DZ":"AF","EG":"AF","KE":"AF",
    "ET":"AF","TN":"AF","CM":"AF","SN":"AF",
    "IN":"AS","CN":"AS","JP":"AS","KR":"AS","SG":"AS","MY":"AS","TH":"AS",
    "VN":"AS","ID":"AS","PH":"AS","PK":"AS","BD":"AS","SA":"AS","AE":"AS",
    "IL":"AS","TR":"AS",
    "AU":"OC","NZ":"OC",
}

ISO2_ALIAS = {
    "espana":"ES","españa":"ES","spain":"ES","francia":"FR","france":"FR",
    "alemania":"DE","germany":"DE","italia":"IT","italy":"IT","portugal":"PT",
    "reino unido":"GB","united kingdom":"GB","uk":"GB",
    "estados unidos":"US","usa":"US","united states":"US",
    "méxico":"MX","mexico":"MX","argentina":"AR","colombia":"CO","chile":"CL",
    "perú":"PE","peru":"PE","uruguay":"UY","brasil":"BR","brazil":"BR",
}

LANG_ISO2 = {
    "castellano":"es","español":"es","spanish":"es",
    "catalan":"ca","català":"ca","catalán":"ca",
    "basque":"eu","euskera":"eu",
    "english":"en","inglés":"en","ingles":"en",
    "french":"fr","francés":"fr","frances":"fr",
    "portuguese":"pt","portugués":"pt","portugues":"pt",
    "galician":"gl","gallego":"gl",
    "german":"de","alemán":"de","aleman":"de",
    "italian":"it",
}



# DEFAULT_OUTPUT: añadir model_reasoning aquí
DEFAULT_OUTPUT = {
    "pertinente": False,
    "sent_topic": 0, "topic": "",
    "posicion": 2,
    "idioma": [], "continente": [], "pais": [],
    "region": "", "ciudad": "",
    "legitimacion": 2, "efectividad": 2, "justicia_eq": 2, "confianza": 2,
    "sent_topic_just": "", "topic_just": "", "posicion_just": "",
    "idioma_just": "", "continente_just": "", "pais_just": "",
    "region_just": "", "ciudad_just": "",
    "legitimacion_just": "", "efectividad_just": "",
    "justicia_eq_just": "", "confianza_just": "",
    # Campo adicional para almacenar razonamiento del modelo (si está disponible)
    "model_reasoning": "",
}


class TopicRegistry:
    """
    Registry de topics por proyecto. Vive en output_folder/topic_registry.json.
    Thread-safe para procesos en el mismo intérprete.
    Permite al LLM reutilizar topics ya vistos o crear nuevos.
    """
    _lock = threading.Lock()

    def __init__(self, output_folder: str):
        self._path = Path(output_folder) / "topic_registry.json"
        self._topics: list[str] = []
        self._load()

    def _load(self):
        if self._path.exists():
            try:
                data = json.loads(self._path.read_text(encoding="utf-8"))
                self._topics = data if isinstance(data, list) else []
            except Exception:
                self._topics = []

    def get(self) -> list[str]:
        return list(self._topics)

    def update(self, new_topic: str):
        """Añade new_topic si no existe ya (comparación case-insensitive). Persiste."""
        if not new_topic or not new_topic.strip():
            return
        norm = new_topic.strip().lower()
        with self._lock:
            if not any(t.lower() == norm for t in self._topics):
                self._topics.append(new_topic.strip())
                try:
                    self._path.write_text(
                        json.dumps(self._topics, ensure_ascii=False, indent=2),
                        encoding="utf-8"
                    )
                except Exception as e:
                    logger.warning("No se pudo guardar topic_registry.json: %s", e)

# Variables en memoria para recursos cargados
_LOADED_LANG_MAP = {}
_LOADED_COUNTRY_ALIAS = {}
_LOADED_COUNTRY_TO_CONTINENT = dict(COUNTRY_TO_CONTINENT)


def _load_normalization_resources():
    """
    Intenta cargar DataPreparation/resources/talkwalker_languages.json y
    DataPreparation/resources/talkwalker_countries.json y actualiza
    los mapeos usados por normalize_language_list y normalize_country_list.
    Completa automáticamente continents que falten usando COUNTRY_TO_CONTINENT.
    """
    global _LOADED_LANG_MAP, _LOADED_COUNTRY_ALIAS, _LOADED_COUNTRY_TO_CONTINENT
    base = Path(__file__).resolve().parent
    res_dir = base / "resources"
    if not res_dir.exists():
        logger.debug("No existe resources/: %s (skip)", res_dir)
        return

    # languages
    lang_file = res_dir / "talkwalker_languages.json"
    if lang_file.exists():
        try:
            data = json.loads(lang_file.read_text(encoding="utf-8"))
            # Se espera formato: [{ "iso1": "es", "name": "Spanish", "aliases": ["español","castellano"] }, ...]
            for entry in data:
                iso = entry.get("iso1")
                if not iso:
                    continue
                for alias in ([entry.get("name")] + entry.get("aliases", [])):
                    if alias:
                        _LOADED_LANG_MAP[alias.strip().lower()] = iso.strip().lower()
            logger.debug("Loaded languages resources: %d entries", len(_LOADED_LANG_MAP))
        except Exception as e:
            logger.warning("Error cargando talkwalker_languages.json: %s", e)

    # countries
    country_file = res_dir / "talkwalker_countries.json"
    if country_file.exists():
        try:
            data = json.loads(country_file.read_text(encoding="utf-8"))
            # Se espera formato: [{ "iso2": "ES", "name": "Spain", "aliases": ["España","Espana"], "continent":"EU" }, ...]
            for entry in data:
                iso2 = entry.get("iso2")
                if not iso2:
                    continue
                # registrar aliases
                for alias in ([entry.get("name")] + entry.get("aliases", [])):
                    if alias:
                        _LOADED_COUNTRY_ALIAS[alias.strip().lower()] = iso2.strip().upper()
                # continent: si viene en el JSON, usarla; si no, intentar inferir por mapping interno
                cont = entry.get("continent")
                # Normalizar y preferir valor del JSON si existe
                if cont and str(cont).strip():
                    _LOADED_COUNTRY_TO_CONTINENT[iso2.strip().upper()] = str(cont).strip().upper()
                else:
                    # Intentar inferir por el mapa interno COUNTRY_TO_CONTINENT
                    inferred = COUNTRY_TO_CONTINENT.get(iso2.strip().upper())
                    if inferred:
                        _LOADED_COUNTRY_TO_CONTINENT[iso2.strip().upper()] = inferred
                    else:
                        # Si no hay dato conocido, rellenar con 'N/A' para visibilidad
                        _LOADED_COUNTRY_TO_CONTINENT[iso2.strip().upper()] = "N/A"
            logger.debug("Loaded countries resources: %d aliases", len(_LOADED_COUNTRY_ALIAS))
        except Exception as e:
            logger.warning("Error cargando talkwalker_countries.json: %s", e)


# Cargar recursos al importar el módulo
_load_normalization_resources()


# ── Helpers de normalización ───────────────────────────────────────────────────


def safe_text(val) -> str:
    if val is None:
        return ""
    s = str(val).strip()
    return "" if s.lower() in {"nan", "none", ""} else s


def detect_social(filename: str) -> Optional[str]:
    n = filename.lower()
    if "reddit"   in n: return "reddit"
    if "youtube"  in n: return "youtube"
    if "bluesky"  in n: return "bluesky"
    if "twitter"  in n or "x_" in n or "x-" in n: return "twitter"
    return None


def normalize_language_list(values) -> list:
    out = []
    for v in values or []:
        raw = safe_text(v).lower()
        if not raw:
            continue
        # Primero intentar recursos cargados
        code = _LOADED_LANG_MAP.get(raw)
        if not code:
            code = LANG_ISO2.get(raw)
        if not code:
            # fallback heurístico: tomar primeros 2 chars
            code = raw[:2] if len(raw) >= 2 else ""
        if code and code not in out:
            out.append(code)
    return out


def normalize_country_list(values) -> list:
    out = []
    for v in values or []:
        raw = safe_text(v)
        if not raw:
            continue
        key = raw.lower()
        # Preferir alias cargados
        code = _LOADED_COUNTRY_ALIAS.get(key)
        if not code:
            code = ISO2_ALIAS.get(key, (raw.upper() if len(raw) == 2 and raw.isalpha() else raw.upper()[:2]))
        if code not in out:
            out.append(code)
    return out


def countries_to_continents(country_codes) -> list:
    out = []
    for c in country_codes or []:
        cont = _LOADED_COUNTRY_TO_CONTINENT.get(safe_text(c).upper())
        if cont and cont not in out:
            out.append(cont)
    return out


def normalize_output(args: dict) -> dict:
    out = dict(DEFAULT_OUTPUT)
    if not isinstance(args, dict):
        return out
    for k in out:
        if k in args:
            out[k] = args[k]

    out["idioma"]     = normalize_language_list(out["idioma"] if isinstance(out["idioma"], list) else [out["idioma"]])
    out["pais"]       = normalize_country_list(out["pais"] if isinstance(out["pais"], list) else [out["pais"]])
    out["continente"] = normalize_country_list(out["continente"] if isinstance(out["continente"], list) else [out["continente"]])
    if not out["continente"]:
        out["continente"] = countries_to_continents(out["pais"])

    try:
        out["sent_topic"] = int(out["sent_topic"])
        if out["sent_topic"] not in (-1, 0, 1): out["sent_topic"] = 0
    except Exception: out["sent_topic"] = 0

    try:
        out["posicion"] = int(out["posicion"])
        if out["posicion"] not in (-1, 0, 1, 2): out["posicion"] = 2
    except Exception: out["posicion"] = 2

    for k in ("legitimacion", "efectividad", "justicia_eq", "confianza"):
        try:
            out[k] = int(out[k])
            if out[k] not in (-1, 0, 1, 2): out[k] = 2
        except Exception: out[k] = 2

    out["pertinente"] = bool(out["pertinente"])

    # Asegurar N/A para listas vacías de idioma/pais/continente
    if not out["idioma"]:
        out["idioma"] = ["N/A"]
    if not out["pais"]:
        out["pais"] = ["N/A"]
    if not out["continente"]:
        out["continente"] = ["N/A"]

    return out


# ── Construcción de contexto ───────────────────────────────────────────────────

def build_context(row, df: pd.DataFrame, social: str) -> str:
    contenido = safe_text(row.get("contenido"))
    if contenido.lower() in {"[removed]", "[deleted]", ""}:
        return "BORRADO"

    parts = [f"[CONTENIDO]\n{contenido}"]
    tipo  = safe_text(row.get("tipo")).lower()

    if social == "reddit" and tipo in {"comentario", "comment", "reply"}:
        root_id = safe_text(row.get("id_raiz"))
        if root_id and "id_raiz" in df.columns:
            mask   = (df["tipo"].astype(str).str.upper() == "POST") & (df["id_raiz"].astype(str) == root_id)
            parent = df[mask]
            if not parent.empty:
                p_text = safe_text(parent.iloc[0].get("contenido"))
                if p_text:
                    parts.insert(0, f"[POST RAÍZ]\n{p_text[:1500]}")

    elif social == "youtube":
        titulo = safe_text(row.get("titulo_video"))
        trans  = safe_text(row.get("transcripcion"))
        if titulo: parts.insert(0, f"[TÍTULO VIDEO]\n{titulo[:500]}")
        if trans:  parts.insert(1, f"[TRANSCRIPCIÓN]\n{trans[:1500]}")

    elif social == "bluesky" and tipo in {"comment", "comentario", "reply"}:
        parent_uri = safe_text(row.get("parent_uri"))
        if parent_uri and "uri" in df.columns:
            mask   = (df["tipo"].astype(str).str.lower() == "post") & (df["uri"].astype(str) == parent_uri)
            parent = df[mask]
            if not parent.empty:
                p_text = safe_text(parent.iloc[0].get("contenido"))
                if p_text:
                    parts.insert(0, f"[POST RAÍZ]\n{p_text[:1500]}")

    return "\n\n".join(parts)


# ── CSV helpers ──────────────────────────────────────────────────────────

def prepare_dataframe(path: Path) -> pd.DataFrame:
    with open(path, encoding="utf-8", errors="ignore") as f:
        first = f.readline()
    sep = ";" if ";" in first else ","
    df  = pd.read_csv(path, sep=sep, encoding="utf-8", engine="python", on_bad_lines="skip")
    if "contenido" in df.columns:
        df = df.dropna(subset=["contenido"])
        df = df[df["contenido"].astype(str).str.strip() != ""].reset_index(drop=True)
    return df


def ensure_output_columns(df: pd.DataFrame) -> pd.DataFrame:
    for col in DEFAULT_OUTPUT:
        if col not in df.columns:
            df[col] = ""
    return df


def find_source_csvs(output_folder: str, sources: List[str]) -> List[Path]:
    """Devuelve los CSVs de output_folder que corresponden a las fuentes del proyecto."""
    folder = Path(output_folder)
    if not folder.exists():
        logger.warning("output_folder no existe: %s", folder)
        return []
    # Busca primero *_global_dataset.csv, luego cualquier .csv
    candidates = list(folder.glob("*_global_dataset.csv")) or list(folder.glob("*.csv"))
    result = []
    for p in candidates:
        social = detect_social(p.stem)
        if social and social in sources:
            result.append(p)
    return sorted(result)


# ── Cliente LLM ──────────────────────────────────────────────────────────

_client: Optional[OpenAI] = None

def get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(base_url=BASE_URL, api_key=API_KEY, timeout=60.0)
    return _client


def call_model(tema: str, desc_tema: str, contenido: str) -> dict:
    """
    Llama al LLM con tool_calls (function calling).
    Usa temperature=0 + top_k=1 para respuestas deterministas.
    Registra el campo 'reasoning' si el modelo lo emite (Qwen3/QwQ).
    """
    messages = [
        {"role": "system", "content": build_system_prompt()},
        {"role": "user",   "content": build_user_prompt(tema, desc_tema, contenido)},
    ]
    last_err = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = get_client().chat.completions.create(
                model=MODEL_NAME,
                messages=messages,
                tools=[ANALYZE_POST_TOOL],
                tool_choice={"type": "function", "function": {"name": "analyze_post"}},
                temperature=TEMPERATURE,   # 0 (config.py)
                max_tokens=MAX_TOKENS,
                extra_body={"top_k": TOP_K},  # vLLM: greedy-like (top_k=1)
            )
            msg = resp.choices[0].message

            # Reasoning chain (Qwen3 / QwQ; None en Qwen2.5)
            reasoning = getattr(msg, "reasoning", None)
            if reasoning:
                logger.debug("[reasoning] %s", str(reasoning)[:500])

            # Camino principal: tool_call estructurada
            tool_calls = getattr(msg, "tool_calls", None) or []
            if tool_calls:
                args = tool_calls[0].function.arguments
                if isinstance(args, str):
                    args = json.loads(args)
                return normalize_output(args)

            # Fallback: el modelo devolvió JSON en texto libre
            content = msg.content or "{}"
            try:
                args = json.loads(content)
            except json.JSONDecodeError:
                args = {}
            return normalize_output(args)

        except Exception as exc:
            last_err = exc
            logger.warning("Intento %d/%d fallido: %s", attempt + 1, MAX_RETRIES, exc)
            time.sleep(1)

    raise RuntimeError(f"Modelo no respondió tras {MAX_RETRIES} intentos") from last_err


def run_file(path: Path, tema: str, desc_tema: str, topic_registry: "TopicRegistry | None" = None) -> Optional[str]:
    """Analiza todas las filas de un CSV y guarda el resultado en output_folder."""
    social = detect_social(path.stem)
    if social is None:
        logger.warning("No se detectó red social para: %s", path.name)
        return None

    df = prepare_dataframe(path)
    if df.empty:
        logger.info("CSV vacío: %s", path.name)
        return None

    df  = ensure_output_columns(df)
    ok  = skip = error = 0

    for idx, row in df.iterrows():
        contenido = safe_text(row.get("contenido"))
        if not contenido:
            skip += 1
            continue
        contexto = build_context(row, df, social)
        if contexto == "BORRADO":
            skip += 1
            continue
        try:
            result = call_model(tema, desc_tema, contexto, topic_registry=topic_registry)
            for k in DEFAULT_OUTPUT:
                v = result.get(k, DEFAULT_OUTPUT[k])
                df.at[idx, k] = json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else str(v)
            ok += 1
        except Exception as exc:
            logger.error("Error fila %d de %s: %s", idx, path.name, exc)
            error += 1

    out_path = path.with_name(path.stem + OUTPUT_SUFFIX)
    df.to_csv(out_path, index=False, sep=";", encoding="utf-8")
    logger.info("%s → %s  [ok=%d  skip=%d  error=%d]", path.name, out_path.name, ok, skip, error)
    return str(out_path)
