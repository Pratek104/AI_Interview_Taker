from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from threading import Lock

from PIL import Image
from ultralytics import YOLO

PHONE_LABEL_KEYWORDS = ("phone", "smartphone", "mobile")


@dataclass
class PhoneDetectionResult:
    phone_detected: bool
    confidence: float
    label: str


class YoloProctoringService:
    """
    Lightweight wrapper around YOLO object detection for proctoring signals.
    """

    def __init__(self, model_name: str | None = None, phone_confidence_threshold: float = 0.45) -> None:
        self._model_name = self._resolve_model_name(model_name)
        self._phone_confidence_threshold = phone_confidence_threshold
        self._model: YOLO | None = None
        self._lock = Lock()

    def _resolve_model_name(self, model_name: str | None) -> str:
        if model_name:
            return model_name

        project_root = Path(__file__).resolve().parent.parent
        preferred_models = ("yolov8m.pt", "yolov8n.pt")
        for candidate in preferred_models:
            model_path = project_root / candidate
            if model_path.exists():
                return str(model_path)
        return preferred_models[-1]

    def _get_model(self) -> YOLO:
        if self._model is not None:
            return self._model
        with self._lock:
            if self._model is None:
                self._model = YOLO(self._model_name)
        return self._model

    def detect_phone(self, image_bytes: bytes) -> PhoneDetectionResult:
        image = Image.open(BytesIO(image_bytes)).convert("RGB")
        model = self._get_model()
        # Higher `conf` + smaller imgsz = fewer tiny false-positive boxes.
        # Final say still happens in _phone_confidence_threshold below.
        results = model.predict(image, verbose=False, conf=0.3, imgsz=640)
        if not results:
            return PhoneDetectionResult(phone_detected=False, confidence=0.0, label="")

        best_confidence = 0.0
        best_label = ""
        best_phone_confidence = 0.0
        phone_detected = False

        result = results[0]
        names = result.names
        img_w, img_h = image.size
        img_area = max(1, img_w * img_h)
        for box in result.boxes:
            cls_idx = int(box.cls.item())
            confidence = float(box.conf.item())
            label = str(names.get(cls_idx, cls_idx)).lower()
            if confidence > best_confidence:
                best_confidence = confidence
                best_label = label
            # Different YOLO exports can use slightly different label text.
            is_phone_label = any(keyword in label for keyword in PHONE_LABEL_KEYWORDS)
            if not is_phone_label:
                continue
            # Reject tiny background boxes: a real held phone occupies a
            # meaningful fraction of a webcam frame. This kills most
            # false positives (mugs, keys, keyboard corners, wall objects).
            try:
                xyxy = box.xyxy[0].tolist()
                box_area = max(0.0, (xyxy[2] - xyxy[0])) * max(0.0, (xyxy[3] - xyxy[1]))
                relative_area = box_area / img_area
            except Exception:
                relative_area = 1.0
            if relative_area < 0.002:
                continue
            if confidence > best_phone_confidence:
                best_phone_confidence = confidence
            if confidence >= self._phone_confidence_threshold:
                phone_detected = True

        return PhoneDetectionResult(
            phone_detected=phone_detected,
            confidence=best_phone_confidence if phone_detected else best_confidence,
            label="cell phone" if phone_detected else best_label,
        )
