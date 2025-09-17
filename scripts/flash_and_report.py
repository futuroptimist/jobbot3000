"""Helpers for flashing removable media and summarizing detected devices."""

from __future__ import annotations

from typing import Any, Iterable, MutableMapping


def _describe_device(devices: Iterable[object], path: str) -> MutableMapping[str, Any]:
    """Return metadata for the device mounted at *path*.

    The helper walks *devices* (which must expose ``path`` attributes) and merges
    notable attributes into a metadata dictionary. Fields default to ``None`` or an
    empty list so callers receive stable keys regardless of platform support.
    """

    info: MutableMapping[str, Any] = {"path": path}
    for device in devices:
        if getattr(device, "path", None) == path:
            info.update(
                {
                    "description": getattr(device, "description", None),
                    "is_removable": getattr(device, "is_removable", None),
                    "human_size": getattr(device, "human_size", None),
                    "bus": getattr(device, "bus", None),
                    "mountpoints": list(getattr(device, "mountpoints", None) or []),
                    "system_id": getattr(device, "system_id", None),
                }
            )
            break
    return info


__all__ = ["_describe_device"]
