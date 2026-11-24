"""AWS Cloud Sandbox API Router."""

from __future__ import annotations

import logging
import boto3
from fastapi import APIRouter, HTTPException
from app.cloud.aws_sandbox import (
    CloudPretestReport,
    CloudPretestRequest,
    DEFAULT_AWS_REGION,
    _simulated_runs,
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


@router.get("/status/{run_id:path}")
async def sandbox_build_status(run_id: str) -> dict:
    """Poll status of an active AWS CodeBuild run."""
    run = _simulated_runs.get(run_id)
    aws_build_id = None
    if run and run.get("aws_build_id"):
        aws_build_id = run.get("aws_build_id")
    elif ":" in run_id:
        aws_build_id = run_id

    if not run and not aws_build_id:
        raise HTTPException(status_code=404, detail="Build run not found.")

    if not aws_build_id:
        return {"run_id": run_id, "verdict": run["verdict"]}

    cb = boto3.client("codebuild", region_name=DEFAULT_AWS_REGION)
    res = cb.batch_get_builds(ids=[aws_build_id])
    builds = res.get("builds", [])
    if builds:
        st = builds[0]["buildStatus"]
        if st == "IN_PROGRESS":
            verdict = "RUNNING"
            preset = None
        elif st == "SUCCEEDED":
            verdict = "PASSED"
            preset = None
        else:
            verdict = "NEEDS_COMPAT_SHIM"
            preset = "win7_blurry"

        if run:
            run["verdict"] = verdict
            if preset:
                run["recommended_compat_preset"] = preset
        ret = {"run_id": run_id, "verdict": verdict}
        if preset:
            ret["recommended_compat_preset"] = preset
        return ret

    return {"run_id": run_id, "verdict": run["verdict"] if run else "RUNNING"}
