"""Checks for the overlay helpers the GeoPackage map scripts share."""

import io
import unittest
from contextlib import redirect_stdout

import numpy as np
from shapely import box

from database.scripts.merged_gpkg import overlaps, progress_printer

CELLS = np.array([box(0, 0, 100, 100), box(100, 0, 200, 100)])
FIELDS = np.array(
    [
        box(0, 0, 150, 100),  # 10,000 m² on the first cell and 5,000 m² on the second
        box(500, 500, 600, 600),  # outside the map
        box(100, 0, 200, 100),  # touches the first cell along an edge only
        box(50, 50, 120, 120),  # 2,500 m² on the first cell and 1,000 m² on the second
    ]
)
EXPECTED_PAIRS = [
    (0, 0, 10_000.0),
    (0, 1, 5_000.0),
    (2, 1, 10_000.0),
    (3, 0, 2_500.0),
    (3, 1, 1_000.0),
]


def sorted_pairs(result: tuple[np.ndarray, np.ndarray, np.ndarray]) -> list[tuple]:
    field_index, cell_index, area = result
    return sorted(zip(field_index.tolist(), cell_index.tolist(), area.tolist(), strict=True))


class OverlapsTests(unittest.TestCase):
    def test_pairs_each_field_with_the_cells_it_shares_area_with(self) -> None:
        self.assertEqual(sorted_pairs(overlaps(FIELDS, CELLS)), EXPECTED_PAIRS)

    def test_gives_the_same_pairs_whatever_the_chunk_size(self) -> None:
        for chunk_size in (1, 2, 3, 4, 100):
            with self.subTest(chunk_size=chunk_size):
                result = overlaps(FIELDS, CELLS, chunk_size=chunk_size)

                self.assertEqual(sorted_pairs(result), EXPECTED_PAIRS)

    def test_reports_the_progress_after_each_chunk(self) -> None:
        reported: list[tuple[int, int]] = []

        overlaps(
            FIELDS, CELLS, chunk_size=3, progress=lambda done, total: reported.append((done, total))
        )

        self.assertEqual(reported, [(3, 4), (4, 4)])

    def test_gives_nothing_for_no_fields(self) -> None:
        field_index, cell_index, area = overlaps(np.empty(0, dtype=object), CELLS)

        self.assertEqual((len(field_index), len(cell_index), len(area)), (0, 0, 0))


class ProgressPrinterTests(unittest.TestCase):
    def test_prints_only_when_the_interval_has_passed_or_all_fields_are_done(self) -> None:
        report = progress_printer("overlaying", interval=3600)
        output = io.StringIO()

        with redirect_stdout(output):
            report(1, 4)
            report(4, 4)

        self.assertEqual(len(output.getvalue().splitlines()), 1)
        self.assertIn("overlaying: 4 / 4 fields (100%)", output.getvalue())


if __name__ == "__main__":
    unittest.main()
