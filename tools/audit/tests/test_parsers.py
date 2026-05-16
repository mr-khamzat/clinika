"""Тесты для парсеров dead_code_audit (stdlib unittest, без зависимостей)."""
import pathlib
import sys
import unittest

sys.path.insert(0, "/opt/clinika")

from tools.audit.dead_code_audit import extract_backend_endpoints  # noqa: E402

FIX = pathlib.Path(__file__).parent / "fixtures"


class TestBackendEndpoints(unittest.TestCase):
    def test_finds_decorated_routes(self):
        endpoints = extract_backend_endpoints(FIX / "sample_router.py")
        paths = {(e["method"], e["path"]) for e in endpoints}
        self.assertIn(("GET",    "/sample/items"), paths)
        self.assertIn(("POST",   "/sample/items"), paths)
        self.assertIn(("DELETE", "/sample/items/{item_id}"), paths)

    def test_ignores_comments(self):
        endpoints = extract_backend_endpoints(FIX / "sample_router.py")
        methods = {e["method"] for e in endpoints}
        self.assertNotIn("PUT", methods)


if __name__ == "__main__":
    unittest.main()
