"""One-time migration script to populate hint columns on existing words.

Usage:
    cd backend
    PYTHONPATH=. uv run python scripts/add_hints_to_words.py

This script adds multilingual hint dicts (en, ar, fr) to existing Undercover
words and Codenames words that don't have hints yet. Safe to run multiple
times — it skips words that already have a hint.
"""

import asyncio

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from ipg.api.models.codenames import CodenamesWord
from ipg.api.models.undercover import Word
from ipg.database import get_engine

# ── Undercover word hints (keyed by word) ──

UNDERCOVER_HINTS: dict[str, dict[str, str]] = {
    "Hajj": {
        "en": "The annual pilgrimage to Mecca, one of the five pillars of Islam",
        "ar": "الحج السنوي إلى مكة، أحد أركان الإسلام الخمسة",
        "fr": "Le pèlerinage annuel à La Mecque, l'un des cinq piliers de l'islam",
    },
    "Umrah": {
        "en": "The minor pilgrimage to Mecca, can be performed at any time of year",
        "ar": "العمرة، الحج الأصغر إلى مكة، يمكن أداؤها في أي وقت من السنة",
        "fr": "Le petit pèlerinage à La Mecque, peut être accompli à tout moment de l'année",
    },
    "Salah": {
        "en": "The five daily prayers, the second pillar of Islam",
        "ar": "الصلوات الخمس اليومية، الركن الثاني من أركان الإسلام",
        "fr": "Les cinq prières quotidiennes, le deuxième pilier de l'islam",
    },
    "Sawm": {
        "en": "Fasting from dawn to sunset during Ramadan, the fourth pillar of Islam",
        "ar": "الصيام من الفجر حتى غروب الشمس خلال رمضان، الركن الرابع من أركان الإسلام",
        "fr": "Le jeûne de l'aube au coucher du soleil pendant le Ramadan, le quatrième pilier de l'islam",
    },
    "Zakat": {
        "en": "Obligatory charity — giving a fixed portion of wealth to the needy",
        "ar": "الزكاة — إعطاء نسبة محددة من المال للمحتاجين",
        "fr": "L'aumône obligatoire — donner une part fixe de sa richesse aux nécessiteux",
    },
    "Sadaqah": {
        "en": "Voluntary charity and acts of kindness beyond obligatory giving",
        "ar": "الصدقة التطوعية وأعمال الخير التي تتجاوز العطاء الواجب",
        "fr": "La charité volontaire et les actes de bonté au-delà du don obligatoire",
    },
    "Shahada": {
        "en": "The declaration of faith — 'There is no god but Allah, and Muhammad is His messenger'",
        "ar": "شهادة أن لا إله إلا الله وأن محمداً رسول الله",
        "fr": "La déclaration de foi — 'Il n'y a de dieu qu'Allah et Muhammad est Son messager'",
    },
    "Tawhid": {
        "en": "The fundamental principle of God's oneness and absolute sovereignty",
        "ar": "المبدأ الأساسي لوحدانية الله وسيادته المطلقة",
        "fr": "Le principe fondamental de l'unicité de Dieu et de Sa souveraineté absolue",
    },
    "Jihad": {
        "en": "Struggle and effort in the way of God, including inner spiritual struggle",
        "ar": "الجهاد في سبيل الله، بما في ذلك الجهاد الروحي الداخلي",
        "fr": "L'effort et la lutte dans la voie de Dieu, y compris la lutte spirituelle intérieure",
    },
    "Hijrah": {
        "en": "The Prophet's migration from Mecca to Medina in 622 CE, start of the Islamic calendar",
        "ar": "هجرة النبي من مكة إلى المدينة عام 622 م، بداية التقويم الهجري",
        "fr": "La migration du Prophète de La Mecque à Médine en 622, début du calendrier islamique",
    },
}

# ── Codenames word hints (keyed by word) ──
# Add entries here for any Codenames words that need hints.
# The script will match by word text (case-insensitive).

CODENAMES_HINTS: dict[str, dict[str, str]] = {
    # Example:
    # "Quran": {
    #     "en": "The holy book of Islam, revealed to Prophet Muhammad",
    #     "ar": "القرآن الكريم، الكتاب المقدس للمسلمين",
    #     "fr": "Le livre saint de l'islam, révélé au Prophète Muhammad",
    # },
}


async def migrate_undercover_words(session: AsyncSession) -> int:
    """Add hints to Undercover words that don't have them yet."""
    result = await session.exec(select(Word).where(Word.hint.is_(None)))  # type: ignore[union-attr]
    words = result.all()
    updated = 0
    for word in words:
        hint = UNDERCOVER_HINTS.get(word.word)
        if hint:
            word.hint = hint
            session.add(word)
            updated += 1
    if updated:
        await session.commit()
    return updated


async def migrate_codenames_words(session: AsyncSession) -> int:
    """Add hints to Codenames words that don't have them yet."""
    if not CODENAMES_HINTS:
        return 0
    result = await session.exec(select(CodenamesWord).where(CodenamesWord.hint.is_(None)))  # type: ignore[union-attr]
    words = result.all()
    updated = 0
    for word in words:
        hint = CODENAMES_HINTS.get(word.word)
        if hint:
            word.hint = hint
            session.add(word)
            updated += 1
    if updated:
        await session.commit()
    return updated


async def main() -> None:
    engine = await get_engine()
    async with AsyncSession(engine) as session:
        uc_count = await migrate_undercover_words(session)
        cn_count = await migrate_codenames_words(session)

    print(f"Updated {uc_count} Undercover word(s) with hints.")
    print(f"Updated {cn_count} Codenames word(s) with hints.")
    print("Done.")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
