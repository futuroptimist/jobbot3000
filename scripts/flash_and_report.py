"""Helpers for flashing removable media and reporting device metadata."""
from __future__ import annotations

from typing import Iterable, Mapping, MutableMapping, Protocol, Sequence


class _DeviceLike(Protocol):
    path: str
    description: str | None
    is_removable: bool | None
    bus: str | None
    mountpoints: Sequence[str] | None
    system_id: int | None

    # Optional attribute provided by flash_pi_media on some platforms
    human_size: str | None


def _describe_device(devices: Iterable[_DeviceLike], path: str) -> Mapping[str, object | None]:
    """Return a serialisable description for a discovered device.

    The helper mirrors the behaviour of ``flash_pi_media.discover_devices`` by
    returning a dict with the fields jobbot's reporters expect.  The metadata is
    later fed back into ``flash_pi_media.Device`` so we must preserve the
    original ``system_id`` attribute where available; Windows relies on the
    identifier to offline disks during the auto-eject flow.
    """

    info: MutableMapping[str, object | None] = {"path": path}

    for device in devices:
        if getattr(device, "path", None) != path:
            continue

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
