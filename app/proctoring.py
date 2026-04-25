from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from threading import Lock

from PIL import Image
from ultralytics import YOLO


@dataclass
class PhoneDetectionResult:
    phone_detected: bool
    confidence: float
    label: str


class YoloProctoringService:
    """
    Lightweight wrapper around YOLO object detection for proctoring signals.
    """

    def __init__(self, model_name: str = "yolov8n.pt", phone_confidence_threshold: float = 0.2) -> None:
        self._model_name = model_name
        self._phone_confidence_threshold = phone_confidence_threshold
        self._model: YOLO | None = None
        self._lock = Lock()

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
        results = model.predict(image, verbose=False, conf=0.1)
        if not results:
            return PhoneDetectionResult(phone_detected=False, confidence=0.0, label="")

        best_confidence = 0.0
        best_label = ""
        best_phone_confidence = 0.0
        phone_detected = False

        result = results[0]
        names = result.names
        for box in result.boxes:
            cls_idx = int(box.cls.item())
            confidence = float(box.conf.item())
            label = str(names.get(cls_idx, cls_idx)).lower()
            if confidence > best_confidence:
                best_confidence = confidence
                best_label = label
            # Different YOLO exports can use slightly different label text.
            is_phone_label = "phone" in label
            if is_phone_label and confidence > best_phone_confidence:
                best_phone_confidence = confidence
            if is_phone_label and confidence >= self._phone_confidence_threshold:
                phone_detected = True

        return PhoneDetectionResult(
            phone_detected=phone_detected,
            confidence=best_phone_confidence if phone_detected else best_confidence,
            label="cell phone" if phone_detected else best_label,
        )
