"""Explicit connection settings for opt-in, isolated Windows fixtures."""
import os
import re

target = os.environ.get('TURNLINK_TEST_WINDOWS_SSH_TARGET', 'fixture@example.invalid')
key = os.environ.get('TURNLINK_TEST_WINDOWS_SSH_KEY', '/nonexistent/turnlink-test-key')
remote_temp = os.environ.get('TURNLINK_TEST_WINDOWS_TEMP', 'C:/Temp').rstrip('/')
if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9._-]*', target):
    raise RuntimeError('Set TURNLINK_TEST_WINDOWS_SSH_TARGET to user@host')
if not key or not os.path.isabs(key):
    raise RuntimeError('Set TURNLINK_TEST_WINDOWS_SSH_KEY to an absolute key path')
if not re.fullmatch(r'[A-Za-z]:/(?:[A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+', remote_temp) or '..' in remote_temp.split('/'):
    raise RuntimeError('Set TURNLINK_TEST_WINDOWS_TEMP to a safe absolute Windows directory')
