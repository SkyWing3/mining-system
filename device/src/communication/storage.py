"""Escritura atómica y bloqueo entre procesos para las colas locales."""
from __future__ import annotations

import fcntl
import os
import tempfile
from contextlib import contextmanager
from pathlib import Path


class QueueDirectory:
    def __init__(self, path: str | Path):
        self.path = Path(path).resolve()
        if self.path.is_file():
            raise ValueError(f"{self.path} debe ser un directorio. Conserva y exporta primero la cola antigua; consulta docs/mysql.md.")
        self.path.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.rejected = self.path / "rejected"

    @contextmanager
    def locked(self):
        # Separate instances/processes share the same advisory lock on Linux/macOS.
        descriptor = os.open(self.path / ".lock", os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX)
            yield
        finally:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)

    def write_atomic(self, name: str, content: bytes) -> Path:
        """Temporary file, fsync, atomic rename and directory sync: never a half-written entry."""
        final = self.path / name
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=self.path, prefix=".", suffix=".tmp", delete=False) as output:
                temporary = Path(output.name)
                output.write(content)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, final)
            self.sync()
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
        return final

    def quarantine(self, files: list[Path], reason: str) -> None:
        """Move entries the central rejected permanently, keeping them for inspection."""
        self.rejected.mkdir(exist_ok=True, mode=0o700)
        for file in files:
            if file.exists():
                os.replace(file, self.rejected / file.name)
        if files:
            (self.rejected / f"{files[0].stem}.reason.txt").write_text(reason + "\n", encoding="utf-8")
        self.sync()

    def sync(self) -> None:
        descriptor = os.open(self.path, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
