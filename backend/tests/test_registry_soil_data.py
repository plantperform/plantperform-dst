import unittest
from unittest.mock import patch

from app.domain.soil import MissingSoilDataError, registry_soil_data
from app.services.nles5.bridge_v2 import evaluate_leaching_position
from app.services.nles5.engine import LowNitrogenModelError, nles5


class RegistrySoilDataTests(unittest.TestCase):
    def test_returns_rounded_immutable_category_order(self) -> None:
        data = registry_soil_data(
            {str(index): index + 0.00049 for index in range(1, 9)},
            3.12349,
            0.99191,
        )

        self.assertEqual(
            data,
            ((1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0), 3.123, 0.992),
        )
        self.assertIsInstance(data[0], tuple)

    def test_rejects_any_missing_category(self) -> None:
        self.assertIsNone(
            registry_soil_data(
                {str(index): 0.25 for index in range(1, 8)},
                3.0,
                0.99,
            )
        )

    @patch("app.services.nles5.bridge_v2.afstromning.afstromningskategori", return_value=1)
    @patch("app.services.nles5.bridge_v2.afgroede_normer.lookup_crop_params", return_value={})
    def test_missing_soil_has_specific_error(self, _crop_params, _kategori) -> None:
        with self.assertRaises(MissingSoilDataError):
            evaluate_leaching_position(
                afgrode_kode=1,
                next_afgrode_kode=None,
                prev_afgrode_kode=None,
                udlaeg_kode=None,
                jbnr=1,
                mncs=100,
            )

    @patch("app.services.nles5.bridge_v2.calculate_leaching", return_value={"L_nuar": 1.0})
    @patch("app.services.nles5.bridge_v2.afstromning.afstromningskategori", return_value=3)
    @patch("app.services.nles5.bridge_v2.afgroede_normer.lookup_crop_params", return_value={})
    def test_category_selects_real_p_and_passes_nt_s(
        self, _crop_params, _kategori, calculate_leaching
    ) -> None:
        result = evaluate_leaching_position(
            afgrode_kode=2,
            next_afgrode_kode=None,
            prev_afgrode_kode=None,
            udlaeg_kode=None,
            jbnr=1,
            mncs=100,
            percolation_by_kategori=(0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8),
            org_n_topsoil=3.123,
            s_soil=0.992,
        )

        self.assertEqual(result["P_override"], 0.3)
        self.assertEqual(result["NT"], 3.123)
        self.assertEqual(result["S_override"], 0.992)
        calculate_leaching.assert_called_once()

    @patch(
        "app.services.nles5.bridge_v2.calculate_leaching",
        return_value={"L": 5.0, "L_nuar": 5.0},
    )
    @patch("app.services.nles5.bridge_v2.afstromning.afstromningskategori", return_value=None)
    @patch("app.services.nles5.bridge_v2.afgroede_normer.lookup_crop_params", return_value={})
    def test_unknown_category_reports_zero_instead_of_blocking(
        self, _crop_params, _kategori, _calculate_leaching
    ) -> None:
        """A historical afgrødekode absent from Bilag 1 (e.g. "slettet mark")
        must not block the mark from being added; it reports 0/ukendt for
        that position instead of raising."""
        result = evaluate_leaching_position(
            afgrode_kode=995,
            next_afgrode_kode=None,
            prev_afgrode_kode=None,
            udlaeg_kode=None,
            jbnr=1,
            mncs=100,
            percolation_by_kategori=(0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8),
            org_n_topsoil=3.123,
            s_soil=0.992,
        )

        self.assertTrue(result["afstromningskategori_ukendt"])
        self.assertIsNone(result["afstromningskategori"])
        self.assertEqual(result["L"], 0.0)
        self.assertEqual(result["L_nuar"], 0.0)
        self.assertEqual(result["leaching_kgN_ha"], 0.0)
        self.assertEqual(result["L_nuar_kgN_ha"], 0.0)

    def test_low_n_error_remains_a_value_error(self) -> None:
        with self.assertRaises(LowNitrogenModelError):
            nles5(Y=2027, Ntheta=-100, C=0, P=0.3, S=1.0)
        self.assertTrue(issubclass(LowNitrogenModelError, ValueError))


if __name__ == "__main__":
    unittest.main()
