# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm AS build
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libc6-dev swig \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY device/requirements.txt ./
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

FROM python:3.12-slim-bookworm AS runtime
# mDNS is resolved by the host's Avahi daemon through its mounted Unix socket.
# alsa-utils provides arecord for the INMP441 I2S microphone.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libnss-mdns libfreetype6 alsa-utils \
    && rm -rf /var/lib/apt/lists/* \
    && sed -i 's/^hosts:.*/hosts: files mdns4_minimal [NOTFOUND=return] dns/' /etc/nsswitch.conf \
    && mkdir -p /var/lib/mining-device
COPY --from=build /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH=/app \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    GPIOZERO_PIN_FACTORY=lgpio
COPY device/src/ /app/src/
# lgpio creates its notification pipe in the current directory.
WORKDIR /tmp
ENTRYPOINT ["python", "-m", "src.main"]
CMD ["--config", "/etc/mining-device/settings.json"]
