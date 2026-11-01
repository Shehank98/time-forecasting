"""What a request works on: one client, as one user. Datasets live in each user's browser, not here."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Workspace:
    client_id: int
    user_id: int
    is_admin: bool = False

    @property
    def sid(self) -> str:
        return f"u{self.user_id}"
