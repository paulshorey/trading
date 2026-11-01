"""Exact checkpoints of streaming state: rolling-window tails, per-phase indicator states,
and session accumulators.

A stateful class lists its state attributes in `STATE`. `export_state` flattens an object
tree into named numpy arrays and `import_state` restores them, so a session can resume from
a stored checkpoint and continue with results identical to an uninterrupted run. The bytes
format is a NumPy `.npz` archive loaded without pickle.
"""

import io

import numpy as np

from .bars import BaseBars


def export_state(obj, prefix: str = "") -> dict[str, np.ndarray]:
    out: dict[str, np.ndarray] = {}
    for name in obj.STATE:
        value, key = getattr(obj, name), f"{prefix}{name}"
        if isinstance(value, BaseBars):
            out[f"{key}.step"] = np.asarray(value.step)
            for a in BaseBars.ARRAYS:
                out[f"{key}.{a}"] = getattr(value, a).copy()
        elif hasattr(value, "STATE"):
            out.update(export_state(value, f"{key}."))
        elif isinstance(value, dict):
            out[f"{key}:"] = np.zeros(0)  # marks an (possibly empty) dict
            for k, v in value.items():
                out[f"{key}:{k}"] = np.array(v, copy=True)
        elif isinstance(value, np.ndarray):
            out[key] = value.copy()
        elif isinstance(value, (bool, int, float, np.integer, np.floating)):
            out[key] = np.asarray(value)
        else:
            raise TypeError(f"Cannot checkpoint {key} of type {type(value).__name__}")
    return out


def import_state(obj, state: dict[str, np.ndarray], prefix: str = "") -> None:
    for name in obj.STATE:
        value, key = getattr(obj, name), f"{prefix}{name}"
        if isinstance(value, BaseBars):
            step = int(state[f"{key}.step"])
            setattr(obj, name, BaseBars(step, *(state[f"{key}.{a}"] for a in BaseBars.ARRAYS)))
        elif hasattr(value, "STATE"):
            import_state(value, state, f"{key}.")
        elif isinstance(value, dict):
            if f"{key}:" not in state:
                raise KeyError(f"Checkpoint has no {key}")
            mark = f"{key}:"
            setattr(
                obj,
                name,
                {k[len(mark) :]: v for k, v in state.items() if k.startswith(mark) and k != mark},
            )
        elif isinstance(value, np.ndarray):
            stored = state[key]
            if stored.dtype != value.dtype:
                raise ValueError(
                    f"Checkpoint {key} has dtype {stored.dtype}, expected {value.dtype}"
                )
            setattr(obj, name, stored.copy())
        elif isinstance(value, bool):
            setattr(obj, name, bool(state[key]))
        elif isinstance(value, (int, np.integer)):
            setattr(obj, name, int(state[key]))
        else:
            setattr(obj, name, float(state[key]))


def to_bytes(state: dict[str, np.ndarray]) -> bytes:
    buffer = io.BytesIO()
    np.savez_compressed(buffer, **state)
    return buffer.getvalue()


def from_bytes(data: bytes) -> dict[str, np.ndarray]:
    with np.load(io.BytesIO(data), allow_pickle=False) as archive:
        return {k: archive[k] for k in archive.files}


def same_state(a: dict[str, np.ndarray], b: dict[str, np.ndarray]) -> bool:
    """Exact equality of two exported states, NaN equal to NaN."""
    if a.keys() != b.keys():
        return False
    return all(
        x.dtype == y.dtype
        and x.shape == y.shape
        and np.array_equal(x, y, equal_nan=x.dtype.kind == "f")
        for x, y in ((a[k], b[k]) for k in a)
    )
