# Docker cloud board: desk API in cloud-only mode + board agent.
# Real shell / files / health inside the container; chat via Nebius (spends credits).
# No CUDA, no Ollama, no Auto/Local.
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    BOARD_NAME=Natasha \
    BOARD_EMU=1 \
    LLM_MODE=cloud_only \
    HOME=/home/jetson \
    DATABASE_URL=sqlite:////home/jetson/data/nebiusdesk.db

RUN useradd -m -u 1000 -s /bin/bash jetson \
 && apt-get update \
 && apt-get install -y --no-install-recommends bash ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt

COPY api/requirements.txt /opt/api/requirements.txt
COPY board-agent/requirements.txt /opt/agent/requirements.txt
RUN pip install --no-cache-dir -r /opt/api/requirements.txt -r /opt/agent/requirements.txt

COPY api/app /opt/api/app
COPY board-agent/desk_agent.py /opt/agent/desk_agent.py
COPY board-emu/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh \
 && mkdir -p /home/jetson/.config/nebius-desk /home/jetson/data \
 && printf '%s\n' \
      '# Cloud board workspace' \
      '' \
      'This is a Docker board enrolled in Nebius Desk.' \
      'Terminal and Files map to /home/jetson. Chat is cloud-only (no local model).' \
      > /home/jetson/README.md \
 && chown -R jetson:jetson /home/jetson /opt

USER jetson
WORKDIR /home/jetson

VOLUME ["/home/jetson/.config/nebius-desk", "/home/jetson/data"]

ENTRYPOINT ["/entrypoint.sh"]
CMD ["run"]
