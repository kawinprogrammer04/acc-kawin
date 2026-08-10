from __future__ import annotations

import copy
import io
import re
import os
import shutil
import subprocess
import tempfile
import textwrap
import zipfile
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from xml.etree import ElementTree as ET

from app.schemas.tax_invoice import TaxInvoiceDocument

_TEMPLATE_PATH = Path(__file__).parent.parent / "templates" / "tax_invoice_template.xlsx"
_SHEET_XML = "xl/worksheets/sheet1.xml"
_WORKBOOK_XML = "xl/workbook.xml"
_DRAWING_XML = "xl/drawings/drawing1.xml"
_STYLES_XML = "xl/styles.xml"
_MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006"
_DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"

for prefix, namespace in {
    "": _MAIN_NS,
    "r": _REL_NS,
    "mc": _MC_NS,
    "x14ac": "http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac",
    "xr": "http://schemas.microsoft.com/office/spreadsheetml/2014/revision",
    "xr2": "http://schemas.microsoft.com/office/spreadsheetml/2015/revision2",
    "xr3": "http://schemas.microsoft.com/office/spreadsheetml/2016/revision3",
    "xr6": "http://schemas.microsoft.com/office/spreadsheetml/2016/revision6",
    "xr10": "http://schemas.microsoft.com/office/spreadsheetml/2016/revision10",
    "x15": "http://schemas.microsoft.com/office/spreadsheetml/2010/11/main",
    "x15ac": "http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac",
    "xcalcf": "http://schemas.microsoft.com/office/spreadsheetml/2018/calcfeatures",
}.items():
    ET.register_namespace(prefix, namespace)

_COPY_PRINT_RANGES = {
    "customer": ("B", "U"),
    "company": ("W", "AP"),
    "accounting": ("AR", "BK"),
}
_COPY_TYPE_ORDER = {
    "customer": ("customer",),
    "company": ("company",),
    "accounting": ("accounting",),
    "all": ("customer", "company", "accounting"),
}

_COPY_COLUMNS = (
    {
        "sequence": "B", "code": "C", "description": "E",
        "quantity": "K", "unit": "N", "unit_price": "Q", "amount": "T",
    },
    {
        "sequence": "W", "code": "X", "description": "Z",
        "quantity": "AF", "unit": "AI", "unit_price": "AL", "amount": "AO",
    },
    {
        "sequence": "AR", "code": "AS", "description": "AU",
        "quantity": "BA", "unit": "BD", "unit_price": "BG", "amount": "BJ",
    },
)

_CUSTOMER_ROW_20_DESCRIPTION_MERGE = "E20:J20"
_LEGACY_CUSTOMER_ROW_20_DESCRIPTION_MERGE = "E20:I20"
_ROW_20_DESCRIPTION_RIGHT_EDGE_STYLE = "112"
_PAGE_FIRST_ROW = 2
_PAGE_LAST_PRINT_ROW = 54
_PAGE_LAST_TEMPLATE_ROW = 55
_PAGE_ROW_STRIDE = 54
_LINE_FIRST_ROW = 20
_LINE_LAST_ROW = 41
_LINES_PER_PAGE = _LINE_LAST_ROW - _LINE_FIRST_ROW + 1
_LINE_ITEM_RANGES = (("B", "U"), ("W", "AP"), ("AR", "BK"))
_LINE_FIELD_MERGES = (
    {"sequence": ("B", "B"), "code": ("C", "D"), "description": ("E", "J"), "quantity": ("K", "M"), "unit": ("N", "P"), "unit_price": ("Q", "S"), "amount": ("T", "U")},
    {"sequence": ("W", "W"), "code": ("X", "Y"), "description": ("Z", "AE"), "quantity": ("AF", "AH"), "unit": ("AI", "AK"), "unit_price": ("AL", "AN"), "amount": ("AO", "AP")},
    {"sequence": ("AR", "AR"), "code": ("AS", "AT"), "description": ("AU", "AZ"), "quantity": ("BA", "BC"), "unit": ("BD", "BF"), "unit_price": ("BG", "BI"), "amount": ("BJ", "BK")},
)
_COPY_HEADER_MERGES = {
    "B10:U10": "E10:R10",
    "B11:T11": "E11:R11",
    "W10:AP10": "Z10:AM10",
    "W11:AO11": "Z11:AM11",
    "AR10:BK10": "AU10:BH10",
    "AR11:BJ11": "AU11:BH11",
}
_COPY_HEADER_VALUES = {
    "E10": "ต้นฉบับใบกำกับภาษี / ใบส่งสินค้า / ใบแจ้งหนี้",
    "E11": "ORIGINAL TAX INVOICE / DELIVERY ORDER / INVOICE",
    "Z10": "สำเนาใบกำกับภาษี / ใบส่งสินค้า / ใบแจ้งหนี้",
    "Z11": "COPY TAX INVOICE / DELIVERY ORDER / INVOICE",
    "AU10": "สำเนาใบกำกับภาษี / ใบส่งสินค้า / ใบแจ้งหนี้",
    "AU11": "COPY TAX INVOICE / DELIVERY ORDER / INVOICE",
}
_LEGACY_COPY_HEADER_CELLS = ("B10", "B11", "W10", "W11", "AR10", "AR11")
_COPY_HEADER_STYLE_IDS = {"79", "80"}
_COPY_HEADER_FONT_SIZES = {"79": "13", "80": "9.5"}
_WRAP_WIDTHS = {"code": 20, "description": 34, "unit": 6}
_LINE_ROW_HEIGHT = "15"
_CELL_REF_RE = re.compile(r"^([A-Z]+)([0-9]+)$")
_FORMULA_CELL_REF_RE = re.compile(r"(?<![A-Z])(\$?[A-Z]{1,3})(\$?)([0-9]+)")


