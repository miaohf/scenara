import copy
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings as get_app_settings
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.settings import UserSettings
from app.models.user import User
from app.schemas.ai import SettingsResponse, SettingsUpdate
from app.services.model_registry import (
    apply_deployment_overrides,
    build_default_registry,
    is_registry_usable,
    merge_registry,
    sanitize_registry,
)

router = APIRouter(prefix="/v1/settings", tags=["settings"])


async def _resolve_registry_for_user(
    user_id: int,
    db: AsyncSession,
    *,
    persist: bool = True,
) -> dict[str, Any]:
    settings = get_app_settings()
    defaults = build_default_registry(settings)

    result = await db.execute(select(UserSettings).where(UserSettings.user_id == user_id))
    row = result.scalar_one_or_none()

    if row is None or not is_registry_usable(row.model_registry):
        registry = defaults
        if row is None:
            row = UserSettings(user_id=user_id, model_registry=registry)
            db.add(row)
        else:
            row.model_registry = registry
        if persist:
            await db.commit()
            await db.refresh(row)
    else:
        merged = merge_registry(row.model_registry, defaults)
        sanitized, sanitized_changed = sanitize_registry(merged, settings)
        if sanitized_changed:
            merged = sanitized
        if persist and merged != row.model_registry:
            row.model_registry = merged
            await db.commit()
            await db.refresh(row)
        registry = merged

    return apply_deployment_overrides(registry, settings)


@router.get("/models", response_model=SettingsResponse)
async def get_model_settings(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SettingsResponse:
    registry = await _resolve_registry_for_user(current_user.id, db, persist=True)
    result = await db.execute(select(UserSettings).where(UserSettings.user_id == current_user.id))
    row = result.scalar_one_or_none()
    return SettingsResponse(
        model_registry=registry,
        updated_at=row.updated_at.isoformat() if row and row.updated_at else None,
    )


@router.put("/models", response_model=SettingsResponse)
async def update_settings(
    body: SettingsUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SettingsResponse:
    if not is_registry_usable(body.model_registry):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="model_registry 无效，需包含 providers、models 或 activeModels",
        )

    result = await db.execute(select(UserSettings).where(UserSettings.user_id == current_user.id))
    row = result.scalar_one_or_none()
    if row is None:
        row = UserSettings(user_id=current_user.id, model_registry=body.model_registry)
        db.add(row)
    else:
        row.model_registry = body.model_registry
    await db.commit()
    await db.refresh(row)

    registry = apply_deployment_overrides(row.model_registry or {}, get_app_settings())
    return SettingsResponse(
        model_registry=registry,
        updated_at=row.updated_at.isoformat() if row.updated_at else None,
    )
