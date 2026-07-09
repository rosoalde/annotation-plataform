ANALYZE_POST_TOOL = {
    "type": "function",
    "function": {
        "name": "analyze_post",
        "description": "Analiza un post o comentario con contexto y devuelve etiquetas estructuradas.",
        "parameters": {
            "type": "object",
            "properties": {
                "pertinente": {"type": "boolean"},
                "sent_topic": {"type": "integer", "enum": [-1, 0, 1]},
                "topic": {"type": "string"},
                "posicion": {"type": "integer", "enum": [-1, 0, 1, 2]},
                "idioma": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Proponer códigos ISO 639-1 de 2 letras, por ejemplo es, ca, eu, en, fr"
                },
                "continente": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Proponer nombres o códigos de continente"
                },
                "pais": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Proponer nombres de país o códigos ISO 3166-1 alpha-2"
                },
                "region": {"type": "string"},
                "ciudad": {"type": "string"},
                "legitimacion": {"type": "integer", "enum": [-1, 0, 1, 2]},
                "efectividad": {"type": "integer", "enum": [-1, 0, 1, 2]},
                "justicia_eq": {"type": "integer", "enum": [-1, 0, 1, 2]},
                "confianza": {"type": "integer", "enum": [-1, 0, 1, 2]},
                "sent_topic_just": {"type": "string"},
                "topic_just": {"type": "string"},
                "posicion_just": {"type": "string"},
                "idioma_just": {"type": "string"},
                "continente_just": {"type": "string"},
                "pais_just": {"type": "string"},
                "region_just": {"type": "string"},
                "ciudad_just": {"type": "string"},
                "legitimacion_just": {"type": "string"},
                "efectividad_just": {"type": "string"},
                "justicia_eq_just": {"type": "string"},
                "confianza_just": {"type": "string"}
            },
            "required": [
                "pertinente","sent_topic","topic","posicion","idioma","continente","pais","region","ciudad",
                "legitimacion","efectividad","justicia_eq","confianza",
                "sent_topic_just","topic_just","posicion_just","idioma_just","continente_just","pais_just",
                "region_just","ciudad_just","legitimacion_just","efectividad_just","justicia_eq_just","confianza_just"
            ]
        }
    }
}