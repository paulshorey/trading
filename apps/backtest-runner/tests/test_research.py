from dataclasses import replace
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from zipfile import ZipFile
from http.server import ThreadingHTTPServer
from strategy_core import Bar, Config, Instrument, Replay, run_backtest
from strategy_core.order_flow import book_imbalance, divergence, infer_side
from strategy_core.strategies import RsiReversion
from backtest_runner.data import parse_zip, quality, validate_id
from backtest_runner.server import Handler
from backtest_runner import service, data


def bars(prices):
    return [Bar(i * 60, p, p + 1, p - 1, p, 10) for i, p in enumerate(prices)]


def zipped(entries):
    target = io.BytesIO()
    with ZipFile(target, 'w') as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    return target.getvalue()


class DataTests(unittest.TestCase):
    def test_future_contract_selected_without_price_scaling(self):
        body = zipped({'20131007_es_minute_trade_201312.csv': '0,1676.5,1677,1676,1676.75,9\n',
                       '20131007_es_minute_trade_201403.csv': '0,999,999,999,999,1\n'})
        result = parse_zip(body, '20131007', 'ES', '201312')
        self.assertEqual(result[0].time, 1381104000)
        self.assertEqual(result[0].close, 1676.75)
        self.assertEqual(len(result), 1)

    def test_reject_duplicate_unordered_invalid_and_nonfinite_bars(self):
        valid = '60000,10,12,9,11,1\n'
        for content in [valid + valid, valid + '0,10,12,9,11,1\n', '0,10,8,9,11,1\n',
                        '0,NaN,12,9,11,1\n', '60001,10,12,9,11,1\n', '0,10,12,9,11,-1\n']:
            with self.subTest(content=content), self.assertRaises(ValueError):
                parse_zip(zipped({'20180405_btcusd_minute_trade.csv': content}), '20180405', 'BTCUSD', None)

    def test_gaps_preserved(self):
        source = bars([10, 11, 12])
        source[-1] = replace(source[-1], time=240)
        report = quality({'id': 'test'}, source)
        self.assertEqual(report['bars'], 3)
        self.assertEqual(report['unobserved_minutes'], 2)

    def test_checksum_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(data, "CACHE", Path(tmp)):
            Path(tmp, "data.zip").write_bytes(b"altered")
            with self.assertRaisesRegex(ValueError, "Checksum mismatch"):
                data.verified_bytes({"path": "data.zip", "sha256": "0" * 64})

    def test_path_traversal_rejected(self):
        for value in ['../x', '/tmp/x', 'a/b', '', None]:
            with self.assertRaises(ValueError):
                validate_id(value)


