"""AWS Cloud Sandbox API Router."""

from __future__ import annotations

import logging
import os
from fastapi import APIRouter, HTTPException, status
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
    strict_sandbox = os.getenv("SILENTFIX_STRICT_SANDBOX", "").strip().lower() in ("true", "1", "yes")
    project_name = os.getenv("SILENTFIX_CODEBUILD_PROJECT", "").strip()

    if strict_sandbox and not project_name:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="503 Service Unavailable: AWS CodeBuild is unconfigured and strict sandbox mode is active (SILENTFIX_STRICT_SANDBOX=true). Direct local execution without container verification is blocked.",
        )

    return await start_cloud_pretest(req)


@router.get("/runs")
async def list_pretest_runs():
    """Retrieve all recent cloud pre-test run reports."""
    runs = get_all_pretest_runs()
    return {"runs": [r.model_dump() for r in runs]}