def _money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def thai_baht_text(amount: Decimal) -> str:
    number_text = f"{_money(amount):.2f}"
    integer_part, satang_part = number_text.split(".")
    digits = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"]
    positions = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"]

    def read_six(value: str) -> str:
        result = ""
        length = len(value)
        for index, char in enumerate(value):
            digit = int(char)
            position = length - index - 1
            if digit == 0:
                continue
            if position == 0 and digit == 1 and length > 1:
                result += "เอ็ด"
            elif position == 1 and digit == 2:
                result += "ยี่"
            elif position != 1 or digit != 1:
                result += digits[digit]
            result += positions[position]
        return result

    def read_integer(value: str) -> str:
        if int(value) == 0:
            return digits[0]
        groups: list[str] = []
        while value:
            groups.insert(0, value[-6:])
            value = value[:-6]
        result = ""
        for index, group in enumerate(groups):
            if int(group):
                result += read_six(group)
                if index < len(groups) - 1:
                    result += "ล้าน"
        return result

    result = read_integer(integer_part) + "บาท"
    return result + ("ถ้วน" if satang_part == "00" else read_six(satang_part) + "สตางค์")


def _find_cell(root: ET.Element, reference: str) -> ET.Element:
    cell = root.find(f".//{{{_MAIN_NS}}}c[@r='{reference}']")
    if cell is None:
        raise ValueError(f"ไม่พบเซลล์ {reference} ในแม่แบบใบกำกับภาษี")
    return cell


def _set_cell(root: ET.Element, reference: str, value: str | int | float | Decimal) -> None:
    cell = _find_cell(root, reference)
    for child in list(cell):
        cell.remove(child)

    if isinstance(value, str):
        cell.set("t", "inlineStr")
        inline = ET.SubElement(cell, f"{{{_MAIN_NS}}}is")
        text = ET.SubElement(inline, f"{{{_MAIN_NS}}}t")
        if value.startswith(" ") or value.endswith(" ") or "\n" in value:
            text.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
        text.text = value
    else:
        cell.attrib.pop("t", None)
        numeric = ET.SubElement(cell, f"{{{_MAIN_NS}}}v")
        numeric.text = format(value, "f") if isinstance(value, Decimal) else str(value)


def _set_cell_style(root: ET.Element, reference: str, style_id: str) -> None:
    _find_cell(root, reference).set("s", style_id)


def _column_to_index(column: str) -> int:
    index = 0
    for char in column:
        index = index * 26 + ord(char) - ord("A") + 1
    return index


