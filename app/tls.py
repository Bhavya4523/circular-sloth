from __future__ import annotations

import os
import ssl


def create_verified_ssl_context() -> ssl.SSLContext:
    """Use configured/system trust roots without opening a managed key-log path."""
    keylog_file = os.environ.pop("SSLKEYLOGFILE", None)
    try:
        # create_default_context honors SSL_CERT_FILE/SSL_CERT_DIR and the OS
        # trust store. Python otherwise tries to open SSLKEYLOGFILE here.
        return ssl.create_default_context()
    finally:
        if keylog_file is not None:
            os.environ["SSLKEYLOGFILE"] = keylog_file
