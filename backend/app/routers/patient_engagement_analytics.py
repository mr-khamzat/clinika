"""Engagement analytics — endpoints."""
from datetime import datetime
import uuid
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.core.deps import require_manager
from app.models.user import User
from app.services.engagement_analytics import (
    dashboard_summary,
    login_heatmap,
    retention_cohorts,
    funnel_summary,
    churn_list,
    stuck_in_funnel,
)

router = APIRouter(prefix="/engagement", tags=["engagement-analytics"])


@router.get("/dashboard")
async def get_dashboard(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    return await dashboard_summary(db, current_user.tenant_id)


@router.get("/login-heatmap")
async def get_login_heatmap(
    days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    return {"days": days, "cells": await login_heatmap(db, days)}


@router.get("/retention-cohorts")
async def get_retention_cohorts(
    weeks: int = Query(8, ge=2, le=24),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    return {"weeks": weeks, "cohorts": await retention_cohorts(db, weeks)}


@router.get("/funnel")
async def get_funnel(
    days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    return await funnel_summary(db, current_user.tenant_id, days)


@router.get("/churn-list")
async def get_churn_list(
    days_threshold: int = Query(60, ge=14, le=365),
    limit: int = Query(100, ge=1, le=500),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    return {
        "days_threshold": days_threshold,
        "items": await churn_list(db, current_user.tenant_id, days_threshold, limit),
    }


@router.get("/stuck-in-funnel")
async def get_stuck_in_funnel(
    opens_threshold: int = Query(3, ge=2, le=20),
    limit: int = Query(100, ge=1, le=500),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    return {
        "threshold": opens_threshold,
        "items": await stuck_in_funnel(db, current_user.tenant_id, opens_threshold, limit),
    }
