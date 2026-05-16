"""Тесты для парсеров dead_code_audit (stdlib unittest, без зависимостей)."""
import pathlib
import sys
import unittest

sys.path.insert(0, "/opt/clinika")

from tools.audit.dead_code_audit import (  # noqa: E402
    classify_endpoint,
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
        match = [t for t in targets if t.endswith("SampleComponent")]
        self.assertGreaterEqual(len(match), 2,
            f"ожидали ≥ 2 упоминаний SampleComponent, нашли {match}")


class TestClassifyEndpoint(unittest.TestCase):
    def test_safe_when_no_match(self):
        ep = {"file": "x.py", "method": "GET", "path": "/x/legacy"}
        self.assertEqual(classify_endpoint(ep, calls=[], text_corpus=""), "safe")

    def test_review_when_only_in_text(self):
        ep = {"file": "x.py", "method": "GET", "path": "/x/legacy"}
        corpus = "// см. /x/legacy в документации"
        self.assertEqual(classify_endpoint(ep, [], corpus), "review")

    def test_alive_when_called(self):
        ep = {"file": "x.py", "method": "GET", "path": "/x/items/{id}"}
        calls = [{"file": "y.jsx", "method": "GET", "path": "/x/items/{var}"}]
        self.assertEqual(classify_endpoint(ep, calls, ""), "alive")

    def test_method_mismatch_not_alive(self):
        ep = {"file": "x.py", "method": "POST", "path": "/x/items"}
        calls = [{"file": "y.jsx", "method": "GET", "path": "/x/items"}]
        self.assertNotEqual(classify_endpoint(ep, calls, ""), "alive")

    def test_known_alive_prefix(self):
        # Служебные/webhook'и не считаем мёртвыми, даже без фронт-вызова.
        ep = {"file": "x.py", "method": "GET", "path": "/health/full"}
        self.assertEqual(classify_endpoint(ep, [], ""), "alive")
        ep2 = {"file": "x.py", "method": "POST", "path": "/mis/webhook"}
        self.assertEqual(classify_endpoint(ep2, [], ""), "alive")

    def test_prefix_match_handles_concat(self):
        # Фронт пишет: api.get('/admin/tenants/' + id), backend ждёт `/admin/tenants/{tenant_id}`
        ep = {"file": "x.py", "method": "GET", "path": "/admin/tenants/{tenant_id}"}
        calls = [{"file": "y.jsx", "method": "GET", "path": "/admin/tenants/"}]
        self.assertEqual(classify_endpoint(ep, calls, ""), "alive")


if __name__ == "__main__":
    unittest.main()
