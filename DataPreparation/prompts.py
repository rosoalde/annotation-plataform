"""
prompts.py — Instrucciones al LLM para stance detection y clasificación de contenido social.

Estructura del input (generada por build_context en utils.py):

  Caso POST:
      [TIPO]
      POST
      [CONTENIDO]
      <texto del post>

  Caso COMENTARIO:
      [TIPO]
      COMENTARIO (respuesta a un post)
      [POST RAÍZ]
      <texto del post al que responde>
      [CONTENIDO]
      <texto del comentario>

  Caso YouTube (post/comentario):
      [TIPO]
      POST | COMENTARIO
      [TÍTULO VIDEO]
      <título>
      [TRANSCRIPCIÓN]
      <extracto>
      [CONTENIDO]
      <descripción o comentario>

El modelo analiza SIEMPRE el bloque [CONTENIDO].
[POST RAÍZ] / [TÍTULO VIDEO] / [TRANSCRIPCIÓN] son contexto auxiliar, NO el objeto de análisis.
"""


def build_system_prompt() -> str:
    return (
        "Eres un experto en detección de postura y análisis de opinión pública en redes sociales. "
        "Recibirás un contenido etiquetado como POST o COMENTARIO y deberás analizarlo respecto a un TEMA dado. "

        "ESTRUCTURA DEL INPUT: "
        "El campo [TIPO] indica si el texto principal es un POST o un COMENTARIO. "
        "El campo [CONTENIDO] es SIEMPRE el texto que debes analizar. "
        "Los campos [POST RAÍZ], [TÍTULO VIDEO] o [TRANSCRIPCIÓN] son contexto adicional "
        "para comprender el [CONTENIDO], pero NO son el objeto de análisis. "
        "Si el [TIPO] es COMENTARIO: analiza la postura del AUTOR del [CONTENIDO] (no del post raíz). "
        "El [POST RAÍZ] te ayuda a entender a qué se refiere el comentario, pero la clasificación "
        "es sobre lo que dice el comentarista, no el autor del post original. "

        "DISTINCIÓN SENTIMIENTO vs. POSTURA (stance): "
        "SENTIMIENTO (sent_subtopic): polaridad emocional del texto  hacia el subtopic extraído: (positivo/negativo/neutro). No describe la postura hacia el tema principal."
        "POSTURA (posicion): posición del autor hacia el TEMA PRINCIPAL (a favor / en contra / neutro / sin indicio). "
        "No tienen por qué coincidir. "
        "Ej 1 — tema 'Ley de vivienda', contenido 'Me alegra que tumbaran esa ley': "
        "sent_subtopic=1 (alegría), posicion=-1 (contra la ley). "
        "Ej 2 — tema 'Protección del río', contenido 'Es una vergüenza que no lo protejan': "
        "sent_subtopic=-1 (indignación), posicion=1 (a favor de protegerlo). "
        "Ej 3 — contenido irónico 'Claro, genial idea contaminar más': "
        "sent_subtopic=1 (superficialmente positivo), posicion=-1 (en contra, ironía). "

        "STANCE DETECTION: La postura puede inferirse de afirmaciones directas, ironía, sarcasmo, "
        "preguntas retóricas, o de la valoración de consecuencias. "
        "Teniendo en cuenta que el tema puede ser un evento, una medida, un producto, un servicio o una política; "
        "adapta el criterio a_favor/en_contra al contexto (p.ej.: 'a favor de X' = le gusta X / recomienda X). "

        "GEOLOCALIZACIÓN: Infiere idioma/país SOLO de evidencias del texto. "
        "(léxico, menciones explícitas, nombre de instituciones, moneda, etc.). "

        "No asumas país por el idioma. El español se habla en +20 países; no asumas España por defecto. "
        "Si no hay evidencia clara usa ['N/A']. "

        "PILARES: Solo evalúa legitimación/efectividad/justicia_eq/confianza si el texto hace referencia explícita o muy inferible "
        "a esos conceptos. En caso de duda usa 2 (no aplica). "

        "Devuelve EXCLUSIVAMENTE una tool call a `analyze_post`. Sin texto libre fuera de ella."
    )


