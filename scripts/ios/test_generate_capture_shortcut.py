import importlib.util
from pathlib import Path
import plistlib
import unittest


class CaptureShortcutTests(unittest.TestCase):
    def test_two_actions_wire_system_image_directly_to_app_intent(self):
        path = Path(__file__).with_name('generate-capture-shortcut.py')
        spec = importlib.util.spec_from_file_location('capture_shortcut', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        recipe = module.recipe()
        actions = recipe['WFWorkflowActions']
        self.assertEqual(len(actions), 2)
        capture, send = actions
        self.assertEqual(capture['WFWorkflowActionIdentifier'], 'is.workflow.actions.takescreenshot')
        self.assertEqual(send['WFWorkflowActionIdentifier'], 'com.talentsignal.app.ImportConversationScreenshotIntent')
        params = send['WFWorkflowActionParameters']
        self.assertEqual(params['AppIntentDescriptor']['BundleIdentifier'], 'com.talentsignal.app')
        self.assertEqual(params['AppIntentDescriptor']['TeamIdentifier'], '6RG2F8YY59')
        self.assertEqual(params['screenshot']['WFSerializationType'], 'WFTextTokenAttachment')
        self.assertEqual(params['screenshot']['Value']['OutputUUID'], capture['WFWorkflowActionParameters']['UUID'])
        self.assertEqual(params['screenshot']['Value']['Type'], 'ActionOutput')
        self.assertFalse(params['OpenWhenRun'])
        self.assertFalse(params['ShowWhenRun'])

    def test_recipe_is_deterministic_and_has_no_network_or_secret_parameters(self):
        path = Path(__file__).with_name('generate-capture-shortcut.py')
        spec = importlib.util.spec_from_file_location('capture_shortcut', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        content = plistlib.dumps(module.recipe(), sort_keys=True)
        self.assertEqual(content, plistlib.dumps(module.recipe(), sort_keys=True))
        for forbidden in [b'https://', b'Bearer', b'PRIVATE KEY', b'access_token', b'password']:
            self.assertNotIn(forbidden, content)
        self.assertEqual(module.recipe()['WFWorkflowImportQuestions'], [])


if __name__ == '__main__':
    unittest.main()
