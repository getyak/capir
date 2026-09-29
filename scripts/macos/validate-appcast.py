#!/usr/bin/env python3
"""Validate release policy after Sparkle verifies cryptographic authenticity."""
import argparse
import base64
import re
import xml.etree.ElementTree as ET
from urllib.parse import urlparse

SPARKLE = "{http://www.andymatuschak.org/xml-namespaces/sparkle}"

def validate(content, expected_build, before_build=False):
    if b"<!DOCTYPE" in content.upper() or b"<!ENTITY" in content.upper():
        raise ValueError("Appcast declarations are not allowed")
    root = ET.fromstring(content)
    versions = []
    for item in root.findall("./channel/item"):
        version = item.findtext(SPARKLE + "version", "")
        if not re.fullmatch(r"[1-9][0-9]*", version):
            raise ValueError("Build numbers must be positive integers")
        if version in versions:
            raise ValueError("Duplicate build number")
        versions.append(version)
        if item.findtext(SPARKLE + "channel") not in (None, "preview"):
            raise ValueError("Unknown release channel")
        enclosure = item.find("enclosure")
        if enclosure is None:
            raise ValueError("Missing archive")
        url = urlparse(enclosure.get("url", ""))
        if url.scheme != "https" or url.netloc != "github.com" or url.query or url.fragment or not re.fullmatch(
            r"/getyak/talent-signal/releases/download/(?:macos-[0-9]+-[0-9]+|v[0-9]+\.[0-9]+\.[0-9]+)/Talent-Signal-[0-9]+\.[0-9]+\.[0-9]+-[0-9]+-macOS-universal-signed\.zip", url.path
        ):
            raise ValueError("Update archive must be a versioned signed macOS release")
        if int(enclosure.get("length", "0")) <= 0:
            raise ValueError("Empty archive")
        if len(base64.b64decode(enclosure.get(SPARKLE + "edSignature", ""), validate=True)) != 64:
            raise ValueError("Missing archive signature")
    if not versions:
        raise ValueError("Empty update feed")
    newest = max(map(int, versions))
    if before_build:
        if expected_build <= newest:
            raise ValueError("Build already published: use a fresh workflow run")
    elif expected_build != newest:
        raise ValueError("New build must be the newest item")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("feed")
    parser.add_argument("expected_build", type=int)
    parser.add_argument("--before-build", action="store_true")
    args = parser.parse_args()
    with open(args.feed, "rb") as source:
        content = source.read()
        validate(content, args.expected_build, before_build=args.before_build)
    print("Verified macOS feed policy")
