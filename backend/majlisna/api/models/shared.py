from majlisna.api.schemas.shared import BaseModel


class DBModel(BaseModel):
    """Backward-compatible alias for BaseModel.

    All new code should use BaseModel or BaseTable from majlisna.api.schemas.shared directly.
    """

    pass
