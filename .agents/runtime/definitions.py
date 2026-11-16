"""Metadata compatibility for a retained host; no execution/session runtime."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).resolve().parent.parent / "data/definitions.py"), run_name="__main__")
