#!/usr/bin/env python3
"""Local-only smoke tests for Jon/Omega's webhost deployment.

These checks intentionally live with the local web UI patch rather than the
reusable body/channel organ patch.
"""

import pathlib
import sys
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import webhost  # noqa: E402


class WebhostDryTests(unittest.TestCase):
    def test_webhost_status_and_page_listing(self):
        status = webhost.webhost_status()
        self.assertIn("WEBHOST", status)
        self.assertIn("https://omega.groveybaby.family", status)
        pages = webhost.list_web_pages()
        self.assertTrue(pages.startswith("WEB-PAGES") or pages == "WEB-PAGES none")

    def test_diagnostics_data_shapes_are_read_only(self):
        status = webhost.diagnostics_status()
        self.assertIn("omega", status)
        self.assertIn("services", status)
        self.assertIn("artifact_count", status)
        logs = webhost.diagnostics_logs("terminal", 20)
        self.assertEqual(logs.get("target"), "terminal")
        self.assertIn("text", logs)

    def test_family_account_claims_remove_taken_members(self):
        old_users = webhost.USERS_FILE
        old_sessions = webhost.SESSIONS_FILE
        with tempfile.TemporaryDirectory() as tmp:
            tmp = pathlib.Path(tmp)
            webhost.USERS_FILE = tmp / "users.json"
            webhost.SESSIONS_FILE = tmp / "sessions.json"
            try:
                webhost._save_users({
                    "dad": {
                        "name": "Dad",
                        "role": "family",
                        "member": "Dad",
                        "password_hash": webhost._hash_password("old-password"),
                        "claimed": True,
                    },
                    "jon": {
                        "name": "Jon",
                        "role": "admin",
                        "member": "Jon",
                        "password_hash": webhost._hash_password("old-password"),
                    },
                })
                webhost._save_sessions({
                    "active-jon-token": {
                        "username": "jon",
                        "created": int(webhost.time.time()),
                        "expires": int(webhost.time.time()) + 3600,
                    }
                })
                self.assertEqual(webhost._available_account_members(), ["Lydia", "Anna", "Suzie"])
                webhost._claim_active_session_users()
                self.assertTrue(webhost._load_users()["jon"]["claimed"])
                ok, username = webhost._claim_family_account("Anna", "new-password")
                self.assertTrue(ok, username)
                self.assertEqual(username, "anna")
                self.assertEqual(webhost._available_account_members(), ["Lydia", "Suzie"])
                html = webhost._login_html()
                self.assertIn('action="/create-account"', html)
                self.assertNotIn('value="Anna"', html)
                self.assertNotIn('value="Dad"', html)
                self.assertNotIn('value="Jon"', html)
            finally:
                webhost.USERS_FILE = old_users
                webhost.SESSIONS_FILE = old_sessions


if __name__ == "__main__":
    unittest.main(verbosity=2)
