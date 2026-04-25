import re
from pathlib import Path

import pytesseract
from pdf2image import convert_from_bytes


def configure_tesseract(tesseract_cmd: str) -> None:
    pytesseract.pytesseract.tesseract_cmd = tesseract_cmd


def clean_extracted_text(text: str) -> str:
    text = text.replace("\x0c", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_text_from_pdf(pdf_bytes: bytes, poppler_path: str | None = None) -> str:
    images = convert_from_bytes(pdf_bytes, dpi=250, poppler_path=poppler_path or None)
    page_text = [pytesseract.image_to_string(image) for image in images]
    combined_text = "\n\n".join(page_text)
    return clean_extracted_text(combined_text)


def validate_pdf_filename(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix != ".pdf":
        raise ValueError("Only PDF files are supported for upload.")
    return filename