def _split_cell_reference(reference: str) -> tuple[str, int]:
    match = _CELL_REF_RE.match(reference)
    if not match:
        raise ValueError(f"cell reference ไม่ถูกต้อง: {reference}")
    return match.group(1), int(match.group(2))


def _shift_cell_reference(reference: str, row_offset: int) -> str:
    column, row = _split_cell_reference(reference)
    return f"{column}{row + row_offset}"


def _shift_formula(formula: str | None, row_offset: int) -> str | None:
    if not formula:
        return formula

    def replace(match: re.Match[str]) -> str:
        column, absolute_row, row_text = match.groups()
        row = int(row_text)
        if _PAGE_FIRST_ROW <= row <= _PAGE_LAST_TEMPLATE_ROW:
            return f"{column}{absolute_row}{row + row_offset}"
        return match.group(0)

    return _FORMULA_CELL_REF_RE.sub(replace, formula)


def _range_rows(reference: str) -> list[int]:
    rows = [int(row) for row in re.findall(r"[A-Z]+([0-9]+)", reference)]
    return rows


def _shift_range_reference(reference: str, row_offset: int) -> str:
    return re.sub(
        r"([A-Z]+)([0-9]+)",
        lambda match: f"{match.group(1)}{int(match.group(2)) + row_offset}",
        reference,
    )


def _page_offset(page_index: int) -> int:
    return page_index * _PAGE_ROW_STRIDE


def _wrapped_lines(value: str, width: int, *, break_on_hyphens: bool = False) -> list[str]:
    paragraphs = str(value or "").splitlines() or [""]
    lines: list[str] = []
    for paragraph in paragraphs:
        wrapped = textwrap.wrap(
            paragraph,
            width=width,
            break_long_words=True,
            break_on_hyphens=break_on_hyphens,
        )
        lines.extend(wrapped or [""])
    return lines


def _render_line(line: object) -> dict[str, object]:
    code_lines = _wrapped_lines(
        getattr(line, "product_code", ""),
        _WRAP_WIDTHS["code"],
        break_on_hyphens=True,
    )
    description_lines = _wrapped_lines(getattr(line, "description", ""), _WRAP_WIDTHS["description"])
    unit_lines = _wrapped_lines(getattr(line, "unit", ""), _WRAP_WIDTHS["unit"])
    slots = max(1, len(code_lines), len(description_lines), len(unit_lines))
    slots = min(slots, _LINES_PER_PAGE)
    return {
        "line": line,
        "slots": slots,
        "product_code": "\n".join(code_lines),
        "description": "\n".join(description_lines),
        "unit": "\n".join(unit_lines),
    }


def _paginate_lines(document: TaxInvoiceDocument) -> list[list[dict[str, object]]]:
    pages: list[list[dict[str, object]]] = [[]]
    used_slots = 0

    for line in document.lines:
        rendered = _render_line(line)
        slots = int(rendered["slots"])
        if pages[-1] and used_slots + slots > _LINES_PER_PAGE:
            pages.append([])
            used_slots = 0
        pages[-1].append(rendered)
        used_slots += slots

    return pages


def _is_line_item_column(column: str) -> bool:
    column_index = _column_to_index(column)
    return any(
        _column_to_index(start) <= column_index <= _column_to_index(end)
        for start, end in _LINE_ITEM_RANGES
    )


def _is_line_item_cell(reference: str) -> bool:
    column, row = _split_cell_reference(reference)
    relative_row = ((row - _LINE_FIRST_ROW) % _PAGE_ROW_STRIDE) + _LINE_FIRST_ROW
    return _LINE_FIRST_ROW <= relative_row <= _LINE_LAST_ROW and _is_line_item_column(column)


