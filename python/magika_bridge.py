"""Narrow JSON bridge from Bun's embedded CPython to the Magika owner."""

import json

from magika import Magika, __version__

_classifier = None


def identify_path_json(path: str) -> str:
    global _classifier
    if _classifier is None:
        _classifier = Magika()

    result = _classifier.identify_path(path)
    payload = {
        "engine": "magika",
        "version": __version__,
        "path": str(result.path),
        "ok": result.ok,
        "status": str(result.status),
    }
    if result.ok:
        output = result.output
        payload["prediction"] = {
            "label": str(output.label),
            "mimeType": output.mime_type,
            "group": output.group,
            "description": output.description,
            "extensions": output.extensions,
            "isText": output.is_text,
            "score": result.score,
        }
    return json.dumps(payload)
