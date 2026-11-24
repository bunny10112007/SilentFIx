"""Tests for Pillar 3: AWS Cloud Pre-Test Sandbox."""

import pytest
import pytest_asyncio
import httpx
from pydantic import ValidationError
from app.main import app
from app.cloud.aws_sandbox import (
    CloudPretestRequest,
    start_cloud_pretest,
)


@pytest_asyncio.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_cloud_pretest_offline_simulation(monkeypatch):
    """When SILENTFIX_CODEBUILD_PROJECT is unset, automatically runs offline simulation."""
    monkeypatch.delenv("SILENTFIX_CODEBUILD_PROJECT", raising=False)
    req = CloudPretestRequest(package_id="Git.Git", source="winget", scope="user")
    report = await start_cloud_pretest(req)

    assert report.package_id == "Git.Git"
    assert report.backend == "offline_simulated"
    assert report.verdict == "UNVERIFIED_SIMULATED"
    assert report.run_id.startswith("sbx_")
    assert "Unverified simulation" in report.summary


def test_cloud_pretest_request_validation():
    """Verify package_id regex validation."""
    valid_req = CloudPretestRequest(package_id="Microsoft.VisualStudioCode")
    assert valid_req.package_id == "Microsoft.VisualStudioCode"

    with pytest.raises(ValidationError):
        # Invalid characters or too short
        CloudPretestRequest(package_id="!!")


@pytest.mark.asyncio
async def test_sandbox_api_endpoints(client):
    """Verify POST /api/sandbox/pretest and GET /api/sandbox/runs."""
    res = await client.post(
        "/api/sandbox/pretest",
        json={"package_id": "OpenJS.NodeJS", "source": "winget", "scope": "user"},
    )
    assert res.status_code == 200
    report = res.json()
    assert report["package_id"] == "OpenJS.NodeJS"
    assert report["verdict"] in ["UNVERIFIED_SIMULATED", "PASSED", "QUEUED"]

    list_res = await client.get("/api/sandbox/runs")
    assert list_res.status_code == 200
    runs = list_res.json()["runs"]
    assert any(r["package_id"] == "OpenJS.NodeJS" for r in runs)
