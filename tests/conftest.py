import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

os.environ.setdefault("FORCE_FALLBACK", "1")   # tests never download the checkpoint
os.environ.setdefault("PRELOAD_MODEL", "0")
_db_dir = tempfile.mkdtemp(prefix="mr-test-")
if not os.environ.get("TEST_DATABASE_URL"):
    os.environ["DATABASE_URL"] = ""
    os.environ["SQLITE_PATH"] = os.path.join(_db_dir, "test.db")
else:                                           # run the suite against a real Postgres
    os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]
os.environ["ADMIN_EMAIL"] = "admin@agency.lk"
os.environ["ADMIN_PASSWORD"] = "admin-pass-123"

from app.services import auth, db  # noqa: E402

db.engine()
auth.bootstrap_admin()
