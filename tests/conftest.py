import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

import os

os.environ.setdefault("FORCE_FALLBACK", "1")   # tests never download the 2 GB checkpoint
os.environ.setdefault("PRELOAD_MODEL", "0")
