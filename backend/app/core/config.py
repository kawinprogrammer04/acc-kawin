from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    COMPANY_NAME: str = "บริษัท ของคุณ จำกัด"
    COMPANY_TAX_ID: str = ""

    VAT_RATE: float = 7.0

    class Config:
        env_file = ".env"


settings = Settings()
