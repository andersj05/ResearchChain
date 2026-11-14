"""Export deterministic OpenAPI; run through the API's uv environment."""

import json
from pathlib import Path

from researchchain.main import create_app

destination = Path(__file__).resolve().parents[1] / "packages/contracts/openapi.json"
destination.write_text(json.dumps(create_app().openapi(), indent=2) + "\n", encoding="utf-8")
