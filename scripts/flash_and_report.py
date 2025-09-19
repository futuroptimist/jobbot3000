"""Helpers for flashing removable media and reporting device metadata.

This module contains a small helper that mirrors the behaviour expected by the
post-flash eject pipeline.  The tests exercise the helper directly, so keep the
implementation focused and dependency-free.
"""

from __future__ import annotations

from typing import Any, Iterable


def _normalize_mountpoints(device: Any) -> list[str]:
    """Return a deterministic list of mountpoints for *device*.

    ``flash_pi_media`` exposes ``mountpoints`` as ``None`` when the device has
    not been mounted.  The metadata returned by :func:`_describe_device`
    normalises this to an empty list so downstream JSON serialisation remains
    stable regardless of platform differences.
    """

    mountpoints = getattr(device, "mountpoints", None)
    if not mountpoints:
        return []
    return list(mountpoints)


def _describe_device(devices: Iterable[Any], path: str) -> dict[str, Any]:
    """Return metadata for the device whose ``path`` matches *path*.

    The return shape mirrors ``flash_pi_media.Device`` JSON serialisation so the
    CLI can persist it for follow-up operations.  The ``system_id`` field is
    critical on Windows where the eject helper requires it to offline the disk.
    ``system_id`` is therefore copied verbatim from the matching device object
    whenever it is exposed by ``flash_pi_media``.
    """

    info: dict[str, Any] = {"path": path, "system_id": None}
    for device in devices:
        if getattr(device, "path", None) != path:
            continue

        info.update(
            {
                "description": getattr(device, "description", None),
                "is_removable": getattr(device, "is_removable", False),
                "human_size": getattr(device, "human_size", None),
                "bus": getattr(device, "bus", None),
                "mountpoints": _normalize_mountpoints(device),
                "system_id": getattr(device, "system_id", None),
            }
        )
        break
    return info


__all__ = ["_describe_device"]
