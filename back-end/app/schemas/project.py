from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    title: str = Field(default="未命名项目", max_length=255)


class ProjectUpdate(BaseModel):
    title: str | None = None
    character_library: list[Any] | None = None
    scene_library: list[Any] | None = None
    prop_library: list[Any] | None = None
    settings: dict[str, Any] | None = None


class ProjectResponse(BaseModel):
    id: str
    title: str
    character_library: list[Any]
    scene_library: list[Any]
    prop_library: list[Any]
    settings: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SeriesCreate(BaseModel):
    title: str = Field(default="默认系列", max_length=255)
    order_index: int = 0


class SeriesResponse(BaseModel):
    id: str
    project_id: str
    title: str
    order_index: int
    created_at: datetime

    model_config = {"from_attributes": True}


class EpisodeCreate(BaseModel):
    series_id: str
    title: str = Field(default="第 1 集", max_length=255)
    episode_number: int = 1
    payload: dict[str, Any] = Field(default_factory=dict)


class EpisodeUpdate(BaseModel):
    title: str | None = None
    stage: str | None = None
    episode_number: int | None = None
    payload: dict[str, Any] | None = None


class EpisodePayloadPatch(BaseModel):
    """只更新 payload 中给定的顶层键，其余保持不变。

    整集覆盖会把所有角色/关键帧一起重传，是自动保存超限的主因；
    改状态、追加日志这类高频写只需要提交受影响的那几个键。
    """

    payload: dict[str, Any] = Field(default_factory=dict)
    title: str | None = None
    stage: str | None = None
    episode_number: int | None = None


class EpisodeResponse(BaseModel):
    id: str
    project_id: str
    series_id: str
    user_id: int
    episode_number: int
    title: str
    stage: str
    payload: dict[str, Any]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class EpisodeSummaryResponse(BaseModel):
    """剧集列表用摘要，故意不含 payload（可能含定妆图等数 MB～百 MB 数据）。"""

    id: str
    project_id: str
    series_id: str
    user_id: int
    episode_number: int
    title: str
    stage: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MediaUploadRequest(BaseModel):
    filename: str
    content_type: str = "application/octet-stream"


class MediaUploadResponse(BaseModel):
    upload_url: str
    media_key: str
    expires_in: int = 3600