def _clone_wrap_styles(styles_xml: bytes, sheet_root: ET.Element) -> tuple[bytes, dict[str, str]]:
    styles_root = ET.fromstring(styles_xml)
    cell_xfs = styles_root.find(f".//{{{_MAIN_NS}}}cellXfs")
    if cell_xfs is None:
        raise ValueError("แม่แบบไม่มี cellXfs")

    source_style_ids: set[str] = set()
    for cell in sheet_root.findall(f".//{{{_MAIN_NS}}}c"):
        reference = cell.attrib.get("r")
        style_id = cell.attrib.get("s")
        if reference and style_id and _is_line_item_cell(reference):
            source_style_ids.add(style_id)

    wrap_style_ids: dict[str, str] = {}
    for style_id in sorted(source_style_ids, key=int):
        source = cell_xfs[int(style_id)]
        clone = copy.deepcopy(source)
        alignment = clone.find(f"{{{_MAIN_NS}}}alignment")
        if alignment is None:
            alignment = ET.SubElement(clone, f"{{{_MAIN_NS}}}alignment")
        alignment.set("wrapText", "1")
        clone.set("applyAlignment", "1")
        cell_xfs.append(clone)
        wrap_style_ids[style_id] = str(len(cell_xfs) - 1)

    cell_xfs.set("count", str(len(cell_xfs)))
    return ET.tostring(styles_root, encoding="utf-8", xml_declaration=True), wrap_style_ids


def _apply_wrap_styles(root: ET.Element, wrap_style_ids: dict[str, str]) -> None:
    for cell in root.findall(f".//{{{_MAIN_NS}}}c"):
        reference = cell.attrib.get("r")
        style_id = cell.attrib.get("s")
        if reference and style_id in wrap_style_ids and _is_line_item_cell(reference):
            cell.set("s", wrap_style_ids[style_id])


def _set_line_row_heights(root: ET.Element, page_count: int) -> None:
    for page_index in range(page_count):
        offset = _page_offset(page_index)
        for row_number in range(_LINE_FIRST_ROW + offset, _LINE_LAST_ROW + offset + 1):
            row = root.find(f".//{{{_MAIN_NS}}}row[@r='{row_number}']")
            if row is not None:
                row.set("ht", _LINE_ROW_HEIGHT)
                row.set("customHeight", "1")


def _line_slot_range(start_row: int, slots: int) -> tuple[int, int]:
    return start_row, start_row + slots - 1


def _ranges_overlap(first: tuple[int, int], second: tuple[int, int]) -> bool:
    return first[0] <= second[1] and second[0] <= first[1]


def _remove_line_slot_merges(root: ET.Element, start_row: int, slots: int) -> None:
    merge_cells = root.find(f".//{{{_MAIN_NS}}}mergeCells")
    if merge_cells is None:
        return

    slot_range = _line_slot_range(start_row, slots)
    for merge_cell in list(merge_cells.findall(f"{{{_MAIN_NS}}}mergeCell")):
        rows = _range_rows(merge_cell.attrib["ref"])
        if rows and _ranges_overlap((min(rows), max(rows)), slot_range):
            merge_cells.remove(merge_cell)
    merge_cells.set("count", str(len(merge_cells)))


def _add_line_slot_merges(root: ET.Element, start_row: int, slots: int) -> None:
    merge_cells = root.find(f".//{{{_MAIN_NS}}}mergeCells")
    if merge_cells is None:
        raise ValueError("แม่แบบไม่มี mergeCells")

    end_row = start_row + slots - 1
    for groups in _LINE_FIELD_MERGES:
        for start_column, end_column in groups.values():
            if start_column == end_column and start_row == end_row:
                continue
            ET.SubElement(
                merge_cells,
                f"{{{_MAIN_NS}}}mergeCell",
                {"ref": f"{start_column}{start_row}:{end_column}{end_row}"},
            )
    merge_cells.set("count", str(len(merge_cells)))


def _prepare_line_slot(root: ET.Element, start_row: int, slots: int) -> None:
    if slots <= 1:
        return
    _remove_line_slot_merges(root, start_row, slots)
    _add_line_slot_merges(root, start_row, slots)


