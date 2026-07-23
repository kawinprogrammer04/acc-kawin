from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.routers import accounts, auth, invoices, journals, reports, pdf_reports, cashflow, companies


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: could run DB migrations here
    yield
    # Shutdown


app = FastAPI(
    title="Thai SME Accounting API",
    description="ระบบบัญชี สำหรับ SME ไทย — Double-Entry, VAT 7%, WHT",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],  # Add prod origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "เกิดข้อผิดพลาดภายในระบบ กรุณาติดต่อผู้ดูแลระบบ"},
    )


# Routers
PREFIX = "/api"
app.include_router(auth.router,     prefix=PREFIX)
app.include_router(accounts.router, prefix=PREFIX)
app.include_router(journals.router, prefix=PREFIX)
app.include_router(invoices.router, prefix=PREFIX)
app.include_router(reports.router,      prefix=PREFIX)
app.include_router(pdf_reports.router,  prefix=PREFIX)
app.include_router(cashflow.router,     prefix=PREFIX)
app.include_router(companies.router,    prefix=PREFIX)


@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "company": settings.COMPANY_NAME,
        "vat_rate": f"{settings.VAT_RATE}%",
    }
