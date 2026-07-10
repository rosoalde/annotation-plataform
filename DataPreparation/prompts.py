# DataPreparation/prompts.py (modificar build_system_prompt y build_user_prompt)

def build_system_prompt() -> str:
    return (
        "Eres un analista experto en social listening, stance detection y clasificación de opinión pública. "
        "Tu tarea es analizar un único contenido de redes sociales y devolver EXCLUSIVAMENTE una llamada "
        "a la función `analyze_post` con un objeto JSON que respete el schema provisto. "
        "No escribas texto libre fuera de la tool call. "

        "DISTINCIÓN FUNDAMENTAL — SENTIMIENTO vs. POSTURA: "
        "El sentimiento (sent_topic) es la emoción del texto hacia el subtopic. "
        "La postura (posicion) es la posición ideológica del autor hacia el TEMA PRINCIPAL. "
        "No tienen por qué coincidir. Ejemplo, si el tema principal es 'Ley de vivienda', y el contenido a analizar es'Me alegra que hayan tumbado esa ley' → "
        "sent_topic=1 (alegría), posicion=-1 (contra la ley). "
        "Otro ejemplo, si el tema principal es 'Proteccción de los ríos', y el contenido a analizar es 'Es una vergüenza que no protejan el río' → sent_topic=-1 (indignación), "
        "posicion=1 (a favor de proteger el río). "

        "STANCE DETECTION: La postura puede inferirse de afirmaciones directas, ironía, sarcasmo, "
        "preguntas retóricas, o de la valoración de consecuencias. "
        "El tema puede ser un evento, una medida, un producto, un servicio o una política; "
        "adapta el criterio a_favor/en_contra al contexto (p.ej.: 'a favor de X' = le gusta X / recomienda X). "

        "GEOLOCALIZACIÓN: Infiere idioma/país SOLO de evidencias del texto "
        "(léxico, menciones explícitas, nombre de instituciones, moneda, etc.). "
        "No asumas país por el idioma (el español se habla en 20 países). "
        "Si no hay evidencia clara, devuelve ['N/A']. "

        "PILARES: Solo evalúa legitimación/efectividad/justicia_eq/confianza "
        "si el contenido hace referencia EXPLÍCITA o MUY INFERIBLE a esos conceptos. "
        "En caso de duda, usa 2 (no aplica). "

        "FORMATO: Devuelve temperature=0, respuesta determinista, concisa. "
        "Si el runtime admite razonamiento estructurado, inclúyelo en model_reasoning (≤300 chars)."
    )

def build_user_prompt(tema: str, desc_tema: str, contenido: str, known_topics: list = None) -> str:
    if known_topics:
        topic_seed_block = (
            f"4) SUBTOPIC (topic): Ya tenemos {len(known_topics)} topics identificados para este proyecto:\n"
            f"   {', '.join(known_topics)}\n"
            f"   Intenta asignar el contenido a UNO de estos topics (elige el más específico y preciso).\n"
            f"   Si NINGUNO encaja bien, crea un topic nuevo en 2-5 palabras en castellano.\n"
            f"   No repitas el tema principal ({tema}). Sé específico: no uses el topic genérico si hay uno más preciso."
        )
    else:
        topic_seed_block = (
            f"4) SUBTOPIC (topic): Extrae el aspecto concreto del contenido en 2-5 palabras en castellano.\n"
            f"   No repitas el tema principal ({tema}).\n"
            f"   Ej: si el tema es 'plan de vivienda', el topic podría ser 'precio del alquiler', 'acceso hipotecario', etc."
        )
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
3) POSTURA (posicion): Infiere la posición del autor hacia el TEMA PRINCIPAL (no hacia el subtopic).
   - 1 = A FAVOR / PRO: apoya, defiende, respalda (incluyendo ironía anti-crítica del tema).
   - -1 = EN CONTRA / ANTI: critica, rechaza, se opone.
   - 0 = NEUTRO / MIXTO: reconoce pros y contras, pregunta genuinamente sin posicionarse.
   - 2 = SIN POSTURA INFERIBLE: el texto no da pistas sobre la postura del autor.
   IMPORTANTE: un mismo texto puede tener sent_topic negativo y posicion positiva (y viceversa).
   La ironía y el sarcasmo invierten la postura respecto al sentimiento superficial.

{topic_seed_block}

5) GEOLOCALIZACIÓN: Basa la detección en evidencias explícitas del texto.
   - idioma: código ISO 639-1 del idioma del texto (no del país al que se refiere).
   - pais: país AL QUE SE REFIERE el contenido, no donde vive el autor (a menos que sea explícito).
   - El español no implica España. Usa ['N/A'] si no hay evidencia clara.

6) PILARES (legitimacion, efectividad, justicia_eq, confianza):
   Evalúa SOLO si el texto hace referencia explícita o muy clara a ese concepto.
   En caso de duda usa 2 (no aplica). No imputes valores donde no hay evidencia.
7) Si pertinente == false: rellena el resto con valores neutros (numéricos=2, strings=\"\", listas=[]).
8) Salida: devuelve la tool call EXACTA. Ejemplo de objeto (formato esperado dentro de la tool call):
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