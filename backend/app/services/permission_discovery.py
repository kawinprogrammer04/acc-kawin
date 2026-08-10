import re
from dataclasses import dataclass
from urllib.parse import urlparse

from fastapi import FastAPI
from fastapi.routing import APIRoute

from app.models.permission import AppMenu


ACTION_LABELS: dict[str, str] = {
    "view": "ดูข้อมูล",
    "create": "เพิ่มข้อมูล",
    "update": "แก้ไขข้อมูล",
    "delete": "ลบข้อมูล",
    "approve": "อนุมัติ",
    "export": "Export",
    "export_pdf": "Export PDF",
    "export_xlsx": "Export Excel",
    "export_csv": "Export CSV",
    "download": "ดาวน์โหลด",
    "import": "Import",
    "lookup": "ค้นหา",
    "pay": "จ่ายเงิน",
    "receive": "รับเงิน",
    "post": "Post",
    "void": "Void",
    "cancel": "ยกเลิก",
    "upload": "Upload",
    "preview": "Preview",
    "sync": "Sync",
    "reorder": "เรียงลำดับ",
}

CUSTOM_ACTION_SEGMENTS = {
    "approve",
    "cancel",
    "download",
    "import",
    "lookup",
    "pay",
    "post",
    "receive",
    "reorder",
    "sync",
    "upload",
    "void",
}

ROUTE_MENU_ALIASES = {
    "cashflow-categories": "categories",
    "cashflow-dashboard": "dashboard",
    "cashflow-report": "cashflow_reports",
    "payment-schedule": "schedule",
    "wallet-accounts": "wallet_accounts",
}

IGNORED_PREFIXES = (
    "/api/auth/login",
    "/api/auth/me",
    "/api/health",
    "/api/openapi.json",
    "/api/docs",
    "/api/redoc",
)


@dataclass(frozen=True)
class DiscoveredPermission:
    method: str
    path: str
    name: str | None
    permission_key: str
    action_key: str
    action_label: str
    menu_id: int | None
    menu_key: str | None
    menu_label: str | None


def _clean_path(path: str | None) -> str:
    if not path:
        return ""
    return urlparse(path).path.rstrip("/") or "/"


def _slug(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9{}]+", "_", value.strip("/").lower())
    cleaned = cleaned.replace("{", "").replace("}", "")
    return re.sub(r"_+", "_", cleaned).strip("_") or "root"


def _path_segments(path: str) -> list[str]:
    return [segment for segment in path.strip("/").split("/") if segment]


def _infer_action(method: str, path: str) -> str:
    segments = _path_segments(path)
    static_segments = [segment.lower() for segment in segments if not segment.startswith("{")]
    last_segment = static_segments[-1] if static_segments else ""

    if last_segment in {"export.pdf", "pdf"} or last_segment.endswith(".pdf"):
        return "export_pdf"
    if last_segment in {"export.xlsx", "xlsx"} or last_segment.endswith(".xlsx"):
        return "export_xlsx"
    if last_segment in {"export.csv", "csv"} or last_segment.endswith(".csv"):
        return "export_csv"
    if "download" in static_segments:
        return "download"
    if "export" in static_segments:
        return "export"
    if "preview.png" in static_segments or "preview" in static_segments:
        return "preview"
    if last_segment in CUSTOM_ACTION_SEGMENTS:
        return last_segment

    if method == "GET":
        return "view"
    if method == "POST":
        return "create"
    if method in {"PATCH", "PUT"}:
        return "update"
    if method == "DELETE":
        return "delete"
    return method.lower()


def _menu_match_score(route_path: str, menu: AppMenu) -> int:
    menu_path = _clean_path(menu.path)
    if not menu_path or menu_path == "/":
        return 1 if route_path in {"/api", "/api/"} else 0

    api_menu_path = f"/api{menu_path}" if not menu_path.startswith("/api") else menu_path
    if route_path == api_menu_path or route_path.startswith(f"{api_menu_path}/"):
        return len(api_menu_path)

    first_segment = _path_segments(route_path.removeprefix("/api"))[:1]
    if first_segment and ROUTE_MENU_ALIASES.get(first_segment[0]) == menu.key:
        return 80
    return 0


def _find_menu(route_path: str, menus: list[AppMenu]) -> AppMenu | None:
    scored = [(menu, _menu_match_score(route_path, menu)) for menu in menus]
    scored = [(menu, score) for menu, score in scored if score > 0]
    if not scored:
        return None
    return max(scored, key=lambda item: item[1])[0]


def _normalise_api_path(raw_path: str) -> str:
    cleaned = (raw_path.rstrip("/") or "/")
    return cleaned if cleaned.startswith("/api") else f"/api{cleaned}"


def _should_skip_path(path: str) -> bool:
    return any(path.startswith(prefix) for prefix in IGNORED_PREFIXES)


def _add_discovered_route(
    discovered: dict[str, DiscoveredPermission],
    menus: list[AppMenu],
    method: str,
    path: str,
    name: str | None,
) -> None:
    path = _normalise_api_path(path)
    if _should_skip_path(path):
        return

    method = method.upper()
    if method in {"HEAD", "OPTIONS"}:
        return

    action_key = _infer_action(method, path)
    menu = _find_menu(path, menus)
    if menu:
        permission_key = f"{menu.key}.{action_key}"
    else:
        permission_key = f"unmapped.{method.lower()}.{_slug(path.removeprefix('/api'))}"

    if permission_key in discovered:
        return

    discovered[permission_key] = DiscoveredPermission(
        method=method,
        path=path,
        name=name,
        permission_key=permission_key,
        action_key=action_key,
        action_label=ACTION_LABELS.get(action_key, action_key.replace("_", " ").title()),
        menu_id=menu.id if menu else None,
        menu_key=menu.key if menu else None,
        menu_label=menu.label if menu else None,
    )


def discover_permission_routes(app: FastAPI, menus: list[AppMenu]) -> list[DiscoveredPermission]:
    discovered: dict[str, DiscoveredPermission] = {}

    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        for method in sorted(route.methods or set()):
            _add_discovered_route(discovered, menus, method, route.path, route.name)

    # Some deployments expose a fuller route map through OpenAPI than through
    # request.app.routes. Merge it as a fallback so the Permission UI still has
    # a catalog source after proxy/prefix differences.
    try:
        openapi_schema = app.openapi()
    except Exception:
        openapi_schema = {}
    for path, path_item in (openapi_schema.get("paths") or {}).items():
        if not isinstance(path_item, dict):
            continue
        for method, operation in path_item.items():
            if method.upper() not in {"GET", "POST", "PATCH", "PUT", "DELETE"}:
                continue
            name = operation.get("operationId") if isinstance(operation, dict) else None
            _add_discovered_route(discovered, menus, method, path, name)

    return sorted(discovered.values(), key=lambda item: (item.menu_key or "zz_unmapped", item.action_key, item.path))
