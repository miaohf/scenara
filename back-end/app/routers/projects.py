from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.episode import Episode
from app.models.project import Series, SeriesProject
from app.models.user import User
from app.schemas.project import (
    EpisodeCreate,
    EpisodeResponse,
    EpisodeUpdate,
    ProjectCreate,
    ProjectResponse,
    ProjectUpdate,
    SeriesCreate,
    SeriesResponse,
)

router = APIRouter(prefix="/v1", tags=["projects"])


async def _get_owned_project(
    project_id: str,
    user: User,
    db: AsyncSession,
) -> SeriesProject:
    result = await db.execute(
        select(SeriesProject).where(
            SeriesProject.id == project_id,
            SeriesProject.user_id == user.id,
        )
    )
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


@router.get("/projects", response_model=list[ProjectResponse])
async def list_projects(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[SeriesProject]:
    result = await db.execute(
        select(SeriesProject)
        .where(SeriesProject.user_id == current_user.id)
        .order_by(SeriesProject.updated_at.desc())
    )
    return list(result.scalars().all())


@router.post("/projects", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    body: ProjectCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SeriesProject:
    project = SeriesProject(user_id=current_user.id, title=body.title)
    db.add(project)
    await db.flush()

    default_series = Series(project_id=project.id, title="默认系列", order_index=0)
    db.add(default_series)
    await db.flush()

    default_episode = Episode(
        project_id=project.id,
        series_id=default_series.id,
        user_id=current_user.id,
        episode_number=1,
        title="第 1 集",
        stage="script",
        payload={
            "rawScript": "",
            "targetDuration": "60s",
            "language": "中文",
            "visualStyle": "",
            "scriptData": None,
            "shots": [],
            "isParsingScript": False,
            "renderLogs": [],
            "characterRefs": [],
            "sceneRefs": [],
            "propRefs": [],
        },
    )
    db.add(default_episode)
    await db.commit()
    await db.refresh(project)
    return project


@router.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SeriesProject:
    return await _get_owned_project(project_id, current_user, db)


@router.patch("/projects/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    body: ProjectUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SeriesProject:
    project = await _get_owned_project(project_id, current_user, db)
    updates = body.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(project, key, value)
    await db.commit()
    await db.refresh(project)
    return project


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    project = await _get_owned_project(project_id, current_user, db)
    await db.delete(project)
    await db.commit()


@router.get("/projects/{project_id}/series", response_model=list[SeriesResponse])
async def list_series(
    project_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[Series]:
    await _get_owned_project(project_id, current_user, db)
    result = await db.execute(
        select(Series).where(Series.project_id == project_id).order_by(Series.order_index)
    )
    return list(result.scalars().all())


@router.post("/projects/{project_id}/series", response_model=SeriesResponse, status_code=status.HTTP_201_CREATED)
async def create_series(
    project_id: str,
    body: SeriesCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Series:
    await _get_owned_project(project_id, current_user, db)
    series = Series(project_id=project_id, title=body.title, order_index=body.order_index)
    db.add(series)
    await db.commit()
    await db.refresh(series)
    return series


@router.get("/projects/{project_id}/episodes", response_model=list[EpisodeResponse])
async def list_episodes(
    project_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[Episode]:
    await _get_owned_project(project_id, current_user, db)
    result = await db.execute(
        select(Episode)
        .where(Episode.project_id == project_id, Episode.user_id == current_user.id)
        .order_by(Episode.episode_number)
    )
    return list(result.scalars().all())


@router.get("/episodes/{episode_id}", response_model=EpisodeResponse)
async def get_episode(
    episode_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Episode:
    result = await db.execute(
        select(Episode)
        .options(selectinload(Episode.project))
        .where(Episode.id == episode_id, Episode.user_id == current_user.id)
    )
    episode = result.scalar_one_or_none()
    if episode is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Episode not found")
    return episode


@router.post("/projects/{project_id}/episodes", response_model=EpisodeResponse, status_code=status.HTTP_201_CREATED)
async def create_episode(
    project_id: str,
    body: EpisodeCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Episode:
    await _get_owned_project(project_id, current_user, db)

    series_result = await db.execute(
        select(Series).where(Series.id == body.series_id, Series.project_id == project_id)
    )
    if series_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid series_id")

    episode = Episode(
        project_id=project_id,
        series_id=body.series_id,
        user_id=current_user.id,
        title=body.title,
        episode_number=body.episode_number,
        payload=body.payload,
    )
    db.add(episode)
    await db.commit()
    await db.refresh(episode)
    return episode


@router.patch("/episodes/{episode_id}", response_model=EpisodeResponse)
async def update_episode(
    episode_id: str,
    body: EpisodeUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Episode:
    result = await db.execute(
        select(Episode).where(Episode.id == episode_id, Episode.user_id == current_user.id)
    )
    episode = result.scalar_one_or_none()
    if episode is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Episode not found")

    updates = body.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(episode, key, value)
    await db.commit()
    await db.refresh(episode)
    return episode


@router.delete("/episodes/{episode_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_episode(
    episode_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    result = await db.execute(
        select(Episode).where(Episode.id == episode_id, Episode.user_id == current_user.id)
    )
    episode = result.scalar_one_or_none()
    if episode is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Episode not found")
    await db.delete(episode)
    await db.commit()