class ReplayTests(unittest.TestCase):
    def setUp(self):
        self.config = Config(fast=1, slow=2, fee_bps=0, slippage_bps=0, quantity=1)
        self.instrument = Instrument('BTCUSD', 'crypto')

    def test_next_bar_open_and_terminal_mark_to_market(self):
        source = bars([100, 110, 120, 130])
        result = run_backtest(source, self.config, self.instrument)
        self.assertEqual(result['fills'], [{'time': 120, 'decision_time': 120, 'quantity': 1., 'price': 120., 'fee': 0., 'position': 1.}])
        self.assertEqual(result['metrics']['net_pnl'], 10)
        self.assertEqual(result['metrics']['open_position'], 1)

    def test_batch_stream_and_prefix_invariance(self):
        source = bars([100, 101, 104, 102, 98, 110, 99, 100])
        batch = run_backtest(source, self.config, self.instrument)
        replay = Replay(self.config, self.instrument)
        for bar in source:
            replay.on_bar(bar)
        self.assertEqual(batch, replay.result())
        prefix = run_backtest(source[:5], self.config, self.instrument)
        self.assertEqual(prefix['equity'], batch['equity'][:5])
        self.assertEqual(prefix['fills'], [f for f in batch['fills'] if f['time'] <= source[4].time])

    def test_costs_and_future_multiplier(self):
        c = replace(self.config, fee_per_unit=2.5, initial_cash=100000)
        result = run_backtest(bars([100, 101, 102, 104]), c, Instrument('ES-201312', 'future', 50, .25))
        self.assertEqual(result['metrics']['net_pnl'], 97.5)
        self.assertEqual(result['metrics']['fees'], 2.5)

    def test_short_pnl_and_round_trip_costs(self):
        c = replace(self.config, allow_short=True, fee_per_unit=2.5)
        result = run_backtest(bars([105, 104, 103, 102]), c, Instrument('ES', 'future', 50, .25))
        self.assertEqual(result['metrics']['net_pnl'], 47.5)
        self.assertEqual(result['metrics']['open_position'], -1)

    def test_reversal_charges_both_contract_legs(self):
        c = replace(self.config, allow_short=True, fee_per_unit=2.5)
        result = run_backtest(bars([100, 101, 99, 98]), c, Instrument("ES", "future", 50, .25))
        self.assertEqual([f["quantity"] for f in result["fills"]], [1, -2])
        self.assertEqual(result["metrics"]["fees"], 7.5)
        self.assertEqual(result["metrics"]["net_pnl"], -57.5)

    def test_slippage_rounds_against_trader(self):
        c = replace(self.config, slippage_bps=1)
        result = run_backtest(bars([100, 101, 102, 103]), c, Instrument('ES', 'future', 50, .25))
        self.assertEqual(result['fills'][0]['price'], 102.25)

    def test_drawdown_halt_exits_on_following_bar(self):
        c = replace(self.config, initial_cash=1000, max_drawdown_pct=1)
        result = run_backtest(bars([100, 101, 102, 50, 49, 60]), c, self.instrument)
        self.assertTrue(result['metrics']['halted'])
        self.assertEqual(result['metrics']['open_position'], 0)
        self.assertEqual(result['fills'][-1]['time'], 240)
        self.assertEqual(result['fills'][-1]['price'], 49)

    def test_insufficient_collateral_rejects_entry(self):
        c = replace(self.config, initial_cash=100)
        result = run_backtest(bars([100, 101, 102, 103]), c, self.instrument)
        self.assertFalse(result['fills'])
        self.assertIn('insufficient_collateral', [d['reason'] for d in result['decisions']])

    def test_last_signal_is_pending_not_same_bar_fill(self):
        result = run_backtest(bars([100, 99, 101]), self.config, self.instrument)
        self.assertEqual(result['metrics']['fill_count'], 0)
        self.assertEqual(result['pending_target'], 1)

    def test_rsi_honors_global_warmup(self):
        c = replace(self.config, strategy="rsi_reversion", fast=1, slow=4)
        result = run_backtest(bars([100, 99, 98, 97, 96, 95]), c, self.instrument)
        self.assertEqual(result["fills"][0]["time"], 240)

    def test_zero_volume_has_no_fill(self):
        source = bars([100, 101, 102, 103])
        source[2] = replace(source[2], volume=0)
        result = run_backtest(source, self.config, self.instrument)
        self.assertEqual(result['fills'][0]['time'], 180)

    def test_invalid_config_and_instrument(self):
        for options in [{'fast': 2, 'slow': 2}, {'quantity': float('nan')}, {'allow_short': 'yes'}, {'initial_cash': -1}, {'fee_bps': True}, {'slow': 2.2}]:
            with self.subTest(options=options), self.assertRaises(ValueError):
                Config(**options)
        with self.assertRaises(ValueError):
            Replay(replace(self.config, quantity=.5), Instrument('ES', 'future'))
        with self.assertRaises(ValueError):
            Replay(replace(self.config, allow_short=True), self.instrument)

    def test_out_of_order_rejected(self):
        replay = Replay(self.config, self.instrument)
        replay.on_bar(bars([100])[0])
        with self.assertRaises(ValueError):
            replay.on_bar(bars([100])[0])

    def test_rsi_warmup_and_reversion(self):
        strategy = RsiReversion(2, False)
        outputs = [strategy.on_bar(b) for b in bars([100, 99, 98, 110])]
        self.assertEqual(outputs, [None, None, 1, 0])


class PortedMetricTests(unittest.TestCase):
    def test_missing_book_not_neutral(self):
        self.assertIsNone(book_imbalance(0, 0))
        self.assertAlmostEqual(book_imbalance(30, 10), .5)
        with self.assertRaises(ValueError):
            book_imbalance(-1, 2)

    def test_quote_test_handles_midpoint_and_crossed_quotes(self):
        self.assertEqual(infer_side(101, 99, 101), 'buy')
        self.assertEqual(infer_side(99, 99, 101), 'sell')
        self.assertIsNone(infer_side(100, 99, 101))
        self.assertIsNone(infer_side(100, 101, 99))

    def test_divergence_thresholds(self):
        self.assertEqual(divergence(.5, -.1), 1)
        self.assertEqual(divergence(-.5, .1), -1)
        self.assertEqual(divergence(.49, -.5), 0)


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.patches = [patch.object(service, 'RUNS', Path(self.temp.name)),
                        patch.object(service, 'load', return_value=({'id': 'fixture', 'symbol': 'BTCUSD', 'asset': 'crypto', 'multiplier': 1, 'tick_size': .01}, bars([100, 101, 102, 103])))]
        for item in self.patches:
            item.start()
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()
        for item in self.patches:
            item.stop()
        self.temp.cleanup()

    def test_run_persistence_and_reproducible_identity(self):
        body = json.dumps({'dataset': 'fixture', 'config': {'fast': 1, 'slow': 2}}).encode()
        request = Request(self.base + '/api/runs', data=body, headers={'Content-Type': 'application/json'})
        with urlopen(request) as response:
            result = json.load(response)
        with urlopen(request) as response:
            repeated = json.load(response)
        self.assertEqual(result['id'], repeated['id'])
        with urlopen(self.base + '/api/runs/' + result['id']) as response:
            saved = json.load(response)
        self.assertEqual(saved['fills'], result['fills'])
        with urlopen(self.base + '/api/runs') as response:
            self.assertEqual(len(json.load(response)), 1)

    def test_bad_config_and_cross_origin_rejected(self):
        for config, origin in [({'quantity': 'bad'}, 'http://localhost:5173'), ({}, 'https://example.com')]:
            request = Request(self.base + '/api/runs', data=json.dumps({'dataset': 'fixture', 'config': config}).encode(), headers={'Content-Type': 'application/json', 'Origin': origin})
            with self.assertRaises(HTTPError) as error:
                urlopen(request)
            self.assertEqual(error.exception.code, 400)
            error.exception.close()