def _duplicate_template_pages(root: ET.Element, page_count: int) -> None:
    if page_count <= 1:
        return

    sheet_data = root.find(f".//{{{_MAIN_NS}}}sheetData")
    if sheet_data is None:
        raise ValueError("แม่แบบไม่มี sheetData")

    source_rows = [
        copy.deepcopy(row)
        for row in sheet_data.findall(f"{{{_MAIN_NS}}}row")
        if _PAGE_FIRST_ROW <= int(row.attrib["r"]) <= _PAGE_LAST_TEMPLATE_ROW
    ]

    for page_index in range(1, page_count):
        row_offset = _page_offset(page_index)
        for source_row in source_rows:
            row = copy.deepcopy(source_row)
            row.set("r", str(int(row.attrib["r"]) + row_offset))
            for cell in row.findall(f"{{{_MAIN_NS}}}c"):
                cell.set("r", _shift_cell_reference(cell.attrib["r"], row_offset))
                formula = cell.find(f"{{{_MAIN_NS}}}f")
                if formula is not None:
                    formula.text = _shift_formula(formula.text, row_offset)
            sheet_data.append(row)

    merge_cells = root.find(f".//{{{_MAIN_NS}}}mergeCells")
    if merge_cells is not None:
        source_merges = [
            merge.attrib["ref"]
            for merge in merge_cells.findall(f"{{{_MAIN_NS}}}mergeCell")
            if _range_rows(merge.attrib["ref"])
            and min(_range_rows(merge.attrib["ref"])) >= _PAGE_FIRST_ROW
            and max(_range_rows(merge.attrib["ref"])) <= _PAGE_LAST_PRINT_ROW
        ]
        for page_index in range(1, page_count):
            row_offset = _page_offset(page_index)
            for reference in source_merges:
                ET.SubElement(
                    merge_cells,
                    f"{{{_MAIN_NS}}}mergeCell",
                    {"ref": _shift_range_reference(reference, row_offset)},
                )
        merge_cells.set("count", str(len(merge_cells)))

    dimension = root.find(f".//{{{_MAIN_NS}}}dimension")
    if dimension is not None and "ref" in dimension.attrib:
        start, end = dimension.attrib["ref"].split(":")
        end_column, _ = _split_cell_reference(end)
        dimension.set("ref", f"{start}:{end_column}{_PAGE_LAST_TEMPLATE_ROW + _page_offset(page_count - 1)}")


def _duplicate_drawing_pages(drawing_xml: bytes, page_count: int) -> bytes:
    if page_count <= 1:
        return drawing_xml

    root = ET.fromstring(drawing_xml)
    anchors = list(root)
    current_ids = [
        int(properties.attrib["id"])
        for properties in root.findall(f".//{{{_DRAWING_NS}}}cNvPr")
        if properties.attrib.get("id", "").isdigit()
    ]
    next_id = max(current_ids, default=0) + 1

    for page_index in range(1, page_count):
        row_offset = _page_offset(page_index)
        for anchor in anchors:
            duplicate = copy.deepcopy(anchor)
            for marker_name in ("from", "to"):
                marker = duplicate.find(f"{{{_DRAWING_NS}}}{marker_name}")
                if marker is None:
                    continue
                row = marker.find(f"{{{_DRAWING_NS}}}row")
                if row is not None and row.text is not None:
                    row.text = str(int(row.text) + row_offset)
            properties = duplicate.find(f".//{{{_DRAWING_NS}}}cNvPr")
            if properties is not None:
                properties.set("id", str(next_id))
                if "name" in properties.attrib:
                    properties.set("name", f"{properties.attrib['name']} page {page_index + 1}")
                next_id += 1
            root.append(duplicate)

    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _normalize_template_layout(root: ET.Element) -> None:
    merge_cells = root.find(f".//{{{_MAIN_NS}}}mergeCells")
    if merge_cells is None:
        raise ValueError("แม่แบบไม่มี mergeCells")

    for merge_cell in merge_cells.findall(f"{{{_MAIN_NS}}}mergeCell"):
        if merge_cell.attrib.get("ref") == _LEGACY_CUSTOMER_ROW_20_DESCRIPTION_MERGE:
            merge_cell.set("ref", _CUSTOMER_ROW_20_DESCRIPTION_MERGE)
            _set_cell_style(root, "J20", _ROW_20_DESCRIPTION_RIGHT_EDGE_STYLE)
        elif merge_cell.attrib.get("ref") in _COPY_HEADER_MERGES:
            merge_cell.set("ref", _COPY_HEADER_MERGES[merge_cell.attrib["ref"]])

    for cell in _LEGACY_COPY_HEADER_CELLS:
        _set_cell(root, cell, "")
    for cell, value in _COPY_HEADER_VALUES.items():
        _set_cell(root, cell, value)


