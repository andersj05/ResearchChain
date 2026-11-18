"""Score a frozen, one-predictor forecast against a training-mean benchmark."""

import argparse
import csv
import json
import math
import sys
from datetime import datetime
from pathlib import Path
from statistics import fmean


def instant(value):
    stamp = datetime.fromisoformat(value)
    if stamp.tzinfo is None:
        raise ValueError("Use ISO timestamps with an explicit UTC offset.")
    return stamp


def observations(path):
    required = {
        "signal_available",
        "forecast_at",
        "target_end",
        "target_available",
        "x",
        "y",
    }
    rows = []
    with path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source, strict=True)
        fields = reader.fieldnames or []
        if not required.issubset(fields) or len(set(fields)) != len(fields):
            raise ValueError(
                "Expected distinct columns including " + ", ".join(sorted(required))
            )
        for line, row in enumerate(reader, start=2):
            try:
                if None in row or None in row.values():
                    raise ValueError("Expected the same column count as the header.")
                available = instant(row["signal_available"])
                origin = instant(row["forecast_at"])
                end = instant(row["target_end"])
                resolved = instant(row["target_available"])
                x, y = float(row["x"]), float(row["y"])
                if not (available <= origin < end <= resolved):
                    raise ValueError(
                        "Signal or outcome timing violates the forecast order."
                    )
                if not (math.isfinite(x) and math.isfinite(y)):
                    raise ValueError("Predictor and outcome must be finite.")
            except (TypeError, ValueError) as error:
                raise ValueError(f"Row {line}: {error}") from error
            rows.append((origin, resolved, x, y))
    rows.sort()
    if len({row[0] for row in rows}) != len(rows):
        raise ValueError("Use one observation per distinct forecast origin.")
    return rows


def score(path, cutoff):
    rows = observations(path)
    train = [row for row in rows if row[1] < cutoff]
    test = [row for row in rows if row[0] >= cutoff]
    if len(train) < 3 or len(test) < 2:
        raise ValueError(
            "Need at least three resolved training rows and two holdout rows."
        )
    mean_x = fmean(row[2] for row in train)
    mean_y = fmean(row[3] for row in train)
    variance = sum((x - mean_x) ** 2 for _, _, x, _ in train)
    if variance == 0:
        raise ValueError("The training predictor is constant.")
    slope = sum((x - mean_x) * (y - mean_y) for _, _, x, y in train) / variance
    predictions = [
        (origin.isoformat(), actual, mean_y + slope * (x - mean_x), mean_y)
        for origin, _, x, actual in test
    ]
    model_mse = fmean(
        (actual - forecast) ** 2 for _, actual, forecast, _ in predictions
    )
    baseline_mse = fmean((actual - mean_y) ** 2 for _, actual, _, _ in predictions)
    summary = {
        "holdout_start": cutoff.isoformat(),
        "train_rows": len(train),
        "purged_rows": len(rows) - len(train) - len(test),
        "holdout_rows": len(test),
        "train_slope": slope,
        "model_rmse": math.sqrt(model_mse),
        "benchmark_rmse": math.sqrt(baseline_mse),
        "out_of_sample_r2": 1 - model_mse / baseline_mse if baseline_mse else None,
    }
    return summary, predictions


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("observations", type=Path)
    parser.add_argument("holdout_start", type=instant)
    args = parser.parse_args()
    try:
        summary, predictions = score(args.observations, args.holdout_start)
        result = json.dumps(summary, allow_nan=False, indent=2)
        with Path("outputs/holdout-predictions.csv").open(
            "w", encoding="utf-8", newline=""
        ) as f:
            writer = csv.writer(f)
            writer.writerow(
                ("forecast_at", "actual", "model_forecast", "benchmark_forecast")
            )
            writer.writerows(predictions)
        Path("outputs/holdout-metrics.json").write_text(result, encoding="utf-8")
        Path("outputs/holdout-method.py").write_bytes(Path(__file__).read_bytes())
        print(result)
    except (csv.Error, OSError, ValueError, OverflowError) as error:
        sys.exit(f"Holdout could not be scored: {error}")
