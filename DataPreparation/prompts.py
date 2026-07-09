# DataPreparation/prompts.py (modificar build_system_prompt y build_user_prompt)

def build_system_prompt() -> str:
    return (
        "Eres un analista experto de social listening para análisis de opinión pública. "
        "Tu tarea es clasificar posts de redes sociales respecto a un tema dado. "
        "Razona internamente sobre cada campo antes de decidir su valor. "
        "Devuelve ÚNICAMENTE una tool call válida con argumentos que respeten el schema JSON. "
        "No escribas texto libre fuera de la herramienta. "
        "Detecta idioma y país automáticamente a partir del contenido cuando sea posible y devuelve códigos ISO (idioma: ISO 639-1 de 2 letras; país: ISO 3166-1 alpha-2). "
        "Si NO puedes identificar idioma o país con confianza, coloca el valor exacto \"N/A\" en las listas correspondientes. "
        "Si pertinente es false, completa el resto de campos con valores neutros (2 para pilares enteros, cadena vacía para texto)."
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
5. 'idioma' → lista de códigos ISO 639-1 de 2 letras (ej. ["es", "ca"]) detectados automáticamente; si no sabes con confianza, devuelve ["N/A"].
6. 'pais'   → lista de códigos ISO 3166-1 alpha-2 (ej. ["ES","FR"]) detectados automáticamente; si no sabes con confianza, devuelve ["N/A"].
7. 'continente' → lista de códigos breves: EU, NA, SA, AF, AS, OC (determínalo a partir de 'pais' si es posible); si no, ["N/A"].
8. 'region' y 'ciudad' → cadenas de texto o cadena vacía si no consta.
9. Devuelve SOLO una llamada a la función `analyze_post` con un único objeto JSON que respete el schema provisto por la herramienta.
"""