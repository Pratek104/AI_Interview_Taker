from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from threading import Lock

from PIL import Image, ImageOps, UnidentifiedImageError
from ultralytics import YOLO

PHONE_LABEL_KEYWORDS = ("phone", "smartphone", "mobile", "cellphone")

# Inference-time confidence floor. Kept intentionally LOW so small /
# partially-occluded phones still produce candidate boxes; the final
# phone/no-phone decision happens against `phone_confidence_threshold`.
INFERENCE_CONFIDENCE = 0.15
# Larger imgsz preserves small phones (typical cheating case: phone held low,
# small in frame). ~0.1s/frame on CPU at 960 for 640px webcam uploads.
INFERENCE_IMGSZ = 960
# A real held phone is rarely below 0.1% of the frame. This only rejects
# dust-speck background boxes, not genuine small phones.
MIN_PHONE_RELATIVE_AREA = 0.001
# High-confidence hits count double toward the frontend streak so an obvious
# phone flags immediately, while borderline hits still need confirmation.
HIGH_CONFIDENCE_FAST_PATH = 0.6


@dataclass
class PhoneDetectionResult:
    phone_detected: bool
    confidence: float
    label: str


class YoloProctoringService:
    """
    Lightweight wrapper around YOLO object detection for proctoring signals.
    """

    def __init__(
        self,
        model_name: str | None = None,
        phone_confidence_threshold: float = 0.30,
        inference_confidence: float = INFERENCE_CONFIDENCE,
        inference_imgsz: int = INFERENCE_IMGSZ,
    ) -> None:
        self._model_name = self._resolve_model_name(model_name)
        self._phone_confidence_threshold = phone_confidence_threshold
        self._inference_confidence = inference_confidence
        self._inference_imgsz = inference_imgsz
        self._model: YOLO | None = None
        self._lock = Lock()
        self._predict_lock = Lock()

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
        if not image_bytes:
            raise ValueError("Image payload is empty.")
        try:
            image = Image.open(BytesIO(image_bytes))
            image = ImageOps.exif_transpose(image).convert("RGB")
        except (UnidentifiedImageError, OSError) as exc:
            raise ValueError(f"Invalid image payload: {exc}") from exc
        model = self._get_model()
        # Serialize inference: ultralytics/torch CPU inference from concurrent
        # requests can otherwise spike memory and intermittently fail.
        # Low `conf` keeps small-phone candidates; the decision threshold
        # below has the final say.
        with self._predict_lock:
            results = model.predict(
                image,
                verbose=False,
                conf=self._inference_confidence,
                imgsz=self._inference_imgsz,
            )
        if not results:
            return PhoneDetectionResult(phone_detected=False, confidence=0.0, label="")

        best_confidence = 0.0
        best_label = ""
        best_phone_confidence = 0.0
        best_phone_label = ""
        phone_detected = False

        result = results[0]
        names = result.names
        boxes = getattr(result, "boxes", None)
        if boxes is None or len(boxes) == 0:
            return PhoneDetectionResult(phone_detected=False, confidence=0.0, label="")
        img_w, img_h = image.size
        img_area = max(1, img_w * img_h)
        for box in boxes:
            cls_idx = int(box.cls.item())
            confidence = float(box.conf.item())
            raw_label = str(names.get(cls_idx, cls_idx))
            label = raw_label.lower().replace(" ", "").replace("-", "")
            if confidence > best_confidence:
                best_confidence = confidence
                best_label = raw_label.lower()
            # Different YOLO exports use slightly different label text
            # ("cell phone", "cellphone", "mobile phone", ...).
            is_phone_label = any(keyword in label for keyword in PHONE_LABEL_KEYWORDS)
            if not is_phone_label:
                continue
            # Reject dust-speck background boxes only; genuine held phones
            # (even small/low ones) are well above this fraction.
            try:
                xyxy = box.xyxy[0].tolist()
                box_area = max(0.0, (xyxy[2] - xyxy[0])) * max(0.0, (xyxy[3] - xyxy[1]))
                relative_area = box_area / img_area
            except Exception:
                relative_area = 1.0
            if relative_area < MIN_PHONE_RELATIVE_AREA:
                continue
            if confidence > best_phone_confidence:
                best_phone_confidence = confidence
                best_phone_label = raw_label.lower()
            if confidence >= self._phone_confidence_threshold:
                phone_detected = True

        if best_phone_confidence > 0:
            # Report the phone confidence whenever any phone box was seen,
            # even below threshold — otherwise callers see a confusing
            # "person 0.95" confidence for a near-miss phone frame.
            return PhoneDetectionResult(
                phone_detected=phone_detected,
                confidence=best_phone_confidence,
                label=best_phone_label,
            )
        return PhoneDetectionResult(
            phone_detected=False,
            confidence=best_confidence,
            label=best_label,
        )
