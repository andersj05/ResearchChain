"""Exercise the same forecast scorer that ships in the analyst image."""

import csv
import json
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

SCORER = Path(__file__).resolve().parents[3] / "docker/analyst-python/signal_holdout.py"
COLUMNS = ["signal_available", "forecast_at", "target_end", "target_available", "x", "y"]


def observations():
    start = datetime(2020, 1, 1, tzinfo=UTC)
    rows = []
    for i in range(12):
        origin = start + timedelta(days=i)
        end = origin + timedelta(days=1)
        rows.append(
            [origin.isoformat(), origin.isoformat(), end.isoformat(), end.isoformat(), i, 2 * i + 3]
        )
    return rows


def run_scorer(tmp_path, rows):
    with (tmp_path / "panel.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(COLUMNS)
        writer.writerows(rows)
    (tmp_path / "outputs").mkdir(exist_ok=True)
    return subprocess.run(
        [sys.executable, str(SCORER), "panel.csv", "2020-01-09T00:00:00Z"],
        cwd=tmp_path,
        check=False,
        capture_output=True,
        text=True,
    )


def test_forecast_scores_unseen_rows_and_purges_unavailable_training_labels(tmp_path):
    rows = observations()
    rows[1][3] = rows[9][1]  # A delayed release with an extreme outcome.
    rows[1][5] = -100_000
    result = run_scorer(tmp_path, list(reversed(rows)))
    assert result.returncode == 0, result.stderr
    summary = json.loads(result.stdout)
    assert (summary["train_rows"], summary["purged_rows"], summary["holdout_rows"]) == (6, 2, 4)
    assert summary["train_slope"] == pytest.approx(2)
    assert summary["model_rmse"] == pytest.approx(0)
    assert summary["out_of_sample_r2"] == pytest.approx(1)
    with (tmp_path / "outputs/holdout-predictions.csv").open() as file:
        predictions = list(csv.DictReader(file))
    assert len(predictions) == 4
    assert float(predictions[0]["model_forecast"]) == pytest.approx(19)
    assert float(predictions[0]["benchmark_forecast"]) == pytest.approx(29 / 3)


def test_in_sample_fit_can_lose_to_benchmark_after_split(tmp_path):
    rows = observations()
    for row in rows[8:]:
        row[5] = -row[5]
    result = run_scorer(tmp_path, rows)
    assert result.returncode == 0, result.stderr
    summary = json.loads(result.stdout)
    assert summary["model_rmse"] > summary["benchmark_rmse"]
    assert summary["out_of_sample_r2"] < 0


def test_perfect_benchmark_leaves_relative_score_undefined(tmp_path):
    rows = observations()
    for row in rows:
        row[5] = 42
    result = run_scorer(tmp_path, rows)
    assert result.returncode == 0, result.stderr
    summary = json.loads(result.stdout)
    assert summary["benchmark_rmse"] == summary["model_rmse"] == 0
    assert summary["out_of_sample_r2"] is None


@pytest.mark.parametrize(
    "change",
    [
        "late signal",
        "duplicate origin",
        "missing offset",
        "nonfinite",
        "too few",
        "constant",
        "shifted columns",
    ],
)
def test_invalid_panel_produces_no_metrics(tmp_path, change):
    rows = observations()
    if change == "late signal":
        rows[0][0] = rows[1][0]
    elif change == "duplicate origin":
        rows.append(rows[0])
    elif change == "missing offset":
        rows[0][1] = "2020-01-01"
    elif change == "nonfinite":
        rows[0][5] = "NaN"
    elif change == "too few":
        rows = rows[:9]
    elif change == "shifted columns":
        rows[0].insert(5, 0)  # An unquoted thousands separator would shift the target column.
    else:
        for row in rows:
            row[4] = 1
    result = run_scorer(tmp_path, rows)
    assert result.returncode != 0 and "Holdout could not be scored" in result.stderr
    assert not list((tmp_path / "outputs").iterdir())
