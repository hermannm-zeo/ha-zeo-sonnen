"""Which model/Protect combinations get the backup reserve."""

from __future__ import annotations

import pytest

from custom_components.zeo_sonnen.const import MODELS, PROTECTS, has_backup, protect_fits

WITH_BACKUP = {
    ("performance", "protect_8000"),
    ("performance_plus", "none"),
    ("eco", "protect_4000"),
}


@pytest.mark.parametrize("model", list(MODELS))
@pytest.mark.parametrize("protect", list(PROTECTS))
def test_has_backup(model: str, protect: str) -> None:
    assert has_backup(model, protect) is ((model, protect) in WITH_BACKUP)


@pytest.mark.parametrize(
    ("model", "protect", "fits"),
    [
        ("performance", "none", True),
        ("performance", "protect_8000", True),
        ("performance", "protect_4000", False),
        ("performance_plus", "none", True),
        ("performance_plus", "protect_8000", False),
        ("eco", "protect_4000", True),
        ("eco", "protect_8000", False),
        ("hybrid", "none", True),
        ("hybrid", "protect_4000", False),
    ],
)
def test_protect_fits(model: str, protect: str, fits: bool) -> None:
    assert protect_fits(model, protect) is fits
