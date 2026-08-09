# syntax=docker/dockerfile:1

FROM python:3.12-slim AS builder
WORKDIR /build
COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

FROM python:3.12-slim AS runtime
RUN useradd --create-home --uid 1000 --shell /usr/sbin/nologin appuser
WORKDIR /app
COPY --from=builder /root/.local /home/appuser/.local
COPY app ./app
RUN chown -R appuser:appuser /app
USER appuser
ENV PATH=/home/appuser/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
