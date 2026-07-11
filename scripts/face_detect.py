"""Version-agnostic face detection helper.

mediapipe >= 0.10.3x (the only builds with wheels for recent Python) dropped the legacy
`mp.solutions.face_detection` API and ship only the Tasks API. This module wraps the Tasks
`vision.FaceDetector` and returns RELATIVE bounding boxes (xmin/ymin/width/height as fractions
of the image), matching what the old solutions API exposed — so callers stay unchanged.

The tflite model is fetched once to ~/.shorts-tools/models/ (override with SHORTS_FACE_MODEL).
"""
import os
import urllib.request

_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_detector/"
    "blaze_face_short_range/float16/1/blaze_face_short_range.tflite"
)


def _model_path():
    override = os.environ.get("SHORTS_FACE_MODEL")
    if override and os.path.isfile(override):
        return override
    cache_dir = os.path.join(os.path.expanduser("~"), ".shorts-tools", "models")
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, "blaze_face_short_range.tflite")
    if not os.path.isfile(path):
        urllib.request.urlretrieve(_MODEL_URL, path)
    return path


class RelBBox:
    """Relative bounding box (fractions of image dimensions)."""

    __slots__ = ("xmin", "ymin", "width", "height")

    def __init__(self, xmin, ymin, width, height):
        self.xmin = xmin
        self.ymin = ymin
        self.width = width
        self.height = height


class FaceDetector:
    """Minimal face detector returning relative bboxes for RGB numpy frames.

    Mirrors just enough of the legacy `FaceDetection` surface (detect + close) that
    detect_content.py and compute_reframe.py need.
    """

    def __init__(self, min_confidence=0.5):
        import mediapipe as mp
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision

        self._mp = mp
        base = mp_python.BaseOptions(model_asset_path=_model_path())
        opts = vision.FaceDetectorOptions(
            base_options=base, min_detection_confidence=min_confidence
        )
        self._detector = vision.FaceDetector.create_from_options(opts)

    def detect_rel(self, rgb):
        """rgb: HxWx3 uint8 numpy array (RGB channel order). Returns list[RelBBox]."""
        import numpy as np

        h, w = rgb.shape[:2]
        rgb = np.ascontiguousarray(rgb, dtype=np.uint8)
        mp_image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=rgb)
        result = self._detector.detect(mp_image)
        boxes = []
        for det in result.detections:
            bb = det.bounding_box  # pixel coords: origin_x, origin_y, width, height
            boxes.append(
                RelBBox(bb.origin_x / w, bb.origin_y / h, bb.width / w, bb.height / h)
            )
        return boxes

    def close(self):
        try:
            self._detector.close()
        except Exception:
            pass
