"""Loopback-only local development API. Not an authenticated deployment server."""

import json
import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from .catalog import describe
from .service import backtest, list_runs, read_run, trade_window

TRUSTED_ORIGINS = ("http://localhost:4400", "http://127.0.0.1:4400")
MAX_BODY = 16384


class Handler(BaseHTTPRequestHandler):
    def reply(self, status: int, body) -> None:
        data = json.dumps(body, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def route(self):
        url = urlparse(self.path)
        parts = [p for p in url.path.split("/") if p]
        if self.command == "GET":
            if parts == ["api", "health"]:
                return {"status": "ok", "mode": "research-only"}
            if parts == ["api", "catalog"]:
                return describe()
            if parts == ["api", "runs"]:
                return list_runs()
            if len(parts) == 3 and parts[:2] == ["api", "runs"]:
                return read_run(parts[2])
            if (
                len(parts) == 6
                and parts[:2] == ["api", "runs"]
                and parts[3] == "trades"
                and parts[5] == "bars"
                and parts[4].isdigit()
            ):
                query = parse_qs(url.query)
                before = int(query.get("before", ["240"])[0])
                after = int(query.get("after", ["120"])[0])
                if not (0 <= before <= 3600 and 0 <= after <= 3600):
                    raise ValueError("before and after must be 0..3600 seconds")
                return trade_window(parts[2], int(parts[4]), before, after)
        elif parts == ["api", "runs"]:
            if self.headers.get_content_type() != "application/json":
                raise ValueError("Expected application/json")
            origin = self.headers.get("Origin")
            if origin and origin not in TRUSTED_ORIGINS:
                raise ValueError("Untrusted browser origin")
            size = int(self.headers.get("Content-Length", 0))
            if not 0 < size <= MAX_BODY:
                raise ValueError(f"Request must be between 1 and {MAX_BODY} bytes")
            return backtest(json.loads(self.rfile.read(size)))
        raise FileNotFoundError("Unknown route")

    def dispatch(self) -> None:
        try:
            self.reply(200, self.route())
        except FileNotFoundError:
            self.reply(404, {"error": "Resource not found"})
        except (ValueError, TypeError, KeyError) as error:
            self.reply(400, {"error": str(error)})
        except Exception:
            logging.exception("Research API failed")
            self.reply(500, {"error": "Research run failed; check the server log"})

    do_GET = do_POST = dispatch


def serve(port: int) -> None:
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Research API: http://127.0.0.1:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