def build_user_prompt(tema: str, desc_tema: str, contenido: str, known_topics: list = None) -> str:

    # Bloque de subtopics conocidos
    if known_topics:
        topic_block = (
            f"SUBTOPICS YA IDENTIFICADOS EN ESTE PROYECTO ({len(known_topics)}):\n"
            + ", ".join(known_topics) + "\n"
            "→ Si el argumento del [CONTENIDO] encaja con uno de estos, reutiliza EXACTAMENTE ese texto.\n"
            f"→ Si no encaja con ninguno, crea uno nuevo en 2-5 palabras en castellano sin repetir '{tema}'."
        )
    else:
        topic_block = (
            f"Extrae el aspecto concreto mencionado o inferido de forma muy clara en 2-5 palabras en castellano.\n"
            f"No uses el tema principal ('{tema}') como subtopic.\n"
            f"Describe el ASPECTO concreto del [CONTENIDO].\n"
            f"Ej: si el tema es 'plan de vivienda' → subtopic podría ser 'precio del alquiler elevado', "
            f"'falta de oferta pública', 'impacto en jóvenes', etc."
        )

    return f"""=== TEMA DE ANÁLISIS ===
{tema}

=== DESCRIPCIÓN DEL TEMA DE ANÁLISIS ===
{desc_tema}

=== CONTENIDO A ANALIZAR ===
{contenido}

=== REGLA FUNDAMENTAL ===
Analiza SIEMPRE el bloque [CONTENIDO].
Si [TIPO] es COMENTARIO: el objeto de análisis es el COMENTARISTA, no el autor del [POST RAÍZ].
Usa [POST RAÍZ] / [TÍTULO VIDEO] / [TRANSCRIPCIÓN] únicamente para entender el contexto
al que responde el [CONTENIDO], pero clasifica basándote en lo que dice el [CONTENIDO].

=== PASO 0 — PERTINENCIA ===
¿Habla el [CONTENIDO] del tema '{tema}'?
→ pertinente=true  si el [CONTENIDO] se refiere al tema, aunque sea lateralmente.
→ pertinente=false si es spam, off-topic, contenido borrado o completamente ajeno al tema.
En caso de duda → pertinente=true.
Si pertinente=false: rellena el resto con valores neutros (numéricos=2, strings="", listas=[]).

=== PASO 1 — SENTIMIENTO (sent_subtopic) ===
Polaridad emocional del [CONTENIDO] respecto a su subtopic:
  1  → Positivo: alegría, satisfacción, aprobación, esperanza.
 -1  → Negativo: enojo, queja, preocupación, decepción, indignación.
  0  → Neutro: informativo, descriptivo, sin carga emocional clara.
Atención a la ironía: "Genial, otra subida de impuestos" → subtopic= subida de impuestos, sent_subtopic=-1.

=== PASO 2 — POSTURA / STANCE (posicion) ===
Posición del AUTOR DEL [CONTENIDO] hacia el TEMA PRINCIPAL '{tema}':
  1  → A FAVOR / PRO: apoya, defiende, recomienda, le gusta, valora positivamente, respalda (incluyendo ironía anti-crítica del tema)..
 -1  → EN CONTRA / ANTI: rechaza, critica el concepto, se opone, lo cuestiona.
  0  → NEUTRO / MIXTO: pregunta genuina, reconoce pros y contras, sin posicionamiento.
  2  → SIN POSTURA INFERIBLE: el [CONTENIDO] no da indicios de la postura del autor.
IMPORTANTE: un mismo texto puede tener sent_subtopic negativo y posicion positiva (y viceversa).
La ironía y el sarcasmo invierten la postura respecto al sentimiento superficial.


REGLAS CRÍTICAS:
- Criticar ALGO RELACIONADO con el tema ≠ estar en contra del tema.
  Ej: "el servicio falla mucho" → el autor probablemente usa el servicio → posicion=0 o posicion=2.
- La ironía invierte la postura: "Claro, qué buena idea destruir el río" → posicion=-1.
- Si el [TIPO] es COMENTARIO, la postura es del COMENTARISTA, no del autor del [POST RAÍZ].
- Una pregunta retórica puede revelar postura: "¿Y esto quién lo paga?" → posicion=-1.
- En caso de duda entre 0 y 2 → usa 0.

=== PASO 3 — SUBTOPIC ===
{topic_block}

=== PASO 4 — IDIOMA Y GEOLOCALIZACIÓN ===
Detección libre basada en evidencias del [CONTENIDO] o del contexto auxiliar:
- idioma: código/s ISO 639-1 del idioma del [CONTENIDO] (ej: ["es"], ["ca","es"]).
  Base la detección en léxico, morfología y acentos. No el idioma del [POST RAÍZ].
- pais: país AL QUE SE REFIERE el [CONTENIDO] (ej: institución, evento, lugar mencionado).
  El español no implica España. Solo incluye país si hay evidencia explícita o muy clara. 
  Si no se puede inferir país a partir del [CONTENIDO], se puede utilizar el contexto auxiliar para inferirlo, pero no asumas país por el idioma.
- continente: infiere de las menciones de país/ciudad/evento.
- region: comunidad, estado o provincia si se menciona explícitamente, o se puede inferir a partir del [CONTENIDO] o en útlima instancia del contexto auxiliar. 
- ciudad: ciudad si se menciona explícitamente, o se puede inferir a partir del [CONTENIDO] o en útlima instancia del contexto auxiliar. 
Si no hay evidencia clara → usa ['N/A'] para listas, "" para strings.

=== PASO 5 — PILARES DE ACEPTACIÓN SOCIAL ===
Evalúa cada pilar SOLO si el [CONTENIDO] lo menciona o lo implica claramente. Si el [CONTENIDO] muestra acuerdo o desacuerdo con el pilar del contexto auxiliar, clasifícalo.
Si no hay referencia → 2 (no aplica). No imputes donde no hay evidencia.
Los pilares son INDEPENDIENTES: un mismo [CONTENIDO] puede activar varios.

LEGITIMACIÓN (legitimacion):
¿Evalúa el [CONTENIDO] si el tema es legal, legítimo, conforme a normas o principios?
  1 → Lo considera legítimo/legal/válido.
 -1 → Lo considera ilegítimo/ilegal/contrario a normas.
  0 → Menciona legitimidad pero sin postura clara.
  2 → Sin referencia a legitimidad.
Señal: "es ilegal", "no tiene base legal", "es válido", "va contra la ley".

EFECTIVIDAD (efectividad):
¿Evalúa el [CONTENIDO] si el tema funciona o tendrá resultados reales?
  1 → Cree que es eficaz, útil, tendrá buen impacto.
 -1 → Cree que es ineficaz, inútil, no cambiará nada o empeorará.
  0 → Menciona eficacia pero sin postura clara.
  2 → Sin referencia a resultados o utilidad.
Señal: "no sirve para nada", "va a mejorar", "es un fracaso", "funcionará".

JUSTICIA Y EQUIDAD (justicia_eq):
¿Evalúa el [CONTENIDO] si el tema es justo para las personas afectadas?
  1 → Lo considera justo, equitativo, beneficioso para quien debe.
 -1 → Lo considera injusto, desigual, perjudicial para ciertos grupos.
  0 → Menciona justicia/equidad pero sin postura clara.
  2 → Sin referencia al impacto en personas.
Señal: "es injusto", "siempre pagan los mismos", "beneficia a todos", "discrimina".

CONFIANZA INSTITUCIONAL (confianza):
¿Evalúa el [CONTENIDO] a los actores responsables (gobierno, instituciones, políticos)?
  1 → Confía: los considera competentes, honestos, bien intencionados.
 -1 → Desconfía: incompetencia, corrupción, intereses ocultos, mala gestión.
  0 → Menciona actores pero sin valoración clara.
  2 → Sin referencia a responsables.
Señal: "solo quieren recaudar", "son incompetentes", "lo están haciendo bien".

DESAMBIGUACIÓN:
- "es ilegal" → legitimacion.
- "no funciona" → efectividad.
- "es injusto" → justicia_eq.
- "son corruptos" → confianza.
- Un texto puede activar varios pilares a la vez.
"""