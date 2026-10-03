import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("appcast", pathlib.Path(__file__).with_name("validate-appcast.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class AppcastPolicyTests(unittest.TestCase):
    def feed(self, url=None, channel="", version="10"):
        url = url or "https://github.com/getyak/talent-signal/releases/download/macos-123-1/Talent-Signal-0.1.0-10-macOS-universal-signed.zip"
        return f'''<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><item>
        <sparkle:version>{version}</sparkle:version>{channel}
        <enclosure url="{url}" length="100" sparkle:edSignature="{'A'*86}==" />
        </item></channel></rss>'''.encode()

    def test_stable_and_preview(self):
        module.validate(self.feed(), 10)
        module.validate(self.feed(channel="<sparkle:channel>preview</sparkle:channel>"), 10)
        module.validate(self.feed(url="https://github.com/getyak/talent-signal/releases/download/v0.1.92/Talent-Signal-0.1.92-35-macOS-universal-signed.zip", version="35"), 35)

    def test_rejects_wrong_source_or_unsigned_package(self):
        for url in ["http://github.com/file.zip", "https://evil.test/file.zip",
                    "https://github.com/getyak/talent-signal/releases/latest/download/file.zip",
                    "https://github.com/getyak/talent-signal/releases/download/v0.1.92-rc1/Talent-Signal-0.1.92-10-macOS-universal-signed.zip",
                    "https://github.com/getyak/talent-signal/releases/download/macos-123-1/Talent-Signal-0.1.0-10-macOS-universal-preview.zip"]:
            with self.assertRaises(ValueError): module.validate(self.feed(url=url), 10)

    def test_previous_feed_requires_a_strictly_newer_build(self):
        module.validate(self.feed(), 11, before_build=True)
        for build in [9, 10]:
            with self.assertRaises(ValueError): module.validate(self.feed(), build, before_build=True)

    def test_rejects_stale_build_and_unknown_channel(self):
        with self.assertRaises(ValueError): module.validate(self.feed(), 9)
        with self.assertRaises(ValueError): module.validate(self.feed(channel="<sparkle:channel>nightly</sparkle:channel>"), 10)
        with self.assertRaises(ValueError): module.validate(self.feed().replace(b'length="100"', b'length="0"'), 10)
        with self.assertRaises(ValueError): module.validate(b'<!DOCTYPE rss>'+self.feed(), 10)
