"""``python -m indian_terminal`` starts the terminal on http://127.0.0.1:3000."""

import os

import uvicorn
from dotenv import load_dotenv


def main() -> None:
    # Real environment variables win over files; .env.local wins over .env.
    load_dotenv(".env.local", override=False)
    load_dotenv(".env", override=False)
    os.environ.setdefault("TRADINGAGENTS_MARKET", "IN")
    host = os.environ.get("TERMINAL_HOST", "127.0.0.1")
    port = int(os.environ.get("TERMINAL_PORT", "3000"))
    from .server import create_app

    uvicorn.run(create_app(), host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
