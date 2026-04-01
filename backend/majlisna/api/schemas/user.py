from majlisna.api.schemas.shared import BaseModel


class DeleteAccountRequest(BaseModel):
    password: str
