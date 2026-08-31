from datetime import datetime

from pydantic import BaseModel, Field


class HrApprovalCompanySummary(BaseModel):
    company_id: int
    company_code: str
    company_name: str
    pending_approval_count: int = Field(ge=0)


class HrApprovalAction(BaseModel):
    sso_url: str
    next: str


class HrApprovalSummary(BaseModel):
    pending_approval_count: int = Field(ge=0)
    companies: list[HrApprovalCompanySummary]
    action: HrApprovalAction
    generated_at: datetime