def _normalize_header_styles(styles_xml: bytes) -> bytes:
    root = ET.fromstring(styles_xml)
    fonts = root.find(f".//{{{_MAIN_NS}}}fonts")
    cell_xfs = root.find(f".//{{{_MAIN_NS}}}cellXfs")
    if fonts is None or cell_xfs is None:
        raise ValueError("แม่แบบไม่มี styles ที่ต้องใช้")

    xfs = cell_xfs.findall(f"{{{_MAIN_NS}}}xf")
    for style_id in _COPY_HEADER_STYLE_IDS:
        index = int(style_id)
        if index >= len(xfs):
            raise ValueError(f"แม่แบบไม่มี style {style_id}")
        xf = xfs[index]
        font_id = int(xf.attrib.get("fontId", "0"))
        source_fonts = fonts.findall(f"{{{_MAIN_NS}}}font")
        if font_id >= len(source_fonts):
            raise ValueError(f"แม่แบบไม่มี font {font_id}")
        font = copy.deepcopy(source_fonts[font_id])
        size = font.find(f"{{{_MAIN_NS}}}sz")
        if size is None:
            size = ET.SubElement(font, f"{{{_MAIN_NS}}}sz")
        size.set("val", _COPY_HEADER_FONT_SIZES[style_id])
        fonts.append(font)
        fonts.set("count", str(len(fonts.findall(f"{{{_MAIN_NS}}}font"))))
        xf.set("fontId", str(len(source_fonts)))
        xf.set("applyAlignment", "1")
        alignment = xf.find(f"{{{_MAIN_NS}}}alignment")
        if alignment is None:
            alignment = ET.SubElement(xf, f"{{{_MAIN_NS}}}alignment")
        alignment.set("horizontal", "center")
        alignment.set("vertical", "center")

    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _populate_sheet(
    sheet_xml: bytes,
    document: TaxInvoiceDocument,
    line_pages: list[list[dict[str, object]]],
    wrap_style_ids: dict[str, str],
) -> bytes:
    root = ET.fromstring(sheet_xml)
    _normalize_template_layout(root)
    page_count = len(line_pages)
    _duplicate_template_pages(root, page_count)
    _set_line_row_heights(root, page_count)
    customer = document.customer
    address_lines = [part.strip() for part in customer.address.splitlines() if part.strip()]
    address_1 = address_lines[0] if address_lines else customer.address
    address_2 = " ".join(address_lines[1:]) if len(address_lines) > 1 else ""
    is_head_office = "สำนักงานใหญ่" in customer.branch
    branch_number = "" if is_head_office else customer.branch.replace("สาขาที่", "").strip()

    subtotal = _money(sum(
        (line.quantity * line.unit_price for line in document.lines),
        Decimal("0"),
    ))
    discount = _money(document.discount_amount)
    after_discount = _money(max(subtotal - discount, Decimal("0")))
    vat_amount = _money(after_discount * document.vat_rate / Decimal("100"))
    grand_total = _money(after_discount + vat_amount)
    amount_text = f"({thai_baht_text(grand_total)})"

    for page_index in range(page_count):
        offset = _page_offset(page_index)

        for cell in ("C13", "X13", "AS13"):
            _set_cell(root, _shift_cell_reference(cell, offset), customer.name)
        for cell in ("C14", "X14", "AS14"):
            _set_cell(root, _shift_cell_reference(cell, offset), address_1)
        for cell in ("C15", "X15", "AS15"):
            _set_cell(root, _shift_cell_reference(cell, offset), address_2)
        for cell in ("T13", "AO13", "BJ13"):
            _set_cell(root, _shift_cell_reference(cell, offset), document.invoice_number)
        for cell in ("T14", "AO14", "BJ14"):
            _set_cell(root, _shift_cell_reference(cell, offset), document.invoice_date.strftime("%d/%m/%Y"))
        for cell in ("D17", "Y17", "AT17"):
            _set_cell(root, _shift_cell_reference(cell, offset), customer.tax_id)
        for cell in ("H17", "AC17", "AX17"):
            _set_cell(root, _shift_cell_reference(cell, offset), "✓" if is_head_office else "")
        for cell in ("K17", "AF17", "BA17"):
            _set_cell(root, _shift_cell_reference(cell, offset), "" if is_head_office else "✓")
        for cell in ("N17", "AI17", "BD17"):
            _set_cell(root, _shift_cell_reference(cell, offset), branch_number)

        line_slot = 0
        line_counter_offset = sum(len(lines) for lines in line_pages[:page_index])
        for page_line_index, rendered_line in enumerate(line_pages[page_index]):
            line_index = line_counter_offset + page_line_index
            line = rendered_line["line"]
            slots = int(rendered_line["slots"])
            target_row = _LINE_FIRST_ROW + offset + line_slot
            _prepare_line_slot(root, target_row, slots)
            for columns in _COPY_COLUMNS:
                _set_cell(root, f"{columns['sequence']}{target_row}", line_index + 1)
                _set_cell(root, f"{columns['code']}{target_row}", rendered_line["product_code"])
                _set_cell(root, f"{columns['description']}{target_row}", rendered_line["description"])
                _set_cell(root, f"{columns['quantity']}{target_row}", line.quantity)
                _set_cell(root, f"{columns['unit']}{target_row}", rendered_line["unit"])
                _set_cell(root, f"{columns['unit_price']}{target_row}", line.unit_price)
                _set_cell(
                    root,
                    f"{columns['amount']}{target_row}",
                    _money(line.quantity * line.unit_price),
                )
            for consumed_row in range(target_row + 1, target_row + slots):
                for columns in _COPY_COLUMNS:
                    for column_key in ("sequence", "code", "description", "quantity", "unit", "unit_price", "amount"):
                        _set_cell(root, f"{columns[column_key]}{consumed_row}", "")
            line_slot += slots

        for row in range(_LINE_FIRST_ROW + offset + line_slot, _LINE_LAST_ROW + offset + 1):
            for columns in _COPY_COLUMNS:
                for column_key in ("sequence", "code", "description", "quantity", "unit", "unit_price", "amount"):
                    _set_cell(root, f"{columns[column_key]}{row}", "")

        for cell in ("C43", "X43", "AS43"):
            _set_cell(root, _shift_cell_reference(cell, offset), amount_text)
        for cell in ("C45", "X45", "AS45"):
            _set_cell(root, _shift_cell_reference(cell, offset), document.notes or "-")

        for cell, value in {
            "T43": subtotal, "T44": after_discount, "T46": vat_amount, "T48": grand_total,
            "AO43": subtotal, "AO44": after_discount, "AO46": vat_amount, "AO48": grand_total,
            "BJ43": subtotal,
            "BI44": Decimal("0") if subtotal == 0 else discount / subtotal,
            "BJ44": discount,
            "BJ46": after_discount,
            "BI48": document.vat_rate / Decimal("100"),
            "BJ48": grand_total,
        }.items():
            _set_cell(root, _shift_cell_reference(cell, offset), value)

    _apply_wrap_styles(root, wrap_style_ids)

    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _print_area(copy_type: str, page_count: int) -> str:
    ranges: list[str] = []
    for page_index in range(page_count):
        offset = _page_offset(page_index)
        for copy_key in _COPY_TYPE_ORDER[copy_type]:
            start_column, end_column = _COPY_PRINT_RANGES[copy_key]
            ranges.append(
                f"'1'!${start_column}${_PAGE_FIRST_ROW + offset}:"
                f"${end_column}${_PAGE_LAST_PRINT_ROW + offset}"
            )
    return ",".join(ranges)


