FROM python:3.11-slim

WORKDIR /app

# Instala dependencias del backend
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copia todo el proyecto (para que main.py vea backend/ y frontend/)
COPY . .

ENV PYTHONPATH=/app