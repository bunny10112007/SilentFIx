"""AWS Cloud Sandbox API Router."""

from __future__ import annotations

import logging
from fastapi import APIRouter
from app.cloud.aws_sandbox import (
    CloudPretestReport,
    CloudPretestRequest,
    get_all_pretest_runs,
    start_cloud_pretest,
)

logger = logging.getLogger("silentfix.sandbox_route")

router = APIRouter(prefix="/api/sandbox", tags=["sandbox"])


@router.post("/pretest", response_model=CloudPretestReport)
async def trigger_pretest(req: CloudPretestRequest) -> CloudPretestReport:
    """Execute pre-test validation inside isolated AWS CodeBuild container or offline simulation."""
    return await start_cloud_pretest(req)


@router.get("/runs")
async def list_pretest_runs():
    """Retrieve all recent cloud pre-test run reports."""
    runs = get_all_pretest_runs()
    return {"runs": [r.model_dump() for r in runs]}