def _set_print_area(workbook_xml: bytes, copy_type: str, page_count: int) -> bytes:
    root = ET.fromstring(workbook_xml)
    defined_name = root.find(
        f".//{{{_MAIN_NS}}}definedName[@name='_xlnm.Print_Area']"
    )
    if defined_name is None:
        raise ValueError("แม่แบบไม่มี Print_Area")
    defined_name.text = _print_area(copy_type, page_count)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def build_tax_invoice_xlsx(document: TaxInvoiceDocument, copy_type: str = "all") -> bytes:
    if copy_type not in _COPY_TYPE_ORDER:
        raise ValueError("ประเภทสำเนาไม่ถูกต้อง")

    line_pages = _paginate_lines(document)
    page_count = len(line_pages)
    output = io.BytesIO()
    with zipfile.ZipFile(_TEMPLATE_PATH, "r") as source:
        sheet_root = ET.fromstring(source.read(_SHEET_XML))
        _normalize_template_layout(sheet_root)
        styles_xml, wrap_style_ids = _clone_wrap_styles(source.read(_STYLES_XML), sheet_root)
        styles_xml = _normalize_header_styles(styles_xml)
        sheet_xml = ET.tostring(sheet_root, encoding="utf-8", xml_declaration=True)

        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as target:
            for item in source.infolist():
                content = source.read(item.filename)
                if item.filename == _SHEET_XML:
                    content = _populate_sheet(sheet_xml, document, line_pages, wrap_style_ids)
                elif item.filename == _WORKBOOK_XML:
                    content = _set_print_area(content, copy_type, page_count)
                elif item.filename == _DRAWING_XML:
                    content = _duplicate_drawing_pages(content, page_count)
                elif item.filename == _STYLES_XML:
                    content = styles_xml
                target.writestr(item, content)
    return output.getvalue()


