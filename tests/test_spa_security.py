"""Tests for SPA router security: path traversal defense and API 404 preservation."""

import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app


@pytest.mark.asyncio
async def test_spa_directory_traversal_blocked():
    """Directory traversal sequences in SPA routes must not expose files outside dist/."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Attempt to access sensitive files via path traversal
        resp = await client.get("/../../.env")
        # Should not serve .env content
        assert "AWS_SECRET_ACCESS_KEY" not in resp.text


@pytest.mark.asyncio
async def test_spa_does_not_swallow_api_404():
    """Non-existent API endpoints must return 404, not index.html."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/nonexistent_route_12345")
        assert resp.status_code == 404
        assert resp.json()["detail"] == "API endpoint '/api/nonexistent_route_12345' not found"
