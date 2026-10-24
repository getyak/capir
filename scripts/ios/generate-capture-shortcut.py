#!/usr/bin/env python3
"""Generate the generic recipe; Apple signing and device import are separate gates.

Usage: python3 scripts/ios/generate-capture-shortcut.py /absolute/unsigned.shortcut
       shortcuts sign --mode anyone --input /absolute/unsigned.shortcut \
         --output apps/ios/Resources/CaptureToCapri.shortcut

The recipe has no endpoint or credentials. The signed app resolves its current
authorized scope when the user deliberately supplies the screenshot.
"""

import argparse
from pathlib import Path
import plistlib


def recipe():
    screenshot_id = '15467BC9-204E-4EE2-9702-40FB69D1BF43'
    return {
        'WFWorkflowName': 'Send to capri',
        'WFWorkflowClientVersion': '4528.0.4.2',
        'WFWorkflowMinimumClientVersion': 1100,
        'WFWorkflowMinimumClientVersionString': '1100',
        'WFWorkflowHasShortcutInputVariables': False,
        'WFWorkflowImportQuestions': [],
        'WFWorkflowInputContentItemClasses': [],
        'WFWorkflowOutputContentItemClasses': [],
        'WFWorkflowTypes': [],
        'WFQuickActionSurfaces': [],
        'WFWorkflowActions': [
            {
                'WFWorkflowActionIdentifier': 'is.workflow.actions.takescreenshot',
                'WFWorkflowActionParameters': {'UUID': screenshot_id},
            },
            {
                'WFWorkflowActionIdentifier': 'com.talentsignal.app.ImportConversationScreenshotIntent',
                'WFWorkflowActionParameters': {
                    'UUID': '3265A3A4-30B1-4F86-807B-81B65C7D25AC',
                    'AppIntentDescriptor': {
                        'AppIntentIdentifier': 'ImportConversationScreenshotIntent',
                        'BundleIdentifier': 'com.talentsignal.app',
                        'Name': 'capri',
                        'TeamIdentifier': '6RG2F8YY59',
                    },
                    'OpenWhenRun': False,
                    'ShowWhenRun': False,
                    'screenshot': {
                        'WFSerializationType': 'WFTextTokenAttachment',
                        'Value': {
                            'OutputName': 'Screenshot',
                            'OutputUUID': screenshot_id,
                            'Type': 'ActionOutput',
                        },
                    },
                },
            },
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.write_bytes(plistlib.dumps(recipe(), fmt=plistlib.FMT_XML, sort_keys=True))
    print(args.output)


if __name__ == '__main__':
    main()
