# One service: FastAPI serves the API and the static frontend. CPU only.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/opt/hf \
    OMP_NUM_THREADS=4 \
    MPLBACKEND=Agg

RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /srv

# 1) CPU-only torch first, so nothing can pull the multi-GB CUDA build.
RUN pip install --index-url https://download.pytorch.org/whl/cpu "torch>=2.2,<3"

# 2) App dependencies.
COPY requirements.txt .
RUN pip install -r requirements.txt

# 3) TimesFM 2.5 lives in the timesfm 2.x package (TimesFM_2p5_200M_torch, ForecastConfig, forecast_with_covariates).
#    --no-deps keeps the CPU torch from step 1. jax, jaxlib and scikit-learn power covariates (XReg) on CPU.
RUN pip install --no-deps "timesfm==2.0.2" \
 && pip install "huggingface_hub>=0.23" "safetensors>=0.5.3" scikit-learn jax jaxlib

# 4) Pre-download the TimesFM 2.5 checkpoint (about 0.9 GB) so cold starts do not re-download it.
#    With a Railway volume instead: mount it at /data, set HF_HOME=/data/hf and build with --build-arg PREFETCH_MODEL=0.
ARG PREFETCH_MODEL=1
RUN if [ "$PREFETCH_MODEL" = "1" ]; then \
      python -c "from huggingface_hub import hf_hub_download as d; [print(d('google/timesfm-2.5-200m-pytorch', f)) for f in ('config.json', 'model.safetensors')]" \
      || echo "WARNING: checkpoint prefetch failed; it will be downloaded on first start"; \
    fi

COPY app ./app

RUN useradd --create-home --uid 10001 appuser && mkdir -p /data /opt/hf && chown -R appuser /srv /opt/hf /data
USER appuser

ENV PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD python -c "import os,urllib.request as u; u.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT','8000'), timeout=4)"

# One worker: the model lives in memory once. Give the service 3 GB or more (4 GB is comfortable).
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --proxy-headers --forwarded-allow-ips='*'"]
