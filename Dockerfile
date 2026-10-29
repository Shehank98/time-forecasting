# Single service: FastAPI serves the API and the static frontend. CPU only.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/opt/hf \
    OMP_NUM_THREADS=4 \
    MPLBACKEND=Agg

RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /srv

# 1) CPU-only torch FIRST, so installing timesfm can never pull the multi-GB CUDA build.
RUN pip install --index-url https://download.pytorch.org/whl/cpu "torch>=2.2,<3"

# 2) App dependencies.
COPY requirements.txt .
RUN pip install -r requirements.txt

# 3) TimesFM 2.0 API (TimesFm / TimesFmHparams / forecast_with_covariates) lives in timesfm 1.3.0.
#    --no-deps avoids its "torch[cuda]" requirement; the runtime dependencies are listed explicitly.
#    jax + jaxlib (CPU) are only needed for forecast_with_covariates (XReg).
RUN pip install --no-deps "timesfm==1.3.0" \
 && pip install absl-py einshape "huggingface_hub>=0.23" scikit-learn utilsforecast tqdm jax jaxlib

# 4) Pre-download the ~2 GB checkpoint so cold starts do not re-download it.
#    If you prefer a Railway volume: mount it at /data, set HF_HOME=/data/hf and build with --build-arg PREFETCH_MODEL=0.
ARG PREFETCH_MODEL=1
RUN if [ "$PREFETCH_MODEL" = "1" ]; then \
      python -c "from huggingface_hub import snapshot_download; print(snapshot_download('google/timesfm-2.0-500m-pytorch'))" \
      || echo "WARNING: checkpoint prefetch failed; it will be downloaded on first start"; \
    fi

COPY app ./app

RUN useradd --create-home --uid 10001 appuser && mkdir -p /data && chown -R appuser /srv /opt/hf /data
USER appuser

ENV PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD python -c "import os,urllib.request as u; u.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT','8000'), timeout=4)"

# One worker only: the model lives in memory once. Recommended memory: 4 GB or more.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
