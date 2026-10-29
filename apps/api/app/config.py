from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Nebius Desk"
    llm_mode: str = "hybrid"  # hybrid | cloud_only | local_only
    # Docker board-emu: chat via Nebius only (nano/lightning/super). No local, no auto-route.
    # Shell/files/jobs/browser still run inside the container.
    board_emu: bool = False

    jwt_secret: str = "change-me-to-a-long-random-string"
    jwt_expire_minutes: int = 60
    jwt_algorithm: str = "HS256"

    bootstrap_username: str = "admin"
    bootstrap_password: str = "changeme"
    # False for now — enable later for authenticator / email 2FA
    auth_require_totp: bool = False

    nebius_api_key: str = "sk-nebius-dummy-do-not-use"
    nebius_base_url: str = "https://api.tokenfactory.nebius.com/v1"
    nebius_model_fast: str = "nvidia/Nemotron-3_5-Lightning"
    nebius_model_balanced: str = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"
    nebius_model_heavy: str = "nvidia/nemotron-3-super-120b-a12b"
    nebius_model_ultra: str = "nvidia/Nemotron-3-Ultra-550b-a55b"
    nebius_daily_budget_usd: float = 2.0

    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen2.5:1.5b"
    ollama_context_tokens: int = 4096
    local_history_messages: int = 6
    selector_timeout_s: float = 6.0

    # Histories above this (estimated tokens) get their older turns summarized on the Jetson
    compress_after_tokens: int = 3000
    cloud_recent_messages: int = 6

    tavily_api_key: str = ""
    tavily_credit_cap: int = 1500
    # Paired boards send Nebius and Tavily through the central gateway.
    desk_cloud_url: str = ""
    # board-emu compose sets CLOUD_URL; same cloud the pair/start call hits.
    cloud_url: str = ""
    desk_device_token: str = ""
    desk_relay_secret: str = ""
    # Remote files and the CLI start here. Empty means the account home on the Jetson.
    desk_fs_root: str = ""

    cors_origins: str = (
        "http://localhost:3000,http://localhost:8081,http://127.0.0.1:3000,"
        "https://nebius-desk.vercel.app"
    )
    database_url: str = "sqlite:///./data/nebiusdesk.db"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def cors_origin_regex(self) -> str:
        # Desk on localhost (any port) must probe the Docker/USB board.
        return (
            r"https?://(localhost|127\.0\.0\.1)(:\d+)?"
            r"|https://nebius-desk(\.vercel\.app|-[a-z0-9-]+\.vercel\.app)"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