def _soffice_binary() -> str:
    configured = os.getenv("TAX_INVOICE_SOFFICE_PATH")
    candidates = [configured] if configured else []
    candidates.extend(["soffice", "libreoffice"])

    for candidate in candidates:
        if not candidate:
            continue
        if os.sep in candidate and Path(candidate).exists():
            return candidate
        found = shutil.which(candidate)
        if found:
            return found

    raise RuntimeError(
        "ไม่พบ LibreOffice/soffice สำหรับ export PDF จาก Excel template "
        "(ตั้งค่า TAX_INVOICE_SOFFICE_PATH หรือเพิ่ม soffice ใน PATH)"
    )


def convert_xlsx_to_pdf(xlsx_bytes: bytes) -> bytes:
    soffice = _soffice_binary()
    timeout = float(os.getenv("TAX_INVOICE_PDF_TIMEOUT_SECONDS", "60"))

    with tempfile.TemporaryDirectory(prefix="tax-invoice-xlsx-pdf-") as temp_path:
        temp_dir = Path(temp_path)
        input_path = temp_dir / "tax_invoice.xlsx"
        output_path = temp_dir / "tax_invoice.pdf"
        user_installation = (temp_dir / "lo-profile").as_uri()
        input_path.write_bytes(xlsx_bytes)

        process = subprocess.run(
            [
                soffice,
                "--headless",
                "--nologo",
                "--nofirststartwizard",
                "--nodefault",
                "--nolockcheck",
                f"-env:UserInstallation={user_installation}",
                "--convert-to",
                "pdf:calc_pdf_Export",
                "--outdir",
                str(temp_dir),
                str(input_path),
            ],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        if process.returncode != 0 or not output_path.exists():
            detail = (process.stderr or process.stdout or "unknown error").strip()
            raise RuntimeError(f"แปลง Excel template เป็น PDF ไม่สำเร็จ: {detail}")
        return output_path.read_bytes()


def build_tax_invoice_pdf(document: TaxInvoiceDocument, copy_type: str = "all") -> bytes:
    xlsx = build_tax_invoice_xlsx(document, copy_type)
    return convert_xlsx_to_pdf(xlsx)


def convert_pdf_first_page_to_png(pdf_bytes: bytes) -> bytes:
    renderer = shutil.which("pdftoppm")
    if not renderer:
        raise RuntimeError("ไม่พบ Poppler สำหรับสร้างภาพตัวอย่าง")

    with tempfile.TemporaryDirectory(prefix="tax-invoice-preview-") as temp_path:
        temp_dir = Path(temp_path)
        input_path = temp_dir / "tax_invoice.pdf"
        output_prefix = temp_dir / "tax_invoice_preview"
        input_path.write_bytes(pdf_bytes)
        process = subprocess.run(
            [
                renderer,
                "-f", "1",
                "-singlefile",
                "-png",
                "-r", "120",
                str(input_path),
                str(output_prefix),
            ],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        output_path = output_prefix.with_suffix(".png")
        if process.returncode != 0 or not output_path.exists():
            detail = (process.stderr or process.stdout or "unknown error").strip()
            raise RuntimeError(f"สร้างภาพตัวอย่างไม่สำเร็จ: {detail}")
        return output_path.read_bytes()
