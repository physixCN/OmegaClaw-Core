"""Run the hive:  python3 -m hive  (see hive/README.md for configuration)."""

import os

import uvicorn

from .core.app import create_app
from .core.config import load_settings


def main():
    settings = load_settings()
    app = create_app(settings)
    print(f"[hive] data: {settings.data_dir}")
    print(f"[hive] operator password: {settings.admin_password} (set HIVE_ADMIN_PASSWORD to choose one)")
    uvicorn.run(app, host=os.environ.get("HIVE_HOST", "127.0.0.1"), port=int(os.environ.get("HIVE_PORT", "8700")),
                log_level=os.environ.get("HIVE_LOG_LEVEL", "info"), ws_max_size=1 << 20)


if __name__ == "__main__":
    main()
