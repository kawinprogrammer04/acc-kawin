from contextlib import asynccontextmanager
import logging
import uuid

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.routers import accounts, auth, invoices, journals, reports, pdf_reports, cashflow, companies, tax_invoices, permissions, bank_reconciliation, approvals, crm_cashflow, expense_finance, hr_sync, integrations

logger = logging.getLogger("app.errors")


@asynccontextmanager
async def lifespan(app: FastAPI):
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


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-Id"] = request_id
    return response


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    request_id = getattr(request.state, "request_id", str(uuid.uuid4()))
    logger.exception(
        "Unhandled API error request_id=%s method=%s path=%s",
        request_id,
        request.method,
        request.url.path,
        exc_info=exc,
    )
    content = {
        "detail": "เกิดข้อผิดพลาด",
        "request_id": request_id,
    }
    if settings.DEBUG:
        content.update({
            "debug": str(exc),
            "error_type": type(exc).__name__,
        })
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=content,
        headers={"X-Request-Id": request_id},
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
app.include_router(tax_invoices.router, prefix=PREFIX)
app.include_router(permissions.router,  prefix=PREFIX)
app.include_router(bank_reconciliation.router, prefix=PREFIX)
app.include_router(expense_finance.router, prefix=PREFIX)
app.include_router(approvals.router, prefix=PREFIX)
app.include_router(crm_cashflow.router, prefix=PREFIX)
app.include_router(hr_sync.router, prefix=PREFIX)
app.include_router(integrations.router, prefix=PREFIX)


@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "company": settings.COMPANY_NAME,
        "vat_rate": f"{settings.VAT_RATE}%",
    }
