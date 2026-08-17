from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    username: str
    role: str


class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    full_name: str | None = None
    role: str = "accountant"
    company_id: int | None = None
    department_id: int | None = None
    position_ids: list[int] = []


class UserUpdate(BaseModel):
    full_name: str | None = None
    role: str | None = None
    is_active: bool | None = None
    password: str | None = None


class UserOut(BaseModel):
    id: int
    username: str
    email: str
    full_name: str | None
    role: str
    is_platform_admin: bool = False
    is_active: bool

    model_config = {"from_attributes": True}


class RoleCreate(BaseModel):
    code: str
    label: str
    level: int
    is_active: bool = True


class RoleUpdate(BaseModel):
    label: str | None = None
    level: int | None = None
    is_active: bool | None = None


class RoleOut(BaseModel):
    id: int
    code: str
    label: str
    level: int
    is_system: bool
    is_active: bool

    model_config = {"from_attributes": True}
