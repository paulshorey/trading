import argparse
import json
import sys
from datetime import date
from pathlib import Path

import psycopg


def main() -> None:
    parser = argparse.ArgumentParser(prog="research", description="Trading research runner")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("catalog", help="List products and dates with MBP-1 files on disk")
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
    p = sub.add_parser("clocks", help="Store dated clock occurrences by venue trade date")
    p.add_argument("products", nargs="+")
    p.add_argument("--start", type=date.fromisoformat, required=True)
    p.add_argument("--end", type=date.fromisoformat, required=True)
    p = sub.add_parser("db", help="PostgreSQL: status, migrate, or register downloaded files")
    p.add_argument("action", choices=("status", "migrate", "register"))
    p = sub.add_parser(
        "ingest",
        help="Store second and minute rows with their 1m@1s and 1h@1m candle features",
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
        help="Sessions stored before a contract becomes front, so its values have settled "
        "(default: derived from the stages' warm-ups, at least 40)",
    )
    p.add_argument("--workers", type=int, help="Parallel processes (default: cores - 2)")
    p.add_argument(
        "--rebuild",
        action="store_true",
        help="Replace contracts stored by other code or settings, or missing earlier sessions",
    )
    p = sub.add_parser(
        "yardstick",
        help="The first decision model's forecast and horizon map (docs/project/yardstick-spec.md)",
        description="Builds the decision dataset from stored rows and the DBN files, fits the "
        "walk-forward forecast of the move ahead, and reports its skill. The run is recorded "
        "in research.run; models go to data/models/.",
    )
    p.add_argument("products", nargs="+", help="Product roots, for example GC SI")
    p.add_argument("--start", type=date.fromisoformat, help="First trade date (YYYY-MM-DD)")
    p.add_argument("--end", type=date.fromisoformat, help="Last trade date, before the holdout")
    p.add_argument("--workers", type=int, help="Parallel processes (default: cores - 2, at most 8)")
    p.add_argument("--rebuild", action="store_true", help="Build the dataset again")
    p.add_argument("--no-horizons", action="store_true", help="Skip the horizon map")
    p = sub.add_parser(
        "policy",
        help="The first decision model's policy in the engine (docs/project/yardstick-spec.md)",
        description="Replays every policy cell of the spec on the test months with the models "
        "of one `research yardstick` run. The run is recorded in research.run.",
    )
    p.add_argument("model_run", type=int, help="The yardstick run whose models decide")
    p.add_argument("products", nargs="+", help="Product roots, for example GC SI")
    p.add_argument("--workers", type=int, help="Parallel processes (default: cores - 2, at most 8)")
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
        elif args.command == "clocks":
            from . import clock_archive, db

            with db.connect() as conn:
                result = clock_archive.materialize(conn, args.products, args.start, args.end)
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
        elif args.command == "yardstick":
            from . import periods, yardstick

            result = yardstick.run(
                args.products,
                args.start or periods.DEV_START,
                args.end or periods.DEV_END,
                args.workers,
                log=lambda line: print(line, file=sys.stderr, flush=True),
                rebuild=args.rebuild,
                horizons=not args.no_horizons,
            )
        elif args.command == "policy":
            from . import policy

            result = policy.run(
                args.model_run,
                args.products,
                args.workers,
                log=lambda line: print(line, file=sys.stderr, flush=True),
            )
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
        if args.command == "verify":  # the report is printed either way; a failure exits 1
            failed = service.verify_failures(result)
            if failed:
                parser.exit(1, f"Error: verify failed: {'; '.join(failed)}\n")
    except (ValueError, TypeError, KeyError, OSError, RuntimeError, psycopg.Error) as error:
        parser.exit(1, f"Error: {error}\n")
