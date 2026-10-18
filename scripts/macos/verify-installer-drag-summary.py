"""A missing, failed or skipped native drag is never release acceptance."""
import json
import sys

with open(sys.argv[1]) as source:
    result = json.load(source)
expected = {"passedTests": 1, "failedTests": 0, "skippedTests": 0, "totalTestCount": 1}
if not isinstance(result, dict) or any(type(result.get(k)) is not int or result[k] != v for k, v in expected.items()):
    raise SystemExit("Expected exactly one native Finder drag test, zero failures and zero skips.")
print("Native Finder drag acceptance: 1 passed, 0 failed, 0 skipped.")
