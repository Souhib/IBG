# CLAUDE.md - IBG Backend

## Overview

FastAPI backend with Socket.IO for real-time multiplayer Islamic board games. Uses SQLModel/SQLAlchemy async for database operations and Redis OM for game state management.

## Development Commands

```bash
cd backend

# Run the server
uv run python main.py                    # Starts on http://localhost:5000

# Code quality
uv run poe lint                          # Ruff lint
uv run poe format                        # Ruff format
uv run poe check                         # All checks (lint + format + type)

# Testing
uv run poe test                          # pytest with coverage
uv run poe test-fast                     # Stop on first failure

# Fake data
PYTHONPATH=. uv run python scripts/generate_fake_data.py --create-db
PYTHONPATH=. uv run python scripts/generate_fake_data.py --delete
```

## Architecture

### API Layer (`ibg/api/`)

```
api/
├── controllers/       # Business logic (async methods)
│   ├── auth.py        # JWT login, register, refresh
│   ├── user.py        # User CRUD
│   ├── room.py        # Room management
│   ├── game.py        # Game lifecycle
│   ├── undercover.py  # Undercover word/term pairs
│   ├── codenames.py   # Codenames words/packs
│   ├── undercover_game.py # Undercover game logic (REST-first)
│   ├── codenames_game.py  # Codenames game logic (REST-first)
│   ├── notification.py    # Socket.IO push notification wrapper
│   ├── stats.py       # User statistics
│   └── achievement.py # Achievement tracking + seeding
├── models/            # SQLModel DB tables ONLY
│   ├── table.py       # User, Room, Game, Event tables
│   ├── relationship.py # Link tables
│   ├── undercover.py  # Word, TermPair tables
│   ├── codenames.py   # CodenamesWord, CodenamesWordPack
│   ├── stats.py       # UserStats, AchievementDefinition, UserAchievement
│   └── shared.py      # DBModel (backward compat)
├── schemas/           # Pydantic request/response models
│   ├── shared.py      # BaseModel, BaseTable (USE THESE)
│   ├── error.py       # Enhanced error classes
│   └── auth.py        # TokenPayload, LoginRequest, etc.
├── routes/            # FastAPI routers (thin, delegate to controllers)
│   ├── auth.py        # /api/v1/auth/*
│   ├── user.py        # /api/v1/users/*
│   ├── room.py        # /api/v1/rooms/*
│   ├── game.py        # /api/v1/games/*
│   ├── undercover.py  # /api/v1/undercover/*
│   ├── codenames.py   # /api/v1/codenames/*
│   └── stats.py       # /api/v1/users/{id}/stats, achievements, leaderboard
├── constants.py       # All magic values
├── middleware.py       # Security, RequestID, Logging
└── services/          # External integrations (future)
```

### Socket.IO Layer (`ibg/socketio/`)

```
socketio/
├── controllers/
│   ├── room.py        # Room join/leave/start
│   └── codenames.py   # Codenames game logic
├── models/
│   ├── shared.py      # IBGSocket (AsyncServer with lazy session)
│   ├── user.py        # Redis user models
│   ├── room.py        # Redis room models
│   └── codenames.py   # Redis codenames game state
└── routes/
    ├── room.py        # Room Socket.IO events
    ├── undercover.py  # Undercover game events (377 lines of game logic)
    ├── codenames.py   # Codenames game events
    └── shared.py      # Shared utilities
```

## Key Patterns

### Base Classes
**CRITICAL: Always use `ibg.api.schemas.shared.BaseModel` and `BaseTable`**, never `pydantic.BaseModel` or `sqlmodel.SQLModel` directly.

```python
from ibg.api.schemas.shared import BaseModel, BaseTable

class UserCreate(BaseModel):     # For schemas
    username: str
    email: str

class User(BaseTable, table=True):  # For DB tables
    __tablename__ = "user"
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    username: str
```

### Async Database Operations
All DB operations MUST be async:

```python
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

class MyController:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_item(self, item_id: UUID):
        result = (await self.session.exec(
            select(Item).where(Item.id == item_id)
        )).first()
        return result
```

### Error Classes
Errors auto-generate i18n keys and log on construction:

```python
from ibg.api.schemas.error import BaseError

class MyCustomError(BaseError):
    def __init__(self, item_id: UUID):
        super().__init__(
            message=f"Item {item_id} not found",
            frontend_message="Item not found.",
            status_code=404,
            details={"item_id": str(item_id)},
        )
# Auto-generates error_key: "errors.api.myCustom"
```

### Dependencies
Use `Annotated` + `Depends` for DI:

```python
from typing import Annotated
from fastapi import Depends
from ibg.dependencies import get_current_user, get_room_controller

async def my_route(
    user: Annotated[User, Depends(get_current_user)],
    controller: Annotated[RoomController, Depends(get_room_controller)],
):
    ...
```

### Routes - NO Logic
Routes delegate everything to controllers:

```python
@router.get("/items/{item_id}")
async def get_item(
    item_id: UUID,
    controller: Annotated[ItemController, Depends(get_item_controller)],
):
    return await controller.get_item(item_id)
```

### Constants
All magic values in `ibg/api/constants.py`:

```python
from ibg.api.constants import MIN_PLAYERS_FOR_GAME, ROOM_PASSWORD_LENGTH
```

## Database Models

| Model | Table | Purpose |
|-------|-------|---------|
| User | user | Player accounts |
| Room | room | Game rooms |
| Game | game | Game sessions |
| Event | event | Game events log |
| Word | word | Undercover words |
| TermPair | term_pair | Undercover word pairs |
| CodenamesWord | codenames_word | Codenames board words |
| CodenamesWordPack | codenames_word_pack | Word pack groupings |
| UserStats | user_stats | Aggregated player statistics |
| AchievementDefinition | achievement_definition | Badge definitions |
| UserAchievement | user_achievement | Earned achievements |

## Environment Configuration

Settings use `IBG_ENV` selector:

| File | Purpose |
|------|---------|
| `.env` | `IBG_ENV=development` (selector) |
| `.env.development` | SQLite, local Redis, dev JWT key |
| `.env.production` | PostgreSQL, Redis service, production keys |
| `.env.example` | Template (committed) |

## API Documentation

- Scalar UI: `http://localhost:5000/scalar`
- OpenAPI JSON: `http://localhost:5000/openapi.json`
- Health check: `http://localhost:5000/health`
