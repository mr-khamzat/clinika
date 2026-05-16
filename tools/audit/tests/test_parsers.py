"""Тесты для парсеров dead_code_audit (stdlib unittest, без зависимостей)."""
import pathlib
import sys
import unittest

sys.path.insert(0, "/opt/clinika")

from tools.audit.dead_code_audit import (  # noqa: E402
    extract_backend_endpoints,
    extract_frontend_api_calls,
    extract_frontend_imports,
)

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


class TestFrontendApiCalls(unittest.TestCase):
    def test_finds_literal_urls(self):
        calls = extract_frontend_api_calls(FIX / "SampleApi.jsx")
        found = {(c["method"], c["path"]) for c in calls}
        self.assertIn(("GET",  "/sample/items"), found)
        self.assertIn(("POST", "/sample/items"), found)
        # Template-string с ${var} → {var}
        self.assertIn(("GET",  "/sample/items/{var}/details"), found)

    def test_skips_comments(self):
        calls = extract_frontend_api_calls(FIX / "SampleApi.jsx")
        self.assertTrue(all(c["method"] != "PUT" for c in calls))


class TestFrontendImports(unittest.TestCase):
    def test_finds_static_and_lazy(self):
        imports = extract_frontend_imports(FIX / "SampleConsumer.jsx")
        targets = [i["target"] for i in imports]
        # Должны быть оба упоминания SampleComponent (статический import + lazy)
        match = [t for t in targets if t.endswith("SampleComponent")]
        self.assertGreaterEqual(len(match), 2,
            f"ожидали ≥ 2 упоминаний SampleComponent, нашли {match}")


if __name__ == "__main__":
    unittest.main()
