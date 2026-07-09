# DataPreparation/prompts.py (modificar build_system_prompt y build_user_prompt)

def build_system_prompt() -> str:
    return (
        "Eres un analista experto en social listening y clasificación de opinión pública. "
        "Tu objetivo: analizar un único contenido y devolver EXCLUSIVAMENTE una llamada a la función "
        "`analyze_post` con un único objeto JSON que respete el schema provisto por la herramienta. "
        "No escribas texto libre fuera de la llamada a la función. "
        "Antes de decidir, razona internamente (chain-of-thought) sobre cada campo; sin embargo, NO emitas "
        "ese razonamiento como texto libre en la conversación — si el sistema permite incluirlo como campo "
        "\"model_reasoning\" dentro de la tool call, inclúyelo allí (texto breve). "
        "Usa un estilo determinista: responde de forma concisa y consistente. "
        "Detecta automáticamente idioma y país a partir del contenido; devuelve códigos ISO (idioma: ISO 639-1 de 2 letras; "
        "país: ISO 3166-1 alpha-2). Si no puedes identificar con confianza, devuelve [\"N/A\"] en ese campo. "
        "Si el contenido NO es pertinente para el tema, pon pertinente=false y rellena el resto con valores neutros "
        "(valores por defecto: numéricos → 2, textos → \"\", listas → [])."
    )

def build_user_prompt(tema: str, desc_tema: str, contenido: str) -> str:
    return f"""--- CONTEXTO (NO MODIFICAR) ---
TEMA:
{tema}

DESCRIPCIÓN DEL TEMA:
{desc_tema}

CONTENIDO A ANALIZAR:
{contenido}

INSTRUCCIONES (OBLIGATORIO)
1) Devuelve SÓLO una tool call a `analyze_post` cuyos argumentos sean un único objeto JSON que respete exactamente las propiedades del schema. NO añadas texto fuera de la tool call.
2) Razona internamente antes de elegir; si el runtime puede recibir razonamiento estructurado, añade un campo opcional "model_reasoning" (string) con un resumen breve del razonamiento (≤ 300 caracteres).
3) Detección automática:
   - 'idioma': lista de códigos ISO 639-1 (ej.: [\"es\",\"en\"]). Si no hay confianza, devuelve [\"N/A\"].
   - 'pais'  : lista de códigos ISO 3166-1 alpha-2 (ej.: [\"ES\",\"FR\"]). Si no hay confianza, devuelve [\"N/A\"].
   - 'continente': lista de códigos {EU,NA,SA,AF,AS,OC}. Si no puede inferirse, devuelve [\"N/A\"].
4) Valores esperados:
   - pertinente: boolean
   - sent_topic: integer ∈ {-1, 0, 1}    (-1 negativo, 0 neutro, 1 positivo)
   - topic: string (en castellano, específico)
   - posicion: integer ∈ {-1,0,1,2}     (-1 en contra, 0 mixto, 1 a favor, 2 sin postura)
   - idiomas/paises/continentes: listas de cadenas (ISO), o [\"N/A\"] si no identificado
   - region / ciudad: string (o \"\" si no consta)
   - legitimacion, efectividad, justicia_eq, confianza: integer ∈ {-1,0,1,2}
   - *_just campos: string (justificación breve, ≤ 200 caracteres)
5) Si pertinente == false: rellena el resto con valores neutros (numéricos=2, strings=\"\", listas=[]).
6) Salida: devuelve la tool call EXACTA. Ejemplo de objeto (formato esperado dentro de la tool call):
   {
     "pertinente": true,
     "sent_topic": 1,
     "topic": "vivienda asequible",
     "posicion": 0,
     "idioma": ["es"],
     "continente": ["EU"],
     "pais": ["ES"],
     "region": "",
     "ciudad": "",
     "legitimacion": 2,
     "efectividad": 2,
     "justicia_eq": 2,
     "confianza": 2,
     "sent_topic_just": "El lenguaje es positivo hacia la medida.",
     "topic_just": "Se menciona específicamente 'alquileres' y 'vivienda'.",
     "posicion_just": "",
     "idioma_just": "Español por léxico y acentos.",
     "continente_just": "España mencionado/idioma español.",
     "pais_just": "No aparece país explícito, inferido por idioma y contexto.",
     "region_just": "",
     "ciudad_just": "",
     "legitimacion_just": "",
     "efectividad_just": "",
     "justicia_eq_just": "",
     "confianza_just": "",
     "model_reasoning": "Resumen breve del razonamiento (si procede)."
   }
OBSERVACIONES FINALES
- Si un campo no aplica o no puede inferirse, usa los valores por defecto (ver schema); para idioma/pais/continente usa [\"N/A\"] si no hay confianza.
- NO uses párrafos largos en las justificaciones; manténlas concisas (≤200 caracteres).
- Recuerda: SOLO la tool call; cualquier texto adicional fuera de la llamada invalidará la respuesta automática del pipeline.
"""