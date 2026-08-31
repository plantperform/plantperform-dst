"""Run the complete 2026 registry refresh in its required order.

The individual loaders remain useful for rerunning one overlay, but a fresh
registry import must start with the base layer and include the emissions
overlay so imported fields do not retain zero quotas by accident.
"""

from collections.abc import Callable

from load_dataimk2026 import load_dataimk2026
from load_jordbundskort import load_jordbundskort
from load_kystvandoplande import load_kystvandoplande
from load_mars_projekter import load_mars_projekter
from load_oekologi_hnv import load_oekologi_hnv
from load_retentionskort import load_retentionskort
from load_udledningsgraenser import load_udledningsgraenser

LoadStep = tuple[str, Callable[[], object]]

LOAD_STEPS: tuple[LoadStep, ...] = (
    ("basisdata", load_dataimk2026),
    ("jordbundskort", load_jordbundskort),
    ("kystvandoplande", load_kystvandoplande),
    ("retentionskort", load_retentionskort),
    ("udledningsgrænser", load_udledningsgraenser),
    ("økologi og HNV", load_oekologi_hnv),
    ("MARS-projekter", load_mars_projekter),
)


def load_registry_2026() -> None:
    for label, load in LOAD_STEPS:
        print(f"\n== Indlæser {label} ==", flush=True)
        load()


if __name__ == "__main__":
    load_registry_2026()
