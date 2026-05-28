import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.settings import UserSettings
from app.models.user import User
from app.schemas.ai import SettingsResponse, SettingsUpdate

router = APIRouter(prefix="/v1/settings", tags=["settings"])


@router.get("/models", response_model=SettingsResponse)
async def get_settings(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SettingsResponse:
    result = await db.execute(select(UserSettings).where(UserSettings.user_id == current_user.id))
    row = result.scalar_one_or_none()
    if not row:
        return SettingsResponse(model_registry={})
    return SettingsResponse(
        model_registry=row.model_registry or {},
        updated_at=row.updated_at.isoformat() if row.updated_at else None,
    )


@router.put("/models", response_model=SettingsResponse)
async def update_settings(
    body: SettingsUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SettingsResponse:
    result = await db.execute(select(UserSettings).where(UserSettings.user_id == current_user.id))
    row = result.scalar_one_or_none()
    if row is None:
        row = UserSettings(user_id=current_user.id, model_registry=body.model_registry)
        db.add(row)
    else:
        row.model_registry = body.model_registry
    await db.commit()
    await db.refresh(row)
    return SettingsResponse(
        model_registry=row.model_registry or {},
        updated_at=row.updated_at.isoformat() if row.updated_at else None,
    )
