FROM python:3.12-slim

WORKDIR /app

ENV HF_HOME=/data/models

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the embedding model into the image so startup is fast.
# The model is baked into the layer; HF_HOME is overridden at runtime to
# /data/models (PVC) so the cache persists across image updates too.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

COPY main.py telemetry.py ./

EXPOSE 8084
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8084"]
