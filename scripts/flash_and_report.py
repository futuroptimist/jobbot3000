"""Utilities for flashing removable media and reporting device metadata."""

from __future__ import annotations

from typing import Any, Iterable


def _describe_device(info: dict[str, Any], devices: Iterable[Any], path: str) -> dict[str, Any]:
    """Populate *info* with details about the device mounted at *path*.

    The returned metadata mirrors the attributes exposed by
    ``flash_pi_media.discover_devices``.  Downstream code reconstructs a
    ``flash_pi_media.Device`` instance from this dictionary before invoking the
    platform-specific auto-eject helpers.  Windows relies on ``system_id`` to
    offline the disk, so we ensure that value is always present.
    """

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
