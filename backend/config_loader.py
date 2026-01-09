from __future__ import annotations
import json
import threading
from pathlib import Path
from typing import Optional

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

from .models import SiteConfig


class _ConfigEventHandler(FileSystemEventHandler):
    def __init__(self, loader: "ConfigLoader") -> None:
        super().__init__()
        self.loader = loader

    def on_modified(self, event):
        if not event.is_directory and Path(event.src_path) == self.loader.config_path:
            self.loader._reload()

    def on_created(self, event):
        if not event.is_directory and Path(event.src_path) == self.loader.config_path:
            self.loader._reload()


class ConfigLoader:
    def __init__(self, config_path: Path) -> None:
        self.config_path = config_path
        self._lock = threading.Lock()
        self._config: SiteConfig = SiteConfig()
        self.version = 0
        self._observer: Optional[Observer] = None
        self._load_initial()

    def _load_initial(self) -> None:
        self._reload()

    def start_watch(self) -> None:
        if self._observer:
            return
        event_handler = _ConfigEventHandler(self)
        observer = Observer()
        observer.schedule(event_handler, str(self.config_path.parent), recursive=False)
        observer.start()
        self._observer = observer

    def stop_watch(self) -> None:
        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=2)
            self._observer = None

    def _reload(self) -> None:
        try:
            data = json.loads(self.config_path.read_text(encoding="utf-8"))
            cfg = SiteConfig(**data)
        except Exception:
            # 保持旧配置，避免因配置错误导致服务不可用
            return
        with self._lock:
            self._config = cfg
            self.version += 1

    def get(self) -> SiteConfig:
        with self._lock:
            return self._config
