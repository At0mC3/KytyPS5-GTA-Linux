import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import remote_client  # noqa: E402


class Credentials(unittest.TestCase):
    def test_from_environment(self):
        env = {"KYTY_REMOTE_URL": "https://x.example/mcp", "KYTY_REMOTE_KEY": "k"}
        with mock.patch.dict(os.environ, env, clear=True):
            self.assertEqual(remote_client.credentials(), ("https://x.example/mcp", "k"))

    def test_from_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "remote.txt"
            path.write_text("https://y.example/mcp\nsecret\n")
            with mock.patch.dict(os.environ, {"KYTY_REMOTE_FILE": str(path)}, clear=True):
                self.assertEqual(remote_client.credentials(), ("https://y.example/mcp", "secret"))

    def test_missing_is_an_error_that_names_the_variables(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(SystemExit) as raised:
                remote_client.credentials()
        self.assertIn("KYTY_REMOTE_URL", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
