def build_system_prompt():
    return (
        "Eres un analista experto de social listening. "
        "Devuelve SOLO una tool call válida con argumentos que respeten el schema. "
        "No escribas texto libre fuera de la herramienta. "
        "Si pertinente es false, el resto de campos debe seguir siendo válido, con defaults razonables."
    )


def build_user_prompt(tema, desc_tema, population_scope, languages, keywords, contenido, contexto_raiz):
    langs = ", ".join(languages) if languages else "Cualquiera"
    kws = ", ".join(keywords) if keywords else ""

    return f"""
--- TEMA ---
{tema}

--- DESCRIPCIÓN ---
{desc_tema}

--- CONTEXTO ---
Idiomas permitidos: {langs}
Ubicación permitida: {population_scope}
Keywords: {kws}

--- CONTENIDO ---
{contenido}

--- CONTEXTO DEL POST RAÍZ ---
{contexto_raiz}

--- INSTRUCCIONES ---
1. Decide si el contenido es pertinente para el tema.
2. Si no es pertinente, marca pertinente=false y completa el resto.
3. Si es pertinente, rellena todos los campos.
4. 'topic' debe estar en castellano y ser específico.
5. 'idioma' debe proponerse como códigos ISO 639-1 de 2 letras.
6. 'pais' debe proponerse como nombres o códigos ISO 3166-1 alpha-2.
7. 'continente' puede proponerse como nombre de continente o código breve.
8. 'region' y 'ciudad' deben ser cadenas.
"""