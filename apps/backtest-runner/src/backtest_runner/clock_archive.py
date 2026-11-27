"""Materialize the engine's calendar edition by source venue trading date."""

from datetime import time
from importlib.metadata import version

from strategy_core import venue_clock as clock
from strategy_core.market import PRODUCTS


def materialize(conn, products, start, end):
    if not clock.START <= start <= end <= clock.END:
        raise ValueError(f"Calendar edition covers {clock.START} to {clock.END}")
    roots = tuple(dict.fromkeys(products))
    if not roots or set(roots) - set(clock.PROFILES["all"]):
        raise ValueError("Choose one or more configured clock products")
    revision = clock.EDITION
    with conn.transaction(), conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO market.clock_rule VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
            "ON CONFLICT DO NOTHING",
            [
                (
                    revision,
                    r.event,
                    list(clock.PROFILES[r.profile]),
                    r.venue,
                    r.zone,
                    time.fromisoformat(r.local_time) if r.local_time else None,
                    r.calendar,
                    r.anchor,
                    r.source,
                    r.valid_from,
                    r.valid_through,
                    version("tzdata"),
                )
                for r in clock.RULES
            ],
        )
        cur.execute("CREATE TEMP TABLE import_clock (LIKE market.clock_occurrence) ON COMMIT DROP")
        with cur.copy("COPY import_clock FROM STDIN") as copy:
            for root in roots:
                calendars = {r.calendar for r in clock.ACTIVE if root in clock.PROFILES[r.profile]}
                for year in range(start.year, end.year + 1):
                    for calendar in sorted(calendars):
                        _, items = clock.records(
                            calendar, year, PRODUCTS[root].calendar if calendar == "product" else ""
                        )
                        for item in items:
                            rule = clock.rule_on(item.event, item.trade_date)
                            if (
                                root not in clock.PROFILES[rule.profile]
                                or not start <= item.trade_date <= end
                            ):
                                continue
                            local = item.at.tz_convert(clock.zone(rule.zone))
                            copy.write_row(
                                (
                                    revision,
                                    root,
                                    item.event,
                                    rule.valid_from,
                                    item.trade_date,
                                    local.date(),
                                    local.time(),
                                    item.at.to_pydatetime(),
                                    item.known_at.to_pydatetime()
                                    if item.known_at is not None
                                    else None,
                                    item.source,
                                )
                            )
        cur.execute(
            "INSERT INTO market.clock_occurrence SELECT * FROM import_clock ON CONFLICT DO NOTHING"
        )
        inserted = cur.rowcount
        cur.execute("DROP TABLE pg_temp.import_clock")
        cur.execute(
            "SELECT product,count(*) FROM market.clock_occurrence WHERE revision=%s "
            "AND product=ANY(%s) AND venue_trade_date BETWEEN %s AND %s GROUP BY product",
            (revision, list(roots), start, end),
        )
        return {"revision": revision, "inserted": inserted, "stored": dict(cur.fetchall())}
