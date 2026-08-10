"""Exercise the real Tesseract path used for scanned Statement images."""
from io import BytesIO

from PIL import Image, ImageDraw, ImageFont

from app.services.bank_statement_parser import parse_bank_statement_with_metadata


image = Image.new("RGB", (1600, 180), "white")
draw = ImageDraw.Draw(image)
try:
    font = ImageFont.truetype(
        "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf", 44
    )
except OSError:
    font = ImageFont.load_default()
draw.text(
    (30, 50),
    "29/07/2026 deposit customer 2,000.00 12,000.00",
    fill="black",
    font=font,
)
buffer = BytesIO()
image.save(buffer, format="PNG")

result = parse_bank_statement_with_metadata("statement.png", buffer.getvalue())
assert result.processing_method == "ocr"
assert len(result.transactions) == 1
assert result.transactions[0].amount == 2000.0
print("statement OCR smoke test: OK")
