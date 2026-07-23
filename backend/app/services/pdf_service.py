"""
WeasyPrint-based PDF renderer.
Loads Jinja2 templates from app/templates/, injects data, returns PDF bytes.
"""
from __future__ import annotations

import io
from dataclasses import asdict
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape
from weasyprint import HTML, CSS
from weasyprint.text.fonts import FontConfiguration

_TEMPLATES_DIR = Path(__file__).parent.parent / "templates"

_jinja_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATES_DIR)),
    autoescape=select_autoescape(["html"]),
    trim_blocks=True,
    lstrip_blocks=True,
)

_font_config = FontConfiguration()

_BASE_CSS = CSS(
    string="""
    @page {
        size: A4;
        margin: 15mm 12mm 15mm 12mm;
    }
    """,
    font_config=_font_config,
)


def _dataclass_to_dict(obj: Any) -> Any:
    """Recursively convert dataclasses (and lists of them) to plain dicts."""
    if hasattr(obj, "__dataclass_fields__"):
        return {k: _dataclass_to_dict(v) for k, v in asdict(obj).items()}
    if isinstance(obj, list):
        return [_dataclass_to_dict(i) for i in obj]
    return obj


def render_pdf(template_name: str, context_obj: Any) -> bytes:
    """
    Render *template_name* with *context_obj* (a dataclass) and return PDF bytes.

    Usage:
        pdf_bytes = render_pdf("pp30.html", pp30_data)
    """
    ctx = _dataclass_to_dict(context_obj) if hasattr(context_obj, "__dataclass_fields__") else context_obj
    template = _jinja_env.get_template(template_name)
    html_str = template.render(**ctx)

    pdf_buf = io.BytesIO()
    HTML(string=html_str, base_url=str(_TEMPLATES_DIR)).write_pdf(
        pdf_buf,
        stylesheets=[_BASE_CSS],
        font_config=_font_config,
    )
    return pdf_buf.getvalue()
