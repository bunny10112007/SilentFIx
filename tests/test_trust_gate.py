"""Tests for Module 3: Pre-Flight Trust Gate & Token Verification."""

import pytest
import time
from fastapi import HTTPException
from app.probes.software_probe import (
    enforce_https_source,
    validate_sha256_string,
    mint_probe_token,
    validate_and_evict_token,
    verify_package_manifest,
    _verified_probes,
)


def test_enforce_https_source_success():
    """HTTPS sources must be accepted."""
    url = "https://github.com/git-for-windows/git/releases"
    result = enforce_https_source(url)
    assert result == url


def test_enforce_https_source_rejects_http():
    """Unencrypted HTTP sources must be blocked with 400 Bad Request."""
    with pytest.raises(HTTPException) as exc:
        enforce_https_source("http://insecure-download.com/setup.exe")
    assert exc.value.status_code == 400
    assert "must use HTTPS" in exc.value.detail


def test_validate_sha256_string():
    """SHA-256 strings must be valid 64-character hexadecimal values."""
    valid_hash = "4b92cbf54a61b8fbc04de90ef9929845d58f33989c565d7764d36ef9662b249b"
    assert validate_sha256_string(valid_hash) == valid_hash

    with pytest.raises(HTTPException) as exc:
        validate_sha256_string("invalid_short_hash")
    assert exc.value.status_code == 400


def test_probe_token_issuance_and_single_use_eviction():
    """Chunk 1 & Chunk 2: Mints 18-byte URL-safe token and guarantees single-use eviction."""
    pkg_id = "Git.Git"
    source = "https://github.com/git-for-windows/git/releases"
    sha = "4b92cbf54a61b8fbc04de90ef9929845d58f33989c565d7764d36ef9662b249b"

    # Mint token
    token = mint_probe_token(pkg_id, source, sha, "2.56.0")
    assert isinstance(token, str)
    assert len(token) >= 24  # 18 bytes base64url is 24 chars
    assert token in _verified_probes

    # First validation succeeds and immediately consumes/evicts token
    assert validate_and_evict_token(token, pkg_id, source) is True
    assert token not in _verified_probes

    # Second validation fails with 403 Forbidden (Single-use guarantee)
    with pytest.raises(HTTPException) as exc:
        validate_and_evict_token(token, pkg_id, source)
    assert exc.value.status_code == 403
    assert "Forbidden" in exc.value.detail


def test_probe_token_blocks_package_substitution():
    """Tokens bound to one package cannot be used for a different package."""
    token = mint_probe_token("Git.Git", "https://trusted.com", "a" * 64)
    with pytest.raises(HTTPException) as exc:
        validate_and_evict_token(token, "Malicious.Package.Trojan")
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_verify_package_manifest_known_catalog():
    """Pre-flight verification succeeds and returns token for catalog item."""
    verdict = await verify_package_manifest(
        package_id="Git.Git",
        source_url="https://github.com/git-for-windows/git/releases",
    )
    assert verdict.verified is True
    assert verdict.probe_token is not None
    assert verdict.expires_in_seconds == 300
    assert "PASSED" in verdict.security_verdict


@pytest.mark.asyncio
async def test_verify_package_manifest_rejects_catalog_hash_mismatch():
    """Supplying a tampered hash for a catalog package must fail with 400 Bad Request."""
    tampered_hash = "0" * 64
    with pytest.raises(HTTPException) as exc:
        await verify_package_manifest(
            package_id="Git.Git",
            source_url="https://github.com/git-for-windows/git/releases",
            sha256_hash=tampered_hash,
        )
    assert exc.value.status_code == 400
    assert "does not match authentic catalog hash" in exc.value.detail


@pytest.mark.asyncio
async def test_verify_package_manifest_requires_hash_for_unknown_package():
    """Uncatalogued package without a SHA-256 hash must be rejected with 400."""
    with pytest.raises(HTTPException) as exc:
        await verify_package_manifest(
            package_id="Custom.Unknown.App",
            source_url="https://example.com/app.exe",
        )
    assert exc.value.status_code == 400
    assert "Explicit SHA-256 manifest hash is required" in exc.value.detail


def test_probe_token_blocks_source_substitution():
    """Tokens bound to source A cannot be consumed with a different source URL."""
    token = mint_probe_token("Git.Git", "https://trusted-site.com/git.exe", "a" * 64)
    with pytest.raises(HTTPException) as exc:
        validate_and_evict_token(token, "Git.Git", "https://untrusted-site.com/git.exe")
    assert exc.value.status_code == 403
    assert "Token bound to source" in exc.value.detail

