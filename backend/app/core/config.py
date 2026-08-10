from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_ENV: str = "local"
    DATABASE_URL: str | None = None
    MIGRATION_DATABASE_URL: str | None = None
    DATABASE_HOST: str = "db"
    POSTGRES_DB: str = "accounting_db"
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str | None = None
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    COMPANY_NAME: str = "บริษัท ของคุณ จำกัด"
    COMPANY_TAX_ID: str = ""

    VAT_RATE: float = 7.0
    DEBUG: bool = False

    # crm-kawin integration. Leave CRM_KAWIN_BASE_URL blank while developing
    # locally to use the clearly-labelled mock response.
    CRM_KAWIN_BASE_URL: str | None = None
    CRM_KAWIN_ORDERS_PATH: str = "/api/accounting/get_list_order.php"
    CRM_KAWIN_API_KEY: str | None = None
    CRM_KAWIN_TIMEOUT_SECONDS: float = 15.0

    # Internal PHP/Dompdf service used for tax-invoice preview and PDF export.
    DOMPDF_RENDERER_URL: str = "http://tax_invoice_renderer:8090"
    DOMPDF_TIMEOUT_SECONDS: float = 30.0

    # Draft expense-request documents and supporting files.
    EXPENSE_REQUEST_UPLOAD_DIR: str = "/app/uploads/expense_requests"

    # CRM cashflow statement attachments (images / PDF).
    CRM_CASHFLOW_UPLOAD_DIR: str = "/app/uploads/crm_cashflow"

    # Local OCR for receipts/tax invoices via a self-hosted Ollama vision model —
    # no per-request cost. Ollama must run natively on the host (not in a
    # container) so it can use the Mac's GPU; the backend container reaches it
    # through host.docker.internal. See docker-compose.yml for the network setup.
    OLLAMA_URL: str = "http://host.docker.internal:11434"
    OLLAMA_VISION_MODEL: str = "qwen2.5vl:7b"
    OLLAMA_TIMEOUT_SECONDS: float = 120.0

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @model_validator(mode="after")
    def build_and_validate_database_url(self) -> "Settings":
        if not self.DATABASE_URL:
            if not self.POSTGRES_PASSWORD:
                raise ValueError("กำหนด DATABASE_URL หรือ POSTGRES_PASSWORD ก่อนเริ่ม backend")
            self.DATABASE_URL = (
                f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
                f"@{self.DATABASE_HOST}:5432/{self.POSTGRES_DB}"
            )
        if self.APP_ENV == "production" and self.DEBUG:
            raise ValueError("ห้ามเปิด DEBUG=true ใน production")
        if not self.MIGRATION_DATABASE_URL:
            self.MIGRATION_DATABASE_URL = self.DATABASE_URL
        return self


settings = Settings()