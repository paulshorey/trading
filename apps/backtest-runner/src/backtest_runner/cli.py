import argparse
import json
from datetime import date
from pathlib import Path

import psycopg


def main() -> None:
    parser = argparse.ArgumentParser(prog="research", description="Trading research runner")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("catalog", help="List products and dates with TBBO files on disk")
    p.add_argument("--verify", action="store_true", help="Check every file's size and SHA-256")
    p = sub.add_parser("backtest", help="Run a spec as fast as possible and save the result")
    p.add_argument("spec", type=Path)
    p.add_argument("--no-save", action="store_true")
    p = sub.add_parser("verify", help="Check whole-session and second-by-second runs match")
    p.add_argument("spec", type=Path)
    p.add_argument("--sessions", type=int, default=1)
    p = sub.add_parser("rehearse", help="Replay sessions through the live path in real time")
    p.add_argument("spec", type=Path)
    p.add_argument("--speed", type=float, default=60.0, help="1 = real time; 0 = no waiting")
    p.add_argument("--sessions", type=int, default=1)
    p = sub.add_parser("db", help="PostgreSQL: status, migrate, or register downloaded files")
    p.add_argument("action", choices=("status", "migrate", "register"))
    p = sub.add_parser(
        "ingest",
        help="Store one-second rows and 1m@1s candle features in PostgreSQL",
        description="plan: show what would be built (reads DBN files to find rolls, writes no "
        "rows). run: build it; safe to rerun or interrupt. status: what is stored.",
    )
    p.add_argument("action", choices=("plan", "run", "status"))
    p.add_argument("products", nargs="*", help="Product roots, for example GC SI")
    p.add_argument("--contract", help="One explicit contract, such as GCZ6, instead of rolls")
    p.add_argument("--start", type=date.fromisoformat, help="First trade date (YYYY-MM-DD)")
    p.add_argument("--end", type=date.fromisoformat, help="Last trade date (YYYY-MM-DD)")
    p.add_argument(
        "--lead-sessions",
        type=int,
        default=5,
        help="Sessions stored before a contract becomes front, to warm its indicators",
    )
    p.add_argument("--workers", type=int, help="Parallel processes (default: cores - 2)")
    p.add_argument(
        "--rebuild",
        action="store_true",
        help="Replace contracts stored by other code or settings, or missing earlier sessions",
    )
    p = sub.add_parser("serve", help="Local research API for the web UI")
    p.add_argument("--port", type=int, default=8001)
    args = parser.parse_args()
    try:
        if args.command == "serve":
            from .server import serve

            serve(args.port)
            return
        from . import catalog, service

        if args.command == "catalog":
            result = (
                catalog.verify_all()
                if args.verify
                else {
                    "products": catalog.describe(),
                    "unconfigured_parents": catalog.unconfigured_parents(),
                }
            )
        elif args.command == "db":
            from . import db

            with db.connect() as conn:
                if args.action == "status":
                    result = db.status(conn)
                elif args.action == "migrate":
                    result = {"applied": db.migrate(conn)}
                else:
                    result = {
                        "registered": db.register_files(
                            conn, [f for f in catalog.discover(schema=None) if f.present]
                        )
                    }
        elif args.command == "ingest":
            from . import ingest

            if args.action == "status":
                result = ingest.status()
            else:
                if not args.products:
                    parser.error("name at least one product, for example: ingest plan GC SI")
                options = {
                    "contract": args.contract,
                    "start": args.start,
                    "end": args.end,
                    "lead": args.lead_sessions,
                    "rebuild": args.rebuild,
                }
                if args.action == "plan":
                    result = ingest.summarize(ingest.plan(args.products, **options))
                else:
                    result = ingest.run(args.products, workers=args.workers, **options)
        elif args.command == "backtest":
            run = service.backtest(json.loads(args.spec.read_text()), save=not args.no_save)
            result = {k: run[k] for k in ("id", "summary", "candidates", "performance")}
        elif args.command == "verify":
            result = service.verify(json.loads(args.spec.read_text()), args.sessions)
        else:
            result = service.rehearse(
                json.loads(args.spec.read_text()),
                args.speed,
                lambda line: print(line, flush=True),
                args.sessions,
            )
        print(json.dumps(result, indent=2, allow_nan=False))
    except (ValueError, TypeError, KeyError, OSError, RuntimeError, psycopg.Error) as error:
        parser.exit(1, f"Error: {error}\n")
