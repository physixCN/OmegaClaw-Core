import importlib.util
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
WHATSAPP = ROOT / "modules" / "channel_whatsapp" / "src" / "whatsapp.py"


def load_whatsapp_module():
    spec = importlib.util.spec_from_file_location("whatsapp_module_under_test", WHATSAPP)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class WhatsAppJidGuardTest(unittest.TestCase):
    def test_primary_route_rejects_leading_jid_in_body(self):
        whatsapp = load_whatsapp_module()
        result = whatsapp._guard_primary_route_body("sampleuser@lid hello", "send-whatsapp")
        self.assertIn("MESSAGE-NOT-DELIVERED", result)
        self.assertIn("WHATSAPP-JID-IN-MESSAGE-BODY", result)
        self.assertIn("send-whatsapp-to jid message", result)

    def test_primary_route_allows_normal_message(self):
        whatsapp = load_whatsapp_module()
        result = whatsapp._guard_primary_route_body("hello sampleuser@lid is only discussed", "send-whatsapp")
        self.assertEqual(result, "")

    def test_primary_route_rejects_message_id_prefix(self):
        whatsapp = load_whatsapp_module()
        result = whatsapp._guard_primary_route_body("sampleuser@lid::3BABCDEF hello", "send-whatsapp")
        self.assertIn("MESSAGE-NOT-DELIVERED", result)
        self.assertIn("sampleuser@lid::3BABCDEF", result)


if __name__ == "__main__":
    unittest.main()
