# app/routes/terminal_assistant.py
from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field
from app.services.terminal_assistant import AssistantGuideResponse, guide_terminal_task

router = APIRouter(prefix="/api/assistant", tags=["terminal-assistant"])


class AssistantTaskRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    task: str = Field(min_length=2, max_length=1500)


@router.post("/guide", response_model=AssistantGuideResponse)
async def terminal_guide(req: AssistantTaskRequest) -> AssistantGuideResponse:
    return await guide_terminal_task(req.task)
