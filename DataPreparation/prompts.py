def build_system_prompt() -> str:
    return (
        "Eres un analista experto de social listening para análisis de opinión pública. "
        "Tu tarea es clasificar posts de redes sociales respecto a un tema dado. "
        "Razona internamente sobre cada campo antes de decidir su valor. "
        "Devuelve ÚNICAMENTE una tool call válida con argumentos que respeten el schema JSON. "
        "No escribas texto libre fuera de la herramienta. "
        "Si pertinente es false, completa el resto de campos con valores neutros "
        "(2 para pilares enteros, cadena vacía para texto)."
    )


def build_user_prompt(tema: str, desc_tema: str, contenido: str) -> str:
    return f"""--- TEMA ---
{tema}

--- DESCRIPCIÓN DEL TEMA ---
{desc_tema}

--- CONTENIDO A ANALIZAR ---
{contenido}

--- INSTRUCCIONES ---
1. Decide si el contenido es pertinente para el TEMA descrito arriba.
2. Si no es pertinente → pertinente=false y completa el resto con defaults neutros.
3. Si es pertinente → rellena todos los campos con precisión.
4. 'topic' debe estar en castellano y ser específico al subtema del contenido.
5. 'idioma' → lista de códigos ISO 639-1 de 2 letras (ej. ["es", "ca"]).
6. 'pais'   → lista de códigos ISO 3166-1 alpha-2 (ej. ["ES", "FR"]).
7. 'continente' → lista de códigos breves: EU, NA, SA, AF, AS, OC.
8. 'region' y 'ciudad' → cadenas de texto o cadena vacía si no consta.
"""