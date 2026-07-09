import json
import time
from pathlib import Path

import pandas as pd
from openai import OpenAI

MODEL_NAME = "Qwen/Qwen2.5-14B-Instruct-AWQ"
# MODEL_NAME = "intfloat/e5-mistral-7b-instruct"
#vllm serve intfloat/e5-mistral-7b-instruct \
#   --port 8001 \
#   --runner pooling \
#   --dtype float16 \
#   --max-model-len 4096 \
#   --gpu-memory-utilization 0.60
'''    
base_url="http://host.docker.internal:8001/v1",
'''
client = OpenAI(
    base_url="http://localhost:8001/v1",
    api_key="local-token",
    timeout=60.0
)

response = client.chat.completions.create(
    model=MODEL_NAME,
    messages=[
        {"role": "user", "content": "Hola, ¿cómo estás?"}
    ],
    response_format={"type": "json_object"},
)
print(response)
print(response.model_dump_json())
'''
# ChatCompletion(id='chatcmpl-914b22b52ecab831', 
# choices=[Choice(finish_reason='stop', index=0, logprobs=None, 
# message=ChatCompletionMessage(content='¡Hola! Como una inteligencia artificial, 
# no tengo emociones en el sentido humano, pero gracias por preguntar. ¿Cómo estás tú? 
# ¿En qué puedo ayudarte hoy?', refusal=None, role='assistant', annotations=None, 
# audio=None, function_call=None, tool_calls=[], reasoning=None), stop_reason=None, 
# token_ids=None)], created=1783503166, model='Qwen/Qwen2.5-14B-Instruct-AWQ', 
# object='chat.completion', service_tier=None, system_fingerprint=None, 
# usage=CompletionUsage(completion_tokens=40, prompt_tokens=37, total_tokens=77, 
# completion_tokens_details=None, prompt_tokens_details=None), prompt_logprobs=None, 
# prompt_token_ids=None, kv_transfer_params=None)

 
# Single embedding

response = client.embeddings.create(
    input="Weaviate is a fully remote company with people living and working across the world.",
    model=MODEL_NAME,
)
 
print(response) # es un object que tiene los embeddings.
# CreateEmbeddingResponse(data=[Embedding(embedding=[0.0028934478759765625, 0.02508544921875, 0.05780029296875, 0.0693359375, -0.0032176971435546875, 0.01025390625, 0.0216522216796875,..., -0.0161285400390625], index=0, object='embedding')], model='text-embedding-3-small', object='list', usage=Usage(prompt_tokens=17, total_tokens=17))
print(f"Embedding length: {len(response.data[0].embedding)}")

print(f"Embedding: {response.data[0].embedding[:5]}...")
 
 
texts = [
    "Weaviate is a fully remote company with people living and working across the world.",
    "Weaviate provides a home office budget, flexible time off, and local benefits.",
    "Weaviate also allows its employees to connect with colleagues worldwide and enjoy our annual company trip."
]
 
batch_dim_response = client.embeddings.create(
    input=texts,
    model=MODEL_NAME,
    # dimensions=512, e5-mistral-7b-instruct devuelve embeddings de 4096 dimensiones fijas, y no soporta Matryoshka Representation Learning (TRUNCAR EMBEDDINGS SIN PERDER CALIDAD)
)
 
# Inspect the embeddings

for i, embedding in enumerate(batch_dim_response.data):
    print(f"Source text: {texts[i]}")
    print(f"Embedding {i+1}: {embedding.embedding[:5]}...")  # Print first few elements of each embedding
    print(f"Length: {len(embedding.embedding)}\n")
 


response = client.embeddings.create(
    input=[
        "Weaviate is a fully remote company with people living and working across the world.",
        "Weaviate provides a home office budget, flexible time off, and local benefits.",
    ],
    model=MODEL_NAME,
)

e1 = response.data[0].embedding
e2 = response.data[1].embedding
 
from scipy.spatial.distance import cosine

e1_e2_distance = cosine(e1, e2)
print(f"Cosine distance: {e1_e2_distance:.3f}")


from config import (
    MODEL_NAME,
    BASE_URL,
    API_KEY,
    TEMPERATURE,
    MAX_TOKENS,
    MAX_RETRIES,
    INPUT_GLOB,
    OUTPUT_SUFFIX,
)
from schema import ANALYZE_POST_TOOL
from prompts import build_system_prompt, build_user_prompt

client = OpenAI(base_url=BASE_URL, api_key=API_KEY, timeout=60.0)

DEFAULT_OUTPUT = {
    "pertinente": False,
    "sent_topic": 2,
    "topic": "",
    "posicion": 2,
    "idioma": [],
    "continente": [],
    "pais": [],
    "region": "",
    "ciudad": "",
    "legitimacion": 2,
    "efectividad": 2,
    "justicia_eq": 2,
    "confianza": 2,
    "sent_topic_just": "",
    "topic_just": "",
    "posicion_just": "",
    "idioma_just": "",
    "continente_just": "",
    "pais_just": "",
    "region_just": "",
    "ciudad_just": "",
    "legitimacion_just": "",
    "efectividad_just": "",
    "justicia_eq_just": "",
    "confianza_just": "",
}

COUNTRY_TO_CONTINENT = {
    "ES": "EU",
    "PT": "EU",
    "FR": "EU",
    "DE": "EU",
    "IT": "EU",
    "GB": "EU",
    "IE": "EU",
    "NL": "EU",
    "BE": "EU",
    "CH": "EU",
    "AT": "EU",
    "SE": "EU",
    "NO": "EU",
    "DK": "EU",
    "FI": "EU",
    "PL": "EU",
    "CZ": "EU",
    "SK": "EU",
    "HU": "EU",
    "RO": "EU",
    "BG": "EU",
    "GR": "EU",
    "US": "NA",
    "CA": "NA",
    "MX": "NA",
    "BR": "SA",
    "AR": "SA",
    "CL": "SA",
    "CO": "SA",
    "PE": "SA",
    "UY": "SA",
    "EC": "SA",
    "VE": "SA",
    "PY": "SA",
    "BO": "SA",
    "CR": "NA",
    "PA": "NA",
    "GT": "NA",
    "HN": "NA",
    "SV": "NA",
    "NI": "NA",
    "DO": "NA",
    "PR": "NA",
    "ZA": "AF",
    "NG": "AF",
    "MA": "AF",
    "DZ": "AF",
    "EG": "AF",
    "KE": "AF",
    "ET": "AF",
    "TN": "AF",
    "CM": "AF",
    "SN": "AF",
    "IN": "AS",
    "CN": "AS",
    "JP": "AS",
    "KR": "AS",
    "SG": "AS",
    "MY": "AS",
    "TH": "AS",
    "VN": "AS",
    "ID": "AS",
    "PH": "AS",
    "PK": "AS",
    "BD": "AS",
    "SA": "AS",
    "AE": "AS",
    "IL": "AS",
    "TR": "AS",
    "AU": "OC",
    "NZ": "OC",
}

ISO2_ALIAS = {
    "espana": "ES",
    "españa": "ES",
    "spain": "ES",
    "francia": "FR",
    "france": "FR",
    "alemania": "DE",
    "germany": "DE",
    "italia": "IT",
    "italy": "IT",
    "portugal": "PT",
    "reino unido": "GB",
    "united kingdom": "GB",
    "uk": "GB",
    "estados unidos": "US",
    "usa": "US",
    "united states": "US",
    "méxico": "MX",
    "mexico": "MX",
    "argentina": "AR",
    "colombia": "CO",
    "chile": "CL",
    "perú": "PE",
    "peru": "PE",
    "uruguay": "UY",
    "brasil": "BR",
    "brazil": "BR",
}

LANG_ISO2 = {
    "castellano": "es",
    "español": "es",
    "spanish": "es",
    "catalan": "ca",
    "català": "ca",
    "catalán": "ca",
    "basque": "eu",
    "euskera": "eu",
    "english": "en",
    "inglés": "en",
    "ingles": "en",
    "french": "fr",
    "francés": "fr",
    "frances": "fr",
    "portuguese": "pt",
    "portugués": "pt",
    "portugues": "pt",
    "galician": "gl",
    "gallego": "gl",
    "german": "de",
    "alemán": "de",
    "aleman": "de",
    "italian": "it",
}

def safe_text(val):
    if val is None:
        return ""
    s = str(val).strip()
    if s.lower() in {"nan", "none", ""}:
        return ""
    return s

def detect_social(filename):
    n = filename.lower()
    if "reddit" in n:
        return "reddit"
    if "youtube" in n:
        return "youtube"
    if "bluesky" in n:
        return "bluesky"
    return None

def normalize_language_list(values):
    out = []
    for v in values or []:
        raw = safe_text(v).lower()
        if not raw:
            continue
        code = LANG_ISO2.get(raw, raw[:2] if len(raw) >= 2 else "")
        if code and code not in out:
            out.append(code)
    return out

def normalize_country_list(values):
    out = []
    for v in values or []:
        raw = safe_text(v).strip()
        if not raw:
            continue
        key = raw.lower()
        if key in ISO2_ALIAS:
            code = ISO2_ALIAS[key]
        elif len(raw) == 2 and raw.isalpha():
            code = raw.upper()
        else:
            code = raw.upper()[:2]
        if code not in out:
            out.append(code)
    return out

def countries_to_continents(country_codes):
    out = []
    for c in country_codes or []:
        code = safe_text(c).upper()
        cont = COUNTRY_TO_CONTINENT.get(code)
        if cont and cont not in out:
            out.append(cont)
    return out

def normalize_output(args):
    out = dict(DEFAULT_OUTPUT)
    if not isinstance(args, dict):
        return out

    for k in out.keys():
        if k in args:
            out[k] = args[k]

    out["idioma"] = normalize_language_list(out["idioma"] if isinstance(out["idioma"], list) else [out["idioma"]])
    out["pais"] = normalize_country_list(out["pais"] if isinstance(out["pais"], list) else [out["pais"]])
    out["continente"] = normalize_country_list(out["continente"] if isinstance(out["continente"], list) else [out["continente"]])
    if not out["continente"]:
        out["continente"] = countries_to_continents(out["pais"])

    try:
        out["sent_topic"] = int(out["sent_topic"])
        if out["sent_topic"] not in (-1, 0, 1):
            out["sent_topic"] = 0
    except:
        out["sent_topic"] = 0

    try:
        out["posicion"] = int(out["posicion"])
        if out["posicion"] not in (-1, 0, 1, 2):
            out["posicion"] = 2
    except:
        out["posicion"] = 2

    for k in ["legitimacion", "efectividad", "justicia_eq", "confianza"]:
        try:
            out[k] = int(out[k])
            if out[k] not in (-1, 0, 1, 2):
                out[k] = 2
        except:
            out[k] = 2

    out["pertinente"] = bool(out["pertinente"])
    return out

def build_context(row, df, social):
    contenido = safe_text(row.get("contenido"))
    if contenido.lower() in {"[removed]", "[deleted]", ""}:
        return "BORRADO"

    parts = [f"[CONTENIDO]\n{contenido}"]
    tipo = safe_text(row.get("tipo")).lower()

    if social == "reddit" and tipo in {"comentario", "comment", "reply"}:
        root_id = safe_text(row.get("id_raiz"))
        if root_id and "id_raiz" in df.columns and "tipo" in df.columns:
            mask = (df["tipo"].astype(str).str.upper() == "POST") & (df["id_raiz"].astype(str) == root_id)
            parent = df[mask]
            if not parent.empty:
                parent_text = safe_text(parent.iloc[0].get("contenido"))
                if parent_text:
                    parts.insert(0, f"[POST RAÍZ]\n{parent_text[:1500]}")

    if social == "youtube":
        titulo = safe_text(row.get("titulo_video"))
        trans = safe_text(row.get("transcripcion"))
        if titulo:
            parts.insert(0, f"[TÍTULO VIDEO]\n{titulo[:500]}")
        if trans:
            parts.insert(1, f"[TRANSCRIPCIÓN]\n{trans[:1500]}")

    if social == "bluesky" and tipo in {"comment", "comentario", "reply"}:
        parent_uri = safe_text(row.get("parent_uri"))
        if parent_uri and "uri" in df.columns and "tipo" in df.columns:
            mask = (df["tipo"].astype(str).str.lower() == "post") & (df["uri"].astype(str) == parent_uri)
            parent = df[mask]
            if not parent.empty:
                parent_text = safe_text(parent.iloc[0].get("contenido"))
                if parent_text:
                    parts.insert(0, f"[POST RAÍZ]\n{parent_text[:1500]}")

    return "\n\n".join(parts)

def call_model(user_prompt):
    messages = [
        {"role": "system", "content": build_system_prompt()},
        {"role": "user", "content": user_prompt},
    ]

    last_err = None
    for _ in range(MAX_RETRIES):
        try:
            resp = client.chat.completions.create(
                model=MODEL_NAME,
                messages=messages,
                tools=[ANALYZE_POST_TOOL],
                tool_choice={"type": "function", "function": {"name": "analyze_post"}},
                temperature=TEMPERATURE,
                max_tokens=MAX_TOKENS,
            )
            msg = resp.choices[0].message
            tool_calls = getattr(msg, "tool_calls", None) or []
            if tool_calls:
                args = tool_calls[0].function.arguments
                if isinstance(args, str):
                    args = json.loads(args)
                return normalize_output(args)
            content = msg.content or "{}"
            try:
                args = json.loads(content)
            except:
                args = {}
            return normalize_output(args)
        except Exception as e:
            last_err = e
            time.sleep(1)

    raise last_err

def prepare_dataframe(path):
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        first = f.readline()
        sep = ";" if ";" in first else ","
    df = pd.read_csv(path, sep=sep, encoding="utf-8", engine="python", on_bad_lines="skip")
    if "contenido" in df.columns:
        df = df.dropna(subset=["contenido"])
        df = df[df["contenido"].astype(str).str.strip() != ""]
        df = df.reset_index(drop=True)
    return df

def ensure_output_columns(df):
    for col in DEFAULT_OUTPUT:
        if col not in df.columns:
            df[col] = ""
    return df

def run_file(path, u_conf):
    social = detect_social(path.stem)
    if social is None:
        return None

    df = prepare_dataframe(path)
    if df.empty:
        return None

    df = ensure_output_columns(df)

    for idx, row in df.iterrows():
        contenido = safe_text(row.get("contenido"))
        if not contenido:
            continue

        contexto = build_context(row, df, social)
        if contexto == "BORRADO":
            continue

        user_prompt = build_user_prompt(
            tema=u_conf["tema"],
            desc_tema=u_conf["desc_tema"],
            population_scope=u_conf["population_scope"],
            languages=u_conf["languages"],
            keywords=u_conf["keywords"],
            contenido=contexto,
            contexto_raiz="Incluido en el bloque contextual cuando aplica."
        )

        result = call_model(user_prompt)

        for k in DEFAULT_OUTPUT:
            v = result.get(k, DEFAULT_OUTPUT[k])
            if isinstance(v, (list, dict)):
                df.at[idx, k] = json.dumps(v, ensure_ascii=False)
            else:
                df.at[idx, k] = str(v)

    out_path = path.with_name(path.stem + OUTPUT_SUFFIX)
    df.to_csv(out_path, index=False, sep=";", encoding="utf-8")
    return str(out_path)

def main():
    u_conf = {
        "tema": "Regularización de inmigrantes",
        "desc_tema": "Proceso legal que permite a personas migrantes regular su situación legal en España.",
        "population_scope": "España",
        "languages": ["Castellano", "Catalan", "Euskera"],
        "keywords": [
            "regularización inmigrantes",
            "regularización migratoria",
            "derechos laborales migrantes"
        ]
    }

    files = sorted(Path(".").glob(INPUT_GLOB))
    results = []

    for f in files:
        try:
            out = run_file(f, u_conf)
            if out:
                results.append(out)
                print(f"OK: {out}")
        except Exception as e:
            print(f"ERROR en {f}: {e}")

    print(json.dumps(results, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()

'''    