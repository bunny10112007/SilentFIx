# app/routes/cli_isolator.py
from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field
from app.services.cli_isolator import CliIsolationReport, isolate_broken_cli

router = APIRouter(prefix="/api/cli-isolator", tags=["cli-isolator"])


class CliIsolateRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    error_text: str = Field(min_length=3, max_length=4000)
    project_dir: str | None = Field(default=None, max_length=400)


@router.post("/isolate", response_model=CliIsolationReport)
async def run_cli_isolation(req: CliIsolateRequest) -> CliIsolationReport:
    return await isolate_broken_cli(req.error_text, req.project_dir)
