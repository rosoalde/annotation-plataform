"""
Define el tool schema para function calling (analyze_post).
Se definen la constante ANALYZE_POST_TOOL que utils.py y call_model() usan.
"""

ANALYZE_POST_TOOL = {
    "type": "function",
    "function": {
        "name": "analyze_post",
        "description": (
            "Analiza un contenido de redes sociales en relación con un tema dado. "
            "Extrae: pertinencia, subtopic específico, sentimiento hacia el subtopic, "
            "postura (stance) hacia el tema principal, idioma, geolocalización inferida, "
            "y cuatro pilares de legitimación política. "
            "Devuelve SIEMPRE un único objeto JSON con todas las propiedades del schema."
        ),
        "parameters": {
            "type": "object",
            "required": [
                "pertinente",
                "sent_subtopic", 
                "subtopic",
                "posicion",
                "idioma", 
                "continente", 
                "pais", 
                "region", 
                "ciudad",
                "legitimacion", 
                "efectividad", 
                "justicia_eq", 
                "confianza",
                "sent_subtopic_just", 
                "subtopic_just", 
                "posicion_just",
                "idioma_just", 
                "continente_just", 
                "pais_just",
                "region_just", 
                "ciudad_just",
                "legitimacion_just", 
                "efectividad_just",
                "justicia_eq_just", 
                "confianza_just",
            ],
            "properties": {

                # ── Pertinencia ────────────────────────────────────────────────
                "pertinente": {
                    "type": "boolean",
                    "description": (
                        "true si el contenido cuando tiene que ver con el tema principal de estudio o cuando pertenece o se corresponde con el tema principal de estudio. "
                        "false si el contenido se desvía del tema principal y no aporta información útil para comprenderlo, resolverlo o evaluarlo (spam, off-topic, contenido borrado)."
                    ),
                },

                # ── Subtopic ──────────────────────────────────────────────────
                "subtopic": {
                    "type": "string",
                    "description": (
                        "Subtopic específico mencionado en el contenido, en castellano, "
                        "en 2-5 palabras (ej: 'precio del alquiler', 'contaminación del río'). "
                        "No repitas el tema principal; extrae el aspecto concreto que aborda el texto. "
                        "Si el contenido no es pertinente, devuelve cadena vacía."
                    ),
                },
                "subtopic_just": {
                    "type": "string",
                    "description": "Justificación breve (≤150 chars) de por qué ese subtopic.",
                },

                # ── Sentimiento hacia el subtopic ─────────────────────────────────
                "sent_subtopic": {
                    "type": "integer",
                    "enum": [-1, 0, 1],
                    "description": (
                        "Polaridad emocional del texto respecto al subtopic (NO respecto al tema principal). "
                        "1 = positivo/favorable, 0 = neutro/mixto/ambiguo, -1 = negativo/desfavorable. "
                        "NOTA: el sentimiento puede diferir de la postura. "
                        "Ej: 'Me alegra que hayan rechazado esa medida' → sent_topic=1 (alegría) pero posicion=-1 (contra la medida)."
                    ),
                },
                "sent_subtopic_just": {
                    "type": "string",
                    "description": "Justificación breve (≤150 chars) del sentimiento detectado.",
                },

                # ── Postura / Stance ───────────────────────────────────────────
                "posicion": {
                    "type": "integer",
                    "enum": [-1, 0, 1, 2],
                    "description": (
                        "Postura (stance) del autor hacia el TEMA PRINCIPAL (no hacia el subtopic). "
                        "La postura no tiene que coincidir con el sentimiento. "
                        "Escala: "
                        "1 = A FAVOR / PRO (apoya, defiende, respalda el tema; p.ej. apoya la medida, le gusta el producto). "
                        "-1 = EN CONTRA / ANTI (critica, rechaza, se opone). "
                        "0 = NEUTRO / MIXTO (reconoce pros y contras, pregunta informativa, sin posicionamiento claro). "
                        "2 = SIN POSTURA INFERIBLE (el contenido no da pistas suficientes sobre la postura del autor). "
                        "CRITERIO CLAVE: una pregunta retórica puede implicar postura; una pregunta de información pura = 0. "
                        "Ironía y sarcasmo invierten la postura respecto al sentimiento superficial."
                    ),
                },
                "posicion_just": {
                    "type": "string",
                    "description": (
                        "Justificación breve (≤150 chars). "
                        "Indica qué frase o inferencia concreta revela la postura. "
                        "Si hay ironía, señálalo explícitamente."
                    ),
                },

                # ── Idioma ─────────────────────────────────────────────────────
                "idioma": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Lista de códigos ISO 639-1 (2 letras, minúsculas) del/los idioma/s detectado/s. "
                        "Ej: ['es'], ['es','ca'], ['en']. "
                        "Basa la detección en el léxico, morfología y acentos del texto, no en el país. "
                        "Si no puedes determinar con confianza: ['N/A']."
                    ),
                },
                "idioma_just": {
                    "type": "string",
                    "description": "Justificación breve (≤150 chars): qué rasgo del texto revela el idioma.",
                },

                # ── Geolocalización ────────────────────────────────────────────
                "continente": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Lista de códigos de continente inferidos del texto, la fuente o el idioma: "
                        "{EU, NA, SA, AF, AS, OC}. "
                        "Infiere solo si hay evidencia explícita o muy fuerte (menciones de país/ciudad/evento geolocalizado). "
                        "Si no hay evidencia: ['N/A']."
                    ),
                },
                "continente_just": {
                    "type": "string",
                    "description": "Qué evidencia concreta del texto justifica el continente inferido (≤150 chars).",
                },
                "pais": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Lista de códigos ISO 3166-1 alpha-2 (2 letras, mayúsculas) del/los país/es "
                        "a los que se refiere el contenido o donde ocurre la conversación. "
                        "Usa 'ES' para España, 'MX' para México, etc. "
                        "Solo incluye un país si el texto lo menciona explícitamente o lo deja muy claro. "
                        "Si no hay evidencia: ['N/A']."
                    ),
                },
                "pais_just": {
                    "type": "string",
                    "description": "Qué evidencia del texto justifica el país (≤150 chars).",
                },
                "region": {
                    "type": "string",
                    "description": (
                        "Comunidad autónoma, estado, provincia o región mencionada explícitamente. "
                        "Cadena vacía si no consta."
                    ),
                },
                "region_just": {
                    "type": "string",
                    "description": "Justificación breve de la región (≤100 chars). Vacío si no aplica.",
                },
                "ciudad": {
                    "type": "string",
                    "description": (
                        "Ciudad mencionada explícitamente en el texto. "
                        "Cadena vacía si no consta."
                    ),
                },
                "ciudad_just": {
                    "type": "string",
                    "description": "Justificación breve de la ciudad (≤100 chars). Vacío si no aplica.",
                },

                # ── Pilares de aceptación política ────────────────────────────
                "legitimacion": {
                    "type": "integer",
                    "enum": [-1, 0, 1, 2],
                    "description": (
                        "¿El texto expresa que el tema/medida es legal, legítimo o tiene respaldo normativo/democrático? "
                        "1 = sí, lo considera legítimo. -1 = lo cuestiona o lo considera ilegítimo. "
                        "0 = postura mixta o ambigua. 2 = no aplica / no hay referencia a legitimidad."
                    ),
                },
                "legitimacion_just": {
                    "type": "string",
                    "description": "Qué frase o argumento revela la postura de legitimación (≤150 chars).",
                },
                "efectividad": {
                    "type": "integer",
                    "enum": [-1, 0, 1, 2],
                    "description": (
                        "¿El texto expresa opinión sobre si el tema/medida funcionará o tendrá resultados reales? "
                        "1 = cree que será eficaz. -1 = duda o niega su eficacia. "
                        "0 = postura mixta. 2 = no hay referencia a eficacia."
                    ),
                },
                "efectividad_just": {
                    "type": "string",
                    "description": "Qué frase o argumento revela la postura de efectividad (≤150 chars).",
                },
                "justicia_eq": {
                    "type": "integer",
                    "enum": [-1, 0, 1, 2],
                    "description": (
                        "¿El texto expresa que el tema/medida es justo, equitativo, o beneficia a quien debe? "
                        "1 = lo considera justo o equitativo. -1 = lo considera injusto o discriminatorio. "
                        "0 = postura mixta. 2 = no hay referencia a justicia/equidad."
                    ),
                },
                "justicia_eq_just": {
                    "type": "string",
                    "description": "Qué frase o argumento revela la postura de justicia/equidad (≤150 chars).",
                },
                "confianza": {
                    "type": "integer",
                    "enum": [-1, 0, 1, 2],
                    "description": (
                        "¿El texto expresa confianza (o desconfianza) en las instituciones o actores responsables del tema? "
                        "1 = confía en las instituciones/responsables. -1 = desconfía, los critica. "
                        "0 = postura mixta. 2 = no hay referencia a confianza institucional."
                    ),
                },
                "confianza_just": {
                    "type": "string",
                    "description": "Qué frase o argumento revela la postura de confianza institucional (≤150 chars).",
                },

                # ── Razonamiento interno del modelo (opcional) ─────────────────
                "model_reasoning": {
                    "type": "string",
                    "description": (
                        "OPCIONAL. Resumen muy breve (≤300 chars) del razonamiento interno del modelo. "
                        "Útil para auditoría. No es necesario si el sistema emite 'reasoning' estructurado."
                    ),
                },
            },
        },
    },
}