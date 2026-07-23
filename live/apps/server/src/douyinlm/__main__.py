from __future__ import annotations

import uvicorn

from douyinlm.settings import get_settings


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "douyinlm.main:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()

