#!/usr/bin/env python3
"""Script to generate fake data for IPG platform testing.

This script can be used to:
1. Create database tables and generate fake users, rooms, games, and seed data
2. Delete all data from the database (drop and recreate tables)
3. Seed Undercover word pairs (30+ Islamic term pairs)
4. Seed Codenames word packs (100+ Islamic terms in categories)
5. Seed achievement/challenge definitions
6. Create UserStats, UserAchievements, UserChallenges for test users
7. Create friendships and chat messages

Usage:
    # Create database tables and generate fake data
    PYTHONPATH=. uv run python scripts/generate_fake_data.py --create-db
    PYTHONPATH=. uv run python scripts/generate_fake_data.py -c

    # Delete all data from the database
    PYTHONPATH=. uv run python scripts/generate_fake_data.py --delete
    PYTHONPATH=. uv run python scripts/generate_fake_data.py -d

    # Seed game content only (safe for production)
    PYTHONPATH=. uv run python scripts/generate_fake_data.py --seed
    PYTHONPATH=. uv run python scripts/generate_fake_data.py -s

    # Custom data volumes
    PYTHONPATH=. uv run python scripts/generate_fake_data.py -c --users 50 --games 100

Options:
    --delete, -d         Delete all data by dropping and recreating tables
    --create-db, -c      Create tables and generate fake data
    --seed, -s           Seed game content only (safe for production)
    --users N            Number of additional random users to generate (default: 15)
    --games N            Number of games to generate (default: 30)

Note:
    You must use exactly ONE of: --delete or --create-db.
    These flags are mutually exclusive.
"""

import argparse
import asyncio
import random
import string
import sys
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncEngine
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ipg.api.controllers.achievement import AchievementController
from ipg.api.controllers.challenge import ChallengeController
from ipg.api.controllers.shared import get_password_hash
from ipg.api.models.challenge import ChallengeDefinition, ChallengeType, UserChallenge
from ipg.api.models.chat import ChatMessage
from ipg.api.models.codenames import CodenamesWord, CodenamesWordPack
from ipg.api.models.friendship import Friendship, FriendshipStatus
from ipg.api.models.game import GameType
from ipg.api.models.room import RoomStatus, RoomType
from ipg.api.models.stats import AchievementDefinition, UserAchievement, UserStats
from ipg.api.models.table import Game, Room, User
from ipg.api.models.undercover import TermPair, Word
from ipg.database import create_app_engine, create_db_and_tables
from ipg.settings import Settings

# Lazy imports for dev-only dependencies (not in production image)
fake = None  # type: ignore[assignment]


# ── Test user accounts ──────────────────────────────────────────────────────

TEST_USERS = [
    {
        "username": "admin",
        "email_address": "admin@test.com",
        "password": "admin123",
        "country": "SAU",
        "bio": "Platform admin. Love organizing game nights!",
    },
    {
        "username": "user",
        "email_address": "user@test.com",
        "password": "user1234",
        "country": "ARE",
        "bio": "Casual player, always up for a round.",
    },
    {
        "username": "player",
        "email_address": "player@test.com",
        "password": "player123",
        "country": "MAR",
    },
    {
        "username": "ali",
        "email_address": "ali@test.com",
        "password": "ali12345",
        "country": "EGY",
        "bio": "Undercover champion. Try to catch me!",
    },
    {
        "username": "fatima",
        "email_address": "fatima@test.com",
        "password": "fatima12",
        "country": "TUN",
        "bio": "Spymaster extraordinaire.",
    },
    {
        "username": "omar",
        "email_address": "omar@test.com",
        "password": "omar1234",
        "country": "DZA",
    },
    {
        "username": "aisha",
        "email_address": "aisha@test.com",
        "password": "aisha123",
        "country": "JOR",
        "bio": "Here for the fun and the community.",
    },
    {
        "username": "yusuf",
        "email_address": "yusuf@test.com",
        "password": "yusuf123",
        "country": "TUR",
    },
    {
        "username": "maryam",
        "email_address": "maryam@test.com",
        "password": "maryam12",
        "country": "MYS",
        "bio": "Codenames is my favourite!",
    },
    {
        "username": "hamza",
        "email_address": "hamza@test.com",
        "password": "hamza123",
        "country": "PAK",
    },
    # Pool B accounts (for parallel E2E test execution)
    {
        "username": "user_b",
        "email_address": "user_b@test.com",
        "password": "user1234",
        "country": "ARE",
    },
    {
        "username": "player_b",
        "email_address": "player_b@test.com",
        "password": "player123",
        "country": "MAR",
    },
    {
        "username": "ali_b",
        "email_address": "ali_b@test.com",
        "password": "ali12345",
        "country": "EGY",
    },
    {
        "username": "fatima_b",
        "email_address": "fatima_b@test.com",
        "password": "fatima12",
        "country": "TUN",
    },
    {
        "username": "omar_b",
        "email_address": "omar_b@test.com",
        "password": "omar1234",
        "country": "DZA",
    },
    {
        "username": "aisha_b",
        "email_address": "aisha_b@test.com",
        "password": "aisha123",
        "country": "JOR",
    },
]


# ── Undercover word pairs (30+ Islamic term pairs) ──────────────────────────

UNDERCOVER_WORDS = [
    # Pillars of Islam
    {
        "word": "Hajj",
        "category": "Pillars of Islam",
        "short_description": "Pilgrimage to Mecca",
        "long_description": "The fifth pillar of Islam requiring able Muslims to make a pilgrimage to Mecca at least once.",
        "hint": {
            "en": "The annual pilgrimage to Mecca, one of the five pillars of Islam",
            "ar": "الحج السنوي إلى مكة، أحد أركان الإسلام الخمسة",
            "fr": "Le pèlerinage annuel à La Mecque, l'un des cinq piliers de l'islam",
        },
    },
    {
        "word": "Umrah",
        "category": "Islamic Rituals",
        "short_description": "Minor pilgrimage to Mecca",
        "long_description": "A voluntary pilgrimage to Mecca that can be performed at any time of the year.",
        "hint": {
            "en": "The minor pilgrimage to Mecca, can be performed at any time of year",
            "ar": "العمرة، الحج الأصغر إلى مكة، يمكن أداؤها في أي وقت من السنة",
            "fr": "Le petit pèlerinage à La Mecque, peut être accompli à tout moment de l'année",
        },
    },
    {
        "word": "Salah",
        "category": "Pillars of Islam",
        "short_description": "Islamic ritual prayer",
        "long_description": "The second pillar of Islam consisting of five daily prayers obligatory for all adult Muslims.",
        "hint": {
            "en": "The five daily prayers, the second pillar of Islam",
            "ar": "الصلوات الخمس اليومية، الركن الثاني من أركان الإسلام",
            "fr": "Les cinq prières quotidiennes, le deuxième pilier de l'islam",
        },
    },
    {
        "word": "Sawm",
        "category": "Pillars of Islam",
        "short_description": "Fasting during Ramadan",
        "long_description": "The fourth pillar of Islam observed during Ramadan where Muslims fast from dawn until sunset.",
        "hint": {
            "en": "Fasting from dawn to sunset during Ramadan, the fourth pillar of Islam",
            "ar": "الصيام من الفجر حتى غروب الشمس خلال رمضان، الركن الرابع من أركان الإسلام",
            "fr": "Le jeûne de l'aube au coucher du soleil pendant le Ramadan, le quatrième pilier de l'islam",
        },
    },
    {
        "word": "Zakat",
        "category": "Pillars of Islam",
        "short_description": "Compulsory charity",
        "long_description": "The third pillar of Islam requiring Muslims to give a fixed portion of their wealth to the needy.",
        "hint": {
            "en": "Obligatory charity — giving a fixed portion of wealth to the needy",
            "ar": "الزكاة — إعطاء نسبة محددة من المال للمحتاجين",
            "fr": "L'aumône obligatoire — donner une part fixe de sa richesse aux nécessiteux",
        },
    },
    {
        "word": "Sadaqah",
        "category": "Charitable Practices",
        "short_description": "Voluntary charity",
        "long_description": "Voluntary charitable acts extending beyond monetary donations to include acts of kindness.",
        "hint": {
            "en": "Voluntary charity and acts of kindness beyond obligatory giving",
            "ar": "الصدقة التطوعية وأعمال الخير التي تتجاوز العطاء الواجب",
            "fr": "La charité volontaire et les actes de bonté au-delà du don obligatoire",
        },
    },
    {
        "word": "Shahada",
        "category": "Pillars of Islam",
        "short_description": "Declaration of faith",
        "long_description": "The first pillar of Islam expressing faith in the oneness of Allah and prophethood of Muhammad.",
        "hint": {
            "en": "The declaration of faith — 'There is no god but Allah, and Muhammad is His messenger'",
            "ar": "شهادة أن لا إله إلا الله وأن محمداً رسول الله",
            "fr": "La déclaration de foi — 'Il n'y a de dieu qu'Allah et Muhammad est Son messager'",
        },
    },
    {
        "word": "Tawhid",
        "category": "Islamic Beliefs",
        "short_description": "Oneness of God",
        "long_description": "The principle of monotheism in Islam affirming the oneness and absolute sovereignty of God.",
        "hint": {
            "en": "The fundamental principle of God's oneness and absolute sovereignty",
            "ar": "المبدأ الأساسي لوحدانية الله وسيادته المطلقة",
            "fr": "Le principe fondamental de l'unicité de Dieu et de Sa souveraineté absolue",
        },
    },
    # Prophets and figures
    {
        "word": "Ibrahim",
        "category": "Prophets",
        "short_description": "Prophet Abraham in Islam",
        "long_description": "Prophet Ibrahim (Abraham) is considered the father of monotheism and a key prophet in Islam.",
        "hint": {
            "en": "Prophet Abraham, the father of monotheism and a key prophet in Islam",
            "ar": "النبي إبراهيم، أبو الأنبياء ورمز التوحيد في الإسلام",
            "fr": "Le prophète Abraham, père du monothéisme et prophète majeur de l'islam",
        },
    },
    {
        "word": "Ismail",
        "category": "Prophets",
        "short_description": "Prophet Ishmael in Islam",
        "long_description": "Prophet Ismail (Ishmael), son of Ibrahim, is regarded as a prophet and ancestor of the Arab people.",
        "hint": {
            "en": "Prophet Ishmael, son of Ibrahim and ancestor of the Arab people",
            "ar": "النبي إسماعيل، ابن إبراهيم وجد العرب",
            "fr": "Le prophète Ismaël, fils d'Ibrahim et ancêtre du peuple arabe",
        },
    },
    {
        "word": "Musa",
        "category": "Prophets",
        "short_description": "Prophet Moses in Islam",
        "long_description": "Prophet Musa (Moses) is one of the most frequently mentioned prophets in the Quran.",
        "hint": {
            "en": "Prophet Moses, one of the most mentioned prophets in the Quran",
            "ar": "النبي موسى، من أكثر الأنبياء ذكراً في القرآن الكريم",
            "fr": "Le prophète Moïse, l'un des prophètes les plus mentionnés dans le Coran",
        },
    },
    {
        "word": "Isa",
        "category": "Prophets",
        "short_description": "Prophet Jesus in Islam",
        "long_description": "Prophet Isa (Jesus) is a revered prophet in Islam, born miraculously to Maryam.",
        "hint": {
            "en": "Prophet Jesus, a revered prophet in Islam born miraculously to Maryam",
            "ar": "النبي عيسى، نبي مبجل في الإسلام ولد بمعجزة لمريم",
            "fr": "Le prophète Jésus, un prophète vénéré en islam né miraculeusement de Maryam",
        },
    },
    {
        "word": "Maryam",
        "category": "Islamic Figures",
        "short_description": "Mother of Prophet Isa",
        "long_description": "Maryam (Mary) is the only woman mentioned by name in the Quran, revered for her piety.",
        "hint": {
            "en": "Mary, the only woman mentioned by name in the Quran, mother of Prophet Isa",
            "ar": "مريم، المرأة الوحيدة المذكورة بالاسم في القرآن، أم النبي عيسى",
            "fr": "Marie, la seule femme mentionnée par son nom dans le Coran, mère du prophète Jésus",
        },
    },
    {
        "word": "Khadijah",
        "category": "Islamic Figures",
        "short_description": "First wife of the Prophet",
        "long_description": "Khadijah bint Khuwaylid was the first wife of Prophet Muhammad and the first person to accept Islam.",
        "hint": {
            "en": "First wife of Prophet Muhammad and the first person to accept Islam",
            "ar": "خديجة بنت خويلد، أولى زوجات النبي محمد وأول من أسلم",
            "fr": "Première épouse du Prophète Muhammad et première personne à accepter l'islam",
        },
    },
    # Places
    {
        "word": "Masjid",
        "category": "Islamic Places",
        "short_description": "Place of worship",
        "long_description": "A masjid (mosque) is a place of worship for Muslims, used for daily prayers and community gatherings.",
        "hint": {
            "en": "A mosque — the place of worship for Muslims, used for prayers and gatherings",
            "ar": "المسجد — مكان العبادة للمسلمين، يُستخدم للصلاة والتجمعات",
            "fr": "Une mosquée — le lieu de culte des musulmans, utilisé pour les prières et les rassemblements",
        },
    },
    {
        "word": "Mihrab",
        "category": "Islamic Architecture",
        "short_description": "Prayer niche in a mosque",
        "long_description": "The mihrab is a semicircular niche in the wall of a mosque that indicates the direction of Mecca.",
        "hint": {
            "en": "A semicircular niche in a mosque wall indicating the direction of Mecca",
            "ar": "محراب — تجويف نصف دائري في جدار المسجد يشير إلى اتجاه مكة",
            "fr": "Une niche semi-circulaire dans le mur d'une mosquée indiquant la direction de La Mecque",
        },
    },
    {
        "word": "Minbar",
        "category": "Islamic Architecture",
        "short_description": "Pulpit in a mosque",
        "long_description": "The minbar is a raised platform or pulpit in a mosque where the imam delivers the Friday sermon.",
        "hint": {
            "en": "A raised pulpit in a mosque where the imam delivers the Friday sermon",
            "ar": "المنبر — منصة مرتفعة في المسجد يلقي منها الإمام خطبة الجمعة",
            "fr": "Une chaire surélevée dans une mosquée où l'imam prononce le sermon du vendredi",
        },
    },
    {
        "word": "Minaret",
        "category": "Islamic Architecture",
        "short_description": "Tower of a mosque",
        "long_description": "A minaret is a tower from which the call to prayer (adhan) is traditionally broadcast.",
        "hint": {
            "en": "A tower from which the call to prayer is traditionally broadcast",
            "ar": "المئذنة — برج يُرفع منه الأذان تقليدياً",
            "fr": "Une tour d'où l'appel à la prière est traditionnellement lancé",
        },
    },
    {
        "word": "Kaaba",
        "category": "Islamic Places",
        "short_description": "Sacred cube structure in Mecca",
        "long_description": "The Kaaba is the most sacred site in Islam, located in the center of Masjid al-Haram in Mecca.",
        "hint": {
            "en": "The most sacred site in Islam, a cube structure at the center of Masjid al-Haram in Mecca",
            "ar": "الكعبة المشرفة — أقدس موقع في الإسلام، في وسط المسجد الحرام بمكة",
            "fr": "Le site le plus sacré de l'islam, une structure cubique au centre de Masjid al-Haram à La Mecque",
        },
    },
    {
        "word": "Medina",
        "category": "Islamic Places",
        "short_description": "City of the Prophet",
        "long_description": "Medina is the second holiest city in Islam where Prophet Muhammad migrated to and is buried.",
        "hint": {
            "en": "The second holiest city in Islam where the Prophet migrated to and is buried",
            "ar": "المدينة المنورة — ثاني أقدس مدينة في الإسلام حيث هاجر النبي ودُفن فيها",
            "fr": "La deuxième ville la plus sainte de l'islam où le Prophète a émigré et est enterré",
        },
    },
    # Concepts
    {
        "word": "Tawakkul",
        "category": "Islamic Concepts",
        "short_description": "Trust in God",
        "long_description": "Tawakkul is the Islamic concept of placing complete trust and reliance in God's plan.",
        "hint": {
            "en": "The Islamic concept of placing complete trust and reliance in God's plan",
            "ar": "التوكل على الله — الاعتماد الكامل على الله والثقة بتدبيره",
            "fr": "Le concept islamique de placer sa confiance totale en le plan de Dieu",
        },
    },
    {
        "word": "Sabr",
        "category": "Islamic Concepts",
        "short_description": "Patience",
        "long_description": "Sabr is the virtue of patience and perseverance in the face of hardship, a core Islamic concept.",
        "hint": {
            "en": "The virtue of patience and perseverance in the face of hardship",
            "ar": "الصبر — فضيلة التحمل والمثابرة في مواجهة الشدائد",
            "fr": "La vertu de patience et de persévérance face aux épreuves",
        },
    },
    {
        "word": "Shukr",
        "category": "Islamic Concepts",
        "short_description": "Gratitude",
        "long_description": "Shukr is the practice of showing gratitude to Allah for blessings, both in words and actions.",
        "hint": {
            "en": "The practice of showing gratitude to Allah for blessings, in words and actions",
            "ar": "الشكر — إظهار الامتنان لله على النعم بالقول والفعل",
            "fr": "La pratique de la gratitude envers Allah pour Ses bienfaits, en paroles et en actes",
        },
    },
    {
        "word": "Taqwa",
        "category": "Islamic Concepts",
        "short_description": "God-consciousness",
        "long_description": "Taqwa is the awareness of God in all aspects of life, often translated as piety or mindfulness.",
        "hint": {
            "en": "Awareness of God in all aspects of life, often translated as piety or mindfulness",
            "ar": "التقوى — الوعي بالله في جميع جوانب الحياة",
            "fr": "La conscience de Dieu dans tous les aspects de la vie, souvent traduite par piété",
        },
    },
    {
        "word": "Ihsan",
        "category": "Islamic Concepts",
        "short_description": "Excellence in worship",
        "long_description": "Ihsan means to worship Allah as if you see Him, and if you cannot see Him, He sees you.",
        "hint": {
            "en": "Excellence in worship — to worship Allah as if you see Him",
            "ar": "الإحسان — أن تعبد الله كأنك تراه، فإن لم تكن تراه فإنه يراك",
            "fr": "L'excellence dans l'adoration — adorer Allah comme si tu Le voyais",
        },
    },
    {
        "word": "Iman",
        "category": "Islamic Beliefs",
        "short_description": "Faith",
        "long_description": "Iman encompasses belief in God, His angels, His books, His messengers, the Last Day, and divine decree.",
        "hint": {
            "en": "Faith encompassing belief in God, angels, holy books, messengers, the Last Day, and divine decree",
            "ar": "الإيمان — التصديق بالله وملائكته وكتبه ورسله واليوم الآخر والقدر",
            "fr": "La foi englobant la croyance en Dieu, Ses anges, Ses livres, Ses messagers, le Jour dernier et le destin",
        },
    },
    {
        "word": "Jihad",
        "category": "Islamic Concepts",
        "short_description": "Struggle in God's way",
        "long_description": "Jihad represents struggle against evil inclinations and effort in the way of God.",
        "hint": {
            "en": "Struggle and effort in the way of God, including inner spiritual struggle",
            "ar": "الجهاد في سبيل الله، بما في ذلك الجهاد الروحي الداخلي",
            "fr": "L'effort et la lutte dans la voie de Dieu, y compris la lutte spirituelle intérieure",
        },
    },
    {
        "word": "Hijrah",
        "category": "Islamic History",
        "short_description": "Migration to Medina",
        "long_description": "The Hijrah is the migration of Prophet Muhammad from Mecca to Medina in 622 CE.",
        "hint": {
            "en": "The Prophet's migration from Mecca to Medina in 622 CE, start of the Islamic calendar",
            "ar": "هجرة النبي من مكة إلى المدينة عام 622 م، بداية التقويم الهجري",
            "fr": "La migration du Prophète de La Mecque à Médine en 622, début du calendrier islamique",
        },
    },
    # Practices
    {
        "word": "Wudu",
        "category": "Islamic Practices",
        "short_description": "Ablution before prayer",
        "long_description": "Wudu is the ritual washing performed by Muslims before prayer to achieve physical and spiritual purity.",
        "hint": {
            "en": "Ritual washing performed before prayer for physical and spiritual purity",
            "ar": "الوضوء — الغسل الطقسي قبل الصلاة لتحقيق الطهارة الجسدية والروحية",
            "fr": "L'ablution rituelle effectuée avant la prière pour la pureté physique et spirituelle",
        },
    },
    {
        "word": "Tayammum",
        "category": "Islamic Practices",
        "short_description": "Dry ablution",
        "long_description": "Tayammum is the Islamic act of dry ablution using clean earth when water is unavailable.",
        "hint": {
            "en": "Dry ablution using clean earth or sand when water is unavailable",
            "ar": "التيمم — الطهارة الجافة باستخدام التراب النظيف عند عدم توفر الماء",
            "fr": "L'ablution sèche utilisant de la terre propre lorsque l'eau n'est pas disponible",
        },
    },
    {
        "word": "Adhan",
        "category": "Islamic Practices",
        "short_description": "Call to prayer",
        "long_description": "The adhan is the Islamic call to prayer recited by the muezzin from the mosque five times daily.",
        "hint": {
            "en": "The Islamic call to prayer recited by the muezzin five times daily",
            "ar": "الأذان — النداء للصلاة الذي يرفعه المؤذن خمس مرات يومياً",
            "fr": "L'appel islamique à la prière récité par le muezzin cinq fois par jour",
        },
    },
    {
        "word": "Iqamah",
        "category": "Islamic Practices",
        "short_description": "Second call to prayer",
        "long_description": "The iqamah is the second call to prayer given immediately before the congregational prayer begins.",
        "hint": {
            "en": "The second call to prayer given just before the congregational prayer starts",
            "ar": "الإقامة — النداء الثاني للصلاة قبل بدء صلاة الجماعة مباشرة",
            "fr": "Le second appel à la prière donné juste avant le début de la prière en congrégation",
        },
    },
    {
        "word": "Dhikr",
        "category": "Islamic Practices",
        "short_description": "Remembrance of God",
        "long_description": "Dhikr is the devotional act of remembering God through phrases, prayers, or meditation.",
        "hint": {
            "en": "The devotional act of remembering God through phrases, prayers, or meditation",
            "ar": "الذكر — العبادة التأملية لذكر الله بالتسبيح والدعاء والتأمل",
            "fr": "L'acte dévotionnel de se souvenir de Dieu par des phrases, prières ou méditation",
        },
    },
    {
        "word": "Dua",
        "category": "Islamic Practices",
        "short_description": "Supplication",
        "long_description": "Dua is the act of supplication or personal prayer where Muslims directly communicate with God.",
        "hint": {
            "en": "Personal supplication or prayer where Muslims directly communicate with God",
            "ar": "الدعاء — التضرع الشخصي حيث يتواصل المسلم مباشرة مع الله",
            "fr": "La supplication personnelle où les musulmans communiquent directement avec Dieu",
        },
    },
    {
        "word": "Quran",
        "category": "Islamic Texts",
        "short_description": "Holy book of Islam",
        "long_description": "The Quran is the central religious text of Islam believed to be the direct word of God.",
        "hint": {
            "en": "The holy book of Islam, believed to be the direct word of God revealed to Prophet Muhammad",
            "ar": "القرآن الكريم — كلام الله المنزل على النبي محمد",
            "fr": "Le livre saint de l'islam, considéré comme la parole directe de Dieu révélée au Prophète Muhammad",
        },
    },
    {
        "word": "Hadith",
        "category": "Islamic Texts",
        "short_description": "Prophetic traditions",
        "long_description": "Hadiths are records of the sayings, actions, and approvals of Prophet Muhammad.",
        "hint": {
            "en": "Records of the sayings, actions, and approvals of Prophet Muhammad",
            "ar": "الأحاديث — سجلات أقوال وأفعال وتقريرات النبي محمد",
            "fr": "Les récits des paroles, actes et approbations du Prophète Muhammad",
        },
    },
    {
        "word": "Sunnah",
        "category": "Islamic Practices",
        "short_description": "Prophetic tradition and way of life",
        "long_description": "The Sunnah refers to the practices and teachings of Prophet Muhammad as a model for Muslims.",
        "hint": {
            "en": "The practices and teachings of Prophet Muhammad as a model for Muslim life",
            "ar": "السنة النبوية — ممارسات وتعاليم النبي محمد كنموذج للمسلمين",
            "fr": "Les pratiques et enseignements du Prophète Muhammad comme modèle de vie musulmane",
        },
    },
    {
        "word": "Fiqh",
        "category": "Islamic Sciences",
        "short_description": "Islamic jurisprudence",
        "long_description": "Fiqh is the body of Islamic jurisprudence dealing with the observance of rituals, morals, and social legislation.",
        "hint": {
            "en": "Islamic jurisprudence dealing with rituals, morals, and social legislation",
            "ar": "الفقه — علم الشريعة الإسلامية المتعلق بالعبادات والأخلاق والتشريعات",
            "fr": "La jurisprudence islamique traitant des rituels, de la morale et de la législation sociale",
        },
    },
    # Food and daily life
    {
        "word": "Halal",
        "category": "Islamic Law",
        "short_description": "Permissible",
        "long_description": "Halal refers to what is permissible under Islamic law, commonly used in reference to food.",
        "hint": {
            "en": "What is permissible under Islamic law, commonly used in reference to food",
            "ar": "الحلال — ما هو مباح في الشريعة الإسلامية، يُستخدم عادة للإشارة إلى الطعام",
            "fr": "Ce qui est permis par la loi islamique, couramment utilisé en référence à la nourriture",
        },
    },
    {
        "word": "Haram",
        "category": "Islamic Law",
        "short_description": "Forbidden",
        "long_description": "Haram refers to anything that is forbidden under Islamic law.",
        "hint": {
            "en": "Anything that is forbidden or prohibited under Islamic law",
            "ar": "الحرام — كل ما هو محظور في الشريعة الإسلامية",
            "fr": "Tout ce qui est interdit ou prohibé par la loi islamique",
        },
    },
    {
        "word": "Iftar",
        "category": "Ramadan",
        "short_description": "Breaking the fast",
        "long_description": "Iftar is the meal eaten by Muslims after sunset during Ramadan to break the daily fast.",
        "hint": {
            "en": "The meal eaten after sunset during Ramadan to break the daily fast",
            "ar": "الإفطار — الوجبة التي يتناولها المسلمون بعد غروب الشمس في رمضان",
            "fr": "Le repas pris après le coucher du soleil pendant le Ramadan pour rompre le jeûne",
        },
    },
    {
        "word": "Suhoor",
        "category": "Ramadan",
        "short_description": "Pre-dawn meal",
        "long_description": "Suhoor is the pre-dawn meal consumed by Muslims before beginning the fast during Ramadan.",
        "hint": {
            "en": "The pre-dawn meal consumed before beginning the daily fast during Ramadan",
            "ar": "السحور — الوجبة قبل الفجر التي يتناولها المسلمون قبل بدء الصيام في رمضان",
            "fr": "Le repas pré-aube consommé avant de commencer le jeûne quotidien pendant le Ramadan",
        },
    },
    # Special times and events
    {
        "word": "Laylat al-Qadr",
        "category": "Islamic Events",
        "short_description": "Night of Power",
        "long_description": "Laylat al-Qadr is the most sacred night in Islam, believed to be when the Quran was first revealed.",
        "hint": {
            "en": "The most sacred night in Islam, when the Quran was first revealed — better than a thousand months",
            "ar": "ليلة القدر — أقدس ليلة في الإسلام، نزل فيها القرآن، خير من ألف شهر",
            "fr": "La nuit la plus sacrée de l'islam, quand le Coran fut révélé — meilleure que mille mois",
        },
    },
    {
        "word": "Eid al-Fitr",
        "category": "Islamic Holidays",
        "short_description": "Festival of breaking the fast",
        "long_description": "Eid al-Fitr marks the end of Ramadan and is celebrated with prayers, feasts, and giving.",
        "hint": {
            "en": "The festival marking the end of Ramadan, celebrated with prayers, feasts, and charity",
            "ar": "عيد الفطر — العيد الذي يختتم شهر رمضان، يُحتفل به بالصلاة والولائم والصدقة",
            "fr": "La fête marquant la fin du Ramadan, célébrée avec prières, festins et charité",
        },
    },
    {
        "word": "Eid al-Adha",
        "category": "Islamic Holidays",
        "short_description": "Festival of sacrifice",
        "long_description": "Eid al-Adha commemorates Ibrahim's willingness to sacrifice his son and concludes the Hajj.",
        "hint": {
            "en": "The festival of sacrifice commemorating Ibrahim's willingness to sacrifice his son",
            "ar": "عيد الأضحى — يُحيي ذكرى استعداد إبراهيم للتضحية بابنه ويختتم موسم الحج",
            "fr": "La fête du sacrifice commémorant la volonté d'Ibrahim de sacrifier son fils",
        },
    },
    {
        "word": "Jummah",
        "category": "Islamic Practices",
        "short_description": "Friday congregational prayer",
        "long_description": "Jummah is the congregational prayer held every Friday, the most important prayer of the week.",
        "hint": {
            "en": "The congregational prayer held every Friday, the most important prayer of the week",
            "ar": "صلاة الجمعة — الصلاة الجماعية كل يوم جمعة، أهم صلاة في الأسبوع",
            "fr": "La prière en congrégation tenue chaque vendredi, la plus importante prière de la semaine",
        },
    },
]

# Word pairs (each pair contains two related but different Islamic terms)
UNDERCOVER_WORD_PAIRS = [
    ("Hajj", "Umrah"),
    ("Salah", "Sawm"),
    ("Zakat", "Sadaqah"),
    ("Shahada", "Tawhid"),
    ("Jihad", "Hijrah"),
    ("Ibrahim", "Ismail"),
    ("Musa", "Isa"),
    ("Maryam", "Khadijah"),
    ("Masjid", "Mihrab"),
    ("Minbar", "Minaret"),
    ("Kaaba", "Medina"),
    ("Tawakkul", "Sabr"),
    ("Shukr", "Taqwa"),
    ("Ihsan", "Iman"),
    ("Wudu", "Tayammum"),
    ("Adhan", "Iqamah"),
    ("Dhikr", "Dua"),
    ("Quran", "Hadith"),
    ("Sunnah", "Fiqh"),
    ("Halal", "Haram"),
    ("Iftar", "Suhoor"),
    ("Eid al-Fitr", "Eid al-Adha"),
    ("Laylat al-Qadr", "Jummah"),
    ("Salah", "Dua"),
    ("Zakat", "Hajj"),
    ("Quran", "Sunnah"),
    ("Sabr", "Shukr"),
    ("Taqwa", "Ihsan"),
    ("Masjid", "Kaaba"),
    ("Wudu", "Salah"),
    ("Ibrahim", "Musa"),
    ("Adhan", "Jummah"),
]


# ── Codenames word packs (100+ Islamic terms in categories) ─────────────────

CODENAMES_WORD_PACKS: dict[str, list[dict[str, str | dict[str, str]]]] = {
    "Prophets & Messengers": [
        {"word": "Adam", "hint": {"en": "The first human and prophet created by Allah", "ar": "أول إنسان ونبي خلقه الله", "fr": "Le premier humain et prophète créé par Allah"}},
        {"word": "Nuh", "hint": {"en": "Prophet Noah, who built the Ark to survive the great flood", "ar": "النبي نوح، الذي بنى السفينة للنجاة من الطوفان العظيم", "fr": "Le prophète Noé, qui construisit l'Arche pour survivre au déluge"}},
        {"word": "Ibrahim", "hint": {"en": "Prophet Abraham, father of monotheism", "ar": "النبي إبراهيم، أبو الأنبياء ورمز التوحيد", "fr": "Le prophète Abraham, père du monothéisme"}},
        {"word": "Ismail", "hint": {"en": "Prophet Ishmael, son of Ibrahim and ancestor of the Arabs", "ar": "النبي إسماعيل، ابن إبراهيم وجد العرب", "fr": "Le prophète Ismaël, fils d'Ibrahim et ancêtre des Arabes"}},
        {"word": "Ishaq", "hint": {"en": "Prophet Isaac, son of Ibrahim and father of Yaqub", "ar": "النبي إسحاق، ابن إبراهيم وأبو يعقوب", "fr": "Le prophète Isaac, fils d'Ibrahim et père de Yaqub"}},
        {"word": "Yaqub", "hint": {"en": "Prophet Jacob, also known as Israel, father of the twelve tribes", "ar": "النبي يعقوب، المعروف أيضاً بإسرائيل، أبو الأسباط الاثني عشر", "fr": "Le prophète Jacob, aussi connu comme Israël, père des douze tribus"}},
        {"word": "Yusuf", "hint": {"en": "Prophet Joseph, known for his beauty and the story of his brothers", "ar": "النبي يوسف، المعروف بجماله وقصته مع إخوته", "fr": "Le prophète Joseph, connu pour sa beauté et l'histoire de ses frères"}},
        {"word": "Musa", "hint": {"en": "Prophet Moses, who received the Torah and parted the sea", "ar": "النبي موسى، الذي أُنزلت عليه التوراة وشق البحر", "fr": "Le prophète Moïse, qui reçut la Torah et fendit la mer"}},
        {"word": "Harun", "hint": {"en": "Prophet Aaron, brother and helper of Musa", "ar": "النبي هارون، أخو موسى ومعاونه", "fr": "Le prophète Aaron, frère et assistant de Moïse"}},
        {"word": "Dawud", "hint": {"en": "Prophet David, king and psalmist who received the Zabur", "ar": "النبي داوود، الملك الذي أُنزل عليه الزبور", "fr": "Le prophète David, roi et psalmiste qui reçut le Zabour"}},
        {"word": "Sulayman", "hint": {"en": "Prophet Solomon, known for his wisdom and kingdom over humans and jinn", "ar": "النبي سليمان، المعروف بحكمته وملكه على الإنس والجن", "fr": "Le prophète Salomon, connu pour sa sagesse et son royaume sur les humains et les djinns"}},
        {"word": "Isa", "hint": {"en": "Prophet Jesus, born miraculously to Maryam", "ar": "النبي عيسى، ولد بمعجزة لمريم", "fr": "Le prophète Jésus, né miraculeusement de Maryam"}},
        {"word": "Muhammad", "hint": {"en": "The final Prophet and Messenger of Allah, seal of the prophets", "ar": "النبي محمد، خاتم الأنبياء والمرسلين", "fr": "Le dernier Prophète et Messager d'Allah, sceau des prophètes"}},
        {"word": "Ayyub", "hint": {"en": "Prophet Job, symbol of patience through severe trials", "ar": "النبي أيوب، رمز الصبر على البلاء الشديد", "fr": "Le prophète Job, symbole de patience face aux épreuves"}},
        {"word": "Yunus", "hint": {"en": "Prophet Jonah, who was swallowed by a whale and repented", "ar": "النبي يونس، الذي ابتلعه الحوت فتاب إلى الله", "fr": "Le prophète Jonas, avalé par une baleine et qui se repentit"}},
        {"word": "Idris", "hint": {"en": "Prophet Enoch, known for his piety and knowledge", "ar": "النبي إدريس، المعروف بتقواه وعلمه", "fr": "Le prophète Énoch, connu pour sa piété et son savoir"}},
        {"word": "Hud", "hint": {"en": "Prophet sent to the people of 'Ad, who rejected his message", "ar": "النبي هود، أُرسل إلى قوم عاد الذين رفضوا رسالته", "fr": "Prophète envoyé au peuple de 'Ad, qui rejeta son message"}},
        {"word": "Salih", "hint": {"en": "Prophet sent to the people of Thamud with the miracle of the she-camel", "ar": "النبي صالح، أُرسل إلى قوم ثمود بمعجزة الناقة", "fr": "Prophète envoyé au peuple de Thamoud avec le miracle de la chamelle"}},
        {"word": "Shuayb", "hint": {"en": "Prophet sent to the people of Madyan, known as the orator of the prophets", "ar": "النبي شعيب، أُرسل إلى أهل مدين، خطيب الأنبياء", "fr": "Prophète envoyé au peuple de Madyan, connu comme l'orateur des prophètes"}},
        {"word": "Lut", "hint": {"en": "Prophet Lot, nephew of Ibrahim who warned his people against immorality", "ar": "النبي لوط، ابن أخي إبراهيم الذي حذر قومه من الفاحشة", "fr": "Le prophète Loth, neveu d'Ibrahim qui avertit son peuple contre l'immoralité"}},
    ],
    "Quran & Surahs": [
        {"word": "Fatiha", "hint": {"en": "The Opening — first surah of the Quran, recited in every prayer", "ar": "الفاتحة — أول سورة في القرآن، تُقرأ في كل صلاة", "fr": "L'Ouverture — première sourate du Coran, récitée dans chaque prière"}},
        {"word": "Baqarah", "hint": {"en": "The Cow — longest surah in the Quran", "ar": "البقرة — أطول سورة في القرآن الكريم", "fr": "La Vache — la plus longue sourate du Coran"}},
        {"word": "Yasin", "hint": {"en": "Often called the heart of the Quran", "ar": "يس — تُسمى قلب القرآن", "fr": "Souvent appelée le cœur du Coran"}},
        {"word": "Rahman", "hint": {"en": "The Most Merciful — known for the refrain 'Which of your Lord's favors will you deny?'", "ar": "الرحمن — المعروفة بتكرار 'فبأي آلاء ربكما تكذبان'", "fr": "Le Tout Miséricordieux — connue pour le refrain 'Lequel des bienfaits de votre Seigneur nierez-vous ?'"}},
        {"word": "Mulk", "hint": {"en": "The Sovereignty — protects from the punishment of the grave", "ar": "الملك — تقي من عذاب القبر", "fr": "La Royauté — protège du châtiment de la tombe"}},
        {"word": "Kahf", "hint": {"en": "The Cave — recommended to read on Fridays, contains four stories", "ar": "الكهف — يُستحب قراءتها يوم الجمعة، تحتوي أربع قصص", "fr": "La Caverne — recommandée le vendredi, contient quatre récits"}},
        {"word": "Maryam", "hint": {"en": "Surah named after Mary, mother of Prophet Isa", "ar": "سورة مريم — سُميت على اسم مريم أم النبي عيسى", "fr": "Sourate nommée d'après Marie, mère du prophète Jésus"}},
        {"word": "Taha", "hint": {"en": "Surah beginning with mystical letters, recounts the story of Musa", "ar": "سورة طه — تبدأ بحروف مقطعة وتروي قصة موسى", "fr": "Sourate commençant par des lettres mystiques, raconte l'histoire de Moïse"}},
        {"word": "Naba", "hint": {"en": "The Great News — about the Day of Judgment", "ar": "النبأ — عن يوم القيامة", "fr": "La Nouvelle — à propos du Jour du Jugement"}},
        {"word": "Ikhlas", "hint": {"en": "Purity of Faith — equal to one-third of the Quran in reward", "ar": "الإخلاص — تعادل ثلث القرآن في الأجر", "fr": "La Pureté de la Foi — équivalente à un tiers du Coran en récompense"}},
        {"word": "Falaq", "hint": {"en": "The Daybreak — a protective surah seeking refuge from evil", "ar": "الفلق — سورة حماية يُستعاذ بها من الشر", "fr": "L'Aube naissante — sourate protectrice contre le mal"}},
        {"word": "Nas", "hint": {"en": "Mankind — the final surah, seeking refuge from the whisperer", "ar": "الناس — آخر سورة، يُستعاذ بها من الوسواس", "fr": "Les Hommes — dernière sourate, cherchant refuge contre le tentateur"}},
        {"word": "Ayah", "hint": {"en": "A verse of the Quran, also means 'sign' from God", "ar": "آية — جملة من القرآن، تعني أيضاً 'علامة' من الله", "fr": "Un verset du Coran, signifie aussi 'signe' de Dieu"}},
        {"word": "Juz", "hint": {"en": "One of 30 equal parts of the Quran", "ar": "جزء — واحد من ثلاثين جزءاً متساوياً من القرآن", "fr": "L'une des 30 parties égales du Coran"}},
        {"word": "Hizb", "hint": {"en": "Half a Juz — the Quran is divided into 60 Hizbs", "ar": "حزب — نصف جزء، القرآن مقسم إلى 60 حزباً", "fr": "La moitié d'un Juz — le Coran est divisé en 60 Hizbs"}},
        {"word": "Tanzil", "hint": {"en": "The revelation or sending down of the Quran from God", "ar": "التنزيل — إنزال القرآن من عند الله", "fr": "La révélation ou la descente du Coran de Dieu"}},
        {"word": "Tafsir", "hint": {"en": "Exegesis and interpretation of the Quran", "ar": "التفسير — شرح وتأويل القرآن الكريم", "fr": "L'exégèse et l'interprétation du Coran"}},
        {"word": "Tajweed", "hint": {"en": "The rules of proper Quran recitation and pronunciation", "ar": "التجويد — قواعد تلاوة القرآن ونطقه الصحيح", "fr": "Les règles de récitation correcte et de prononciation du Coran"}},
        {"word": "Tilawah", "hint": {"en": "The act of reciting the Quran aloud", "ar": "التلاوة — قراءة القرآن جهراً", "fr": "L'acte de réciter le Coran à voix haute"}},
        {"word": "Mushaf", "hint": {"en": "The physical written copy of the Quran", "ar": "المصحف — النسخة المكتوبة من القرآن الكريم", "fr": "L'exemplaire physique écrit du Coran"}},
    ],
    "Islamic History": [
        {"word": "Hijrah", "hint": {"en": "The Prophet's migration from Mecca to Medina in 622 CE", "ar": "هجرة النبي من مكة إلى المدينة عام 622 م", "fr": "La migration du Prophète de La Mecque à Médine en 622"}},
        {"word": "Badr", "hint": {"en": "First major battle of Islam, a decisive Muslim victory in 624 CE", "ar": "بدر — أول معركة كبرى في الإسلام، انتصار حاسم عام 624 م", "fr": "Première grande bataille de l'islam, victoire décisive des musulmans en 624"}},
        {"word": "Uhud", "hint": {"en": "Second major battle near Medina where Muslims faced setbacks", "ar": "أحد — ثاني معركة كبرى قرب المدينة حيث واجه المسلمون انتكاسة", "fr": "Deuxième grande bataille près de Médine où les musulmans subirent des revers"}},
        {"word": "Khandaq", "hint": {"en": "The Battle of the Trench — Muslims dug a defensive trench around Medina", "ar": "الخندق — حفر المسلمون خندقاً دفاعياً حول المدينة", "fr": "La bataille du Fossé — les musulmans creusèrent un fossé défensif autour de Médine"}},
        {"word": "Hudaybiyyah", "hint": {"en": "Peace treaty between Muslims and Quraysh that the Quran called a clear victory", "ar": "الحديبية — معاهدة سلام بين المسلمين وقريش وصفها القرآن بالفتح المبين", "fr": "Traité de paix entre les musulmans et Quraysh que le Coran qualifia de victoire éclatante"}},
        {"word": "Mecca", "hint": {"en": "The holiest city in Islam, birthplace of the Prophet and home of the Kaaba", "ar": "مكة المكرمة — أقدس مدينة في الإسلام، مسقط رأس النبي وموطن الكعبة", "fr": "La ville la plus sainte de l'islam, lieu de naissance du Prophète et de la Kaaba"}},
        {"word": "Medina", "hint": {"en": "The city of the Prophet, second holiest city in Islam", "ar": "المدينة المنورة — مدينة النبي، ثاني أقدس مدينة في الإسلام", "fr": "La ville du Prophète, deuxième ville la plus sainte de l'islam"}},
        {"word": "Abyssinia", "hint": {"en": "Land of the first Muslim migration, where the Negus gave them refuge", "ar": "الحبشة — أرض أول هجرة إسلامية حيث آواهم النجاشي", "fr": "Terre de la première migration musulmane, où le Négus leur donna refuge"}},
        {"word": "Taif", "hint": {"en": "City where the Prophet was rejected and stoned but forgave its people", "ar": "الطائف — المدينة التي رُفض فيها النبي ورُجم لكنه عفا عن أهلها", "fr": "Ville où le Prophète fut rejeté et lapidé mais pardonna à ses habitants"}},
        {"word": "Tabuk", "hint": {"en": "The last military expedition led by the Prophet in 630 CE", "ar": "تبوك — آخر غزوة قادها النبي عام 630 م", "fr": "La dernière expédition militaire menée par le Prophète en 630"}},
        {"word": "Khaybar", "hint": {"en": "Jewish fortress conquered by Muslims, known for Ali's bravery", "ar": "خيبر — حصن يهودي فتحه المسلمون، اشتهرت بشجاعة علي", "fr": "Forteresse juive conquise par les musulmans, connue pour la bravoure d'Ali"}},
        {"word": "Caliphate", "hint": {"en": "The Islamic system of governance after the Prophet's death", "ar": "الخلافة — نظام الحكم الإسلامي بعد وفاة النبي", "fr": "Le système de gouvernance islamique après la mort du Prophète"}},
        {"word": "Umayyad", "hint": {"en": "First hereditary Islamic dynasty, based in Damascus (661-750 CE)", "ar": "الأمويون — أول سلالة إسلامية وراثية، مقرها دمشق", "fr": "Première dynastie islamique héréditaire, basée à Damas (661-750)"}},
        {"word": "Abbasid", "hint": {"en": "Islamic dynasty known as the Golden Age of Islam, based in Baghdad", "ar": "العباسيون — السلالة المعروفة بالعصر الذهبي للإسلام، مقرها بغداد", "fr": "Dynastie islamique connue comme l'Âge d'or de l'islam, basée à Bagdad"}},
        {"word": "Ottoman", "hint": {"en": "Last major Islamic empire, ruled from Istanbul for over 600 years", "ar": "العثمانيون — آخر إمبراطورية إسلامية كبرى، حكمت من إسطنبول لأكثر من 600 عام", "fr": "Dernier grand empire islamique, gouvernant depuis Istanbul pendant plus de 600 ans"}},
        {"word": "Andalusia", "hint": {"en": "Muslim-ruled Iberian Peninsula, a beacon of learning and coexistence", "ar": "الأندلس — شبه الجزيرة الإيبيرية تحت الحكم الإسلامي، منارة للعلم والتعايش", "fr": "La péninsule ibérique sous domination musulmane, phare de savoir et de coexistence"}},
        {"word": "Baghdad", "hint": {"en": "Capital of the Abbasid Caliphate and center of the Islamic Golden Age", "ar": "بغداد — عاصمة الخلافة العباسية ومركز العصر الذهبي الإسلامي", "fr": "Capitale du califat abbasside et centre de l'Âge d'or islamique"}},
        {"word": "Damascus", "hint": {"en": "Capital of the Umayyad Caliphate, one of the oldest continuously inhabited cities", "ar": "دمشق — عاصمة الخلافة الأموية، من أقدم المدن المأهولة باستمرار", "fr": "Capitale du califat omeyyade, l'une des plus anciennes villes habitées en continu"}},
        {"word": "Cordoba", "hint": {"en": "Heart of Al-Andalus, famous for its Great Mosque and libraries", "ar": "قرطبة — قلب الأندلس، اشتهرت بمسجدها الكبير ومكتباتها", "fr": "Cœur d'Al-Andalus, célèbre pour sa Grande Mosquée et ses bibliothèques"}},
        {"word": "Jerusalem", "hint": {"en": "Al-Quds — third holiest city in Islam, site of Al-Aqsa Mosque", "ar": "القدس — ثالث أقدس مدينة في الإسلام، موقع المسجد الأقصى", "fr": "Al-Quds — troisième ville la plus sainte de l'islam, site de la mosquée Al-Aqsa"}},
    ],
    "Worship & Rituals": [
        {"word": "Salah", "hint": {"en": "The five daily ritual prayers, second pillar of Islam", "ar": "الصلوات الخمس اليومية، الركن الثاني من أركان الإسلام", "fr": "Les cinq prières rituelles quotidiennes, deuxième pilier de l'islam"}},
        {"word": "Zakat", "hint": {"en": "Obligatory charity, the third pillar of Islam", "ar": "الزكاة، الركن الثالث من أركان الإسلام", "fr": "L'aumône obligatoire, le troisième pilier de l'islam"}},
        {"word": "Sawm", "hint": {"en": "Fasting during Ramadan, the fourth pillar of Islam", "ar": "الصيام في رمضان، الركن الرابع من أركان الإسلام", "fr": "Le jeûne pendant le Ramadan, le quatrième pilier de l'islam"}},
        {"word": "Hajj", "hint": {"en": "The annual pilgrimage to Mecca, the fifth pillar of Islam", "ar": "الحج السنوي إلى مكة، الركن الخامس من أركان الإسلام", "fr": "Le pèlerinage annuel à La Mecque, le cinquième pilier de l'islam"}},
        {"word": "Shahada", "hint": {"en": "The declaration of faith, the first pillar of Islam", "ar": "الشهادة، الركن الأول من أركان الإسلام", "fr": "La déclaration de foi, le premier pilier de l'islam"}},
        {"word": "Wudu", "hint": {"en": "Ritual ablution with water before prayer", "ar": "الوضوء — الطهارة بالماء قبل الصلاة", "fr": "L'ablution rituelle avec de l'eau avant la prière"}},
        {"word": "Adhan", "hint": {"en": "The call to prayer announced five times daily", "ar": "الأذان — النداء للصلاة خمس مرات يومياً", "fr": "L'appel à la prière annoncé cinq fois par jour"}},
        {"word": "Iqamah", "hint": {"en": "The second call just before congregational prayer starts", "ar": "الإقامة — النداء الثاني قبل بدء صلاة الجماعة", "fr": "Le second appel juste avant le début de la prière en congrégation"}},
        {"word": "Qiyam", "hint": {"en": "Standing position in prayer, also refers to night prayer", "ar": "القيام — وضعية الوقوف في الصلاة، يشير أيضاً لصلاة الليل", "fr": "La position debout dans la prière, désigne aussi la prière nocturne"}},
        {"word": "Sujud", "hint": {"en": "Prostration — placing the forehead on the ground in prayer", "ar": "السجود — وضع الجبهة على الأرض في الصلاة", "fr": "La prosternation — poser le front au sol dans la prière"}},
        {"word": "Ruku", "hint": {"en": "Bowing position in prayer with hands on knees", "ar": "الركوع — الانحناء في الصلاة مع وضع اليدين على الركبتين", "fr": "La position inclinée dans la prière avec les mains sur les genoux"}},
        {"word": "Tashahhud", "hint": {"en": "The testimony recited while sitting in prayer", "ar": "التشهد — الشهادة التي تُقرأ أثناء الجلوس في الصلاة", "fr": "Le témoignage récité en position assise dans la prière"}},
        {"word": "Tasleem", "hint": {"en": "The greeting of peace that concludes the prayer", "ar": "التسليم — تحية السلام التي تختتم الصلاة", "fr": "La salutation de paix qui conclut la prière"}},
        {"word": "Takbir", "hint": {"en": "Saying 'Allahu Akbar' — God is the Greatest", "ar": "التكبير — قول 'الله أكبر'", "fr": "Dire 'Allahu Akbar' — Dieu est le Plus Grand"}},
        {"word": "Tahmid", "hint": {"en": "Saying 'Alhamdulillah' — Praise be to God", "ar": "التحميد — قول 'الحمد لله'", "fr": "Dire 'Alhamdulillah' — Louange à Dieu"}},
        {"word": "Tasbih", "hint": {"en": "Glorification of God by saying 'SubhanAllah'", "ar": "التسبيح — تمجيد الله بقول 'سبحان الله'", "fr": "La glorification de Dieu en disant 'SubhanAllah'"}},
        {"word": "Istighfar", "hint": {"en": "Seeking forgiveness from God by saying 'Astaghfirullah'", "ar": "الاستغفار — طلب المغفرة من الله بقول 'أستغفر الله'", "fr": "Demander pardon à Dieu en disant 'Astaghfirullah'"}},
        {"word": "Tawaf", "hint": {"en": "Circling the Kaaba seven times during Hajj or Umrah", "ar": "الطواف — الدوران حول الكعبة سبع مرات في الحج أو العمرة", "fr": "Faire sept tours autour de la Kaaba pendant le Hajj ou la Omra"}},
        {"word": "Sai", "hint": {"en": "Walking seven times between the hills of Safa and Marwa", "ar": "السعي — المشي سبع مرات بين الصفا والمروة", "fr": "Marcher sept fois entre les collines de Safa et Marwa"}},
        {"word": "Ihram", "hint": {"en": "The sacred state and white garments worn during Hajj or Umrah", "ar": "الإحرام — الحالة المقدسة واللباس الأبيض في الحج أو العمرة", "fr": "L'état sacré et les vêtements blancs portés pendant le Hajj ou la Omra"}},
    ],
    "Islamic Values": [
        {"word": "Tawakkul", "hint": {"en": "Complete trust and reliance in God's plan", "ar": "التوكل — الاعتماد الكامل على الله والثقة بتدبيره", "fr": "La confiance totale en le plan de Dieu"}},
        {"word": "Sabr", "hint": {"en": "Patience and perseverance through hardship", "ar": "الصبر — التحمل والمثابرة في مواجهة الشدائد", "fr": "La patience et la persévérance face aux épreuves"}},
        {"word": "Shukr", "hint": {"en": "Gratitude to Allah for His blessings", "ar": "الشكر — الامتنان لله على نعمه", "fr": "La gratitude envers Allah pour Ses bienfaits"}},
        {"word": "Taqwa", "hint": {"en": "God-consciousness and piety in all aspects of life", "ar": "التقوى — الوعي بالله والورع في جميع جوانب الحياة", "fr": "La conscience de Dieu et la piété dans tous les aspects de la vie"}},
        {"word": "Ihsan", "hint": {"en": "Excellence in worship — to worship God as if you see Him", "ar": "الإحسان — أن تعبد الله كأنك تراه", "fr": "L'excellence dans l'adoration — adorer Dieu comme si tu Le voyais"}},
        {"word": "Iman", "hint": {"en": "Faith — belief in God, angels, books, prophets, Last Day, and decree", "ar": "الإيمان — التصديق بالله وملائكته وكتبه ورسله واليوم الآخر والقدر", "fr": "La foi — croyance en Dieu, Ses anges, Ses livres, Ses prophètes, le Jour dernier et le destin"}},
        {"word": "Adl", "hint": {"en": "Justice and fairness, a fundamental principle in Islam", "ar": "العدل — العدالة والإنصاف، مبدأ أساسي في الإسلام", "fr": "La justice et l'équité, un principe fondamental en islam"}},
        {"word": "Rahma", "hint": {"en": "Mercy and compassion, a core attribute of Allah", "ar": "الرحمة — صفة أساسية من صفات الله", "fr": "La miséricorde et la compassion, un attribut fondamental d'Allah"}},
        {"word": "Hikmah", "hint": {"en": "Wisdom — the ability to apply knowledge with insight and judgment", "ar": "الحكمة — القدرة على تطبيق المعرفة بتبصر وحسن تقدير", "fr": "La sagesse — la capacité d'appliquer la connaissance avec discernement"}},
        {"word": "Ilm", "hint": {"en": "Knowledge — seeking it is an obligation upon every Muslim", "ar": "العلم — طلبه فريضة على كل مسلم", "fr": "La connaissance — la rechercher est une obligation pour tout musulman"}},
        {"word": "Amanah", "hint": {"en": "Trustworthiness and fulfilling responsibilities entrusted to you", "ar": "الأمانة — الثقة والوفاء بالمسؤوليات الموكلة إليك", "fr": "La fiabilité et l'accomplissement des responsabilités qui vous sont confiées"}},
        {"word": "Sidq", "hint": {"en": "Truthfulness and sincerity in speech and action", "ar": "الصدق — الحقيقة والإخلاص في القول والفعل", "fr": "La véracité et la sincérité en parole et en acte"}},
        {"word": "Haya", "hint": {"en": "Modesty and shyness — a branch of faith", "ar": "الحياء — شعبة من شعب الإيمان", "fr": "La pudeur et la modestie — une branche de la foi"}},
        {"word": "Tawbah", "hint": {"en": "Repentance — turning back to God after sin", "ar": "التوبة — الرجوع إلى الله بعد الذنب", "fr": "Le repentir — revenir à Dieu après le péché"}},
        {"word": "Ikhlas", "hint": {"en": "Sincerity — doing deeds purely for the sake of Allah", "ar": "الإخلاص — العمل خالصاً لوجه الله", "fr": "La sincérité — accomplir les actes uniquement pour l'amour d'Allah"}},
        {"word": "Birr", "hint": {"en": "Righteousness and goodness in all dealings", "ar": "البر — الصلاح والإحسان في جميع المعاملات", "fr": "La droiture et la bonté dans toutes les relations"}},
        {"word": "Husn", "hint": {"en": "Beauty and goodness, especially in character and conduct", "ar": "الحُسن — الجمال والطيب، خاصة في الأخلاق والسلوك", "fr": "La beauté et la bonté, surtout dans le caractère et la conduite"}},
        {"word": "Khushu", "hint": {"en": "Deep humility and focus in prayer and worship", "ar": "الخشوع — التواضع العميق والتركيز في الصلاة والعبادة", "fr": "L'humilité profonde et la concentration dans la prière et l'adoration"}},
        {"word": "Wara", "hint": {"en": "Scrupulousness — avoiding anything doubtful or suspicious", "ar": "الورع — تجنب كل ما هو مشبوه أو مشكوك فيه", "fr": "Le scrupule — éviter tout ce qui est douteux ou suspect"}},
        {"word": "Zuhd", "hint": {"en": "Asceticism — detachment from worldly pleasures for God's sake", "ar": "الزهد — الإعراض عن متع الدنيا في سبيل الله", "fr": "L'ascétisme — le détachement des plaisirs mondains pour l'amour de Dieu"}},
    ],
    "Islamic Sciences": [
        {"word": "Fiqh", "hint": {"en": "Islamic jurisprudence — understanding of religious laws and rulings", "ar": "الفقه — فهم الأحكام والتشريعات الدينية", "fr": "La jurisprudence islamique — compréhension des lois et jugements religieux"}},
        {"word": "Hadith", "hint": {"en": "The study of prophetic traditions and their chains of narration", "ar": "علم الحديث — دراسة الأحاديث النبوية وأسانيدها", "fr": "L'étude des traditions prophétiques et de leurs chaînes de narration"}},
        {"word": "Tafsir", "hint": {"en": "The science of Quranic interpretation and commentary", "ar": "علم التفسير — شرح وتأويل القرآن الكريم", "fr": "La science de l'interprétation et du commentaire coranique"}},
        {"word": "Aqeedah", "hint": {"en": "Islamic creed and theology — the study of core beliefs", "ar": "العقيدة — دراسة أصول الإيمان والمعتقدات", "fr": "Le credo et la théologie islamique — l'étude des croyances fondamentales"}},
        {"word": "Usul", "hint": {"en": "Principles of Islamic jurisprudence — methodology for deriving rulings", "ar": "أصول الفقه — منهجية استنباط الأحكام الشرعية", "fr": "Les principes de la jurisprudence islamique — méthodologie d'extraction des jugements"}},
        {"word": "Seerah", "hint": {"en": "The biographical study of Prophet Muhammad's life", "ar": "السيرة النبوية — دراسة حياة النبي محمد", "fr": "L'étude biographique de la vie du Prophète Muhammad"}},
        {"word": "Tajweed", "hint": {"en": "The science of correct Quran recitation and pronunciation", "ar": "علم التجويد — قواعد التلاوة الصحيحة للقرآن", "fr": "La science de la récitation et de la prononciation correctes du Coran"}},
        {"word": "Nahw", "hint": {"en": "Arabic grammar — essential for understanding the Quran", "ar": "النحو — القواعد العربية الضرورية لفهم القرآن", "fr": "La grammaire arabe — essentielle pour comprendre le Coran"}},
        {"word": "Sarf", "hint": {"en": "Arabic morphology — the study of word forms and patterns", "ar": "الصرف — دراسة أوزان الكلمات وأبنيتها", "fr": "La morphologie arabe — l'étude des formes et structures des mots"}},
        {"word": "Balagha", "hint": {"en": "Arabic rhetoric and eloquence, key to Quranic literary analysis", "ar": "البلاغة — علم الفصاحة العربية، مفتاح التحليل الأدبي للقرآن", "fr": "La rhétorique et l'éloquence arabes, clé de l'analyse littéraire coranique"}},
        {"word": "Mantiq", "hint": {"en": "Islamic logic — the science of correct reasoning", "ar": "المنطق — علم التفكير الصحيح", "fr": "La logique islamique — la science du raisonnement correct"}},
        {"word": "Falsafa", "hint": {"en": "Islamic philosophy — synthesis of Greek philosophy with Islamic thought", "ar": "الفلسفة الإسلامية — دمج الفلسفة اليونانية مع الفكر الإسلامي", "fr": "La philosophie islamique — synthèse de la philosophie grecque et de la pensée islamique"}},
        {"word": "Kalam", "hint": {"en": "Islamic theology — rational discourse about God's attributes and nature", "ar": "علم الكلام — الخطاب العقلاني حول صفات الله وطبيعته", "fr": "La théologie islamique — discours rationnel sur les attributs et la nature de Dieu"}},
        {"word": "Tasawwuf", "hint": {"en": "Islamic spirituality and mysticism — the inner dimension of worship", "ar": "التصوف — الروحانية الإسلامية والبعد الباطني للعبادة", "fr": "La spiritualité et le mysticisme islamiques — la dimension intérieure de l'adoration"}},
        {"word": "Ijtihad", "hint": {"en": "Independent scholarly reasoning to derive new legal rulings", "ar": "الاجتهاد — التفكير العلمي المستقل لاستنباط أحكام شرعية جديدة", "fr": "Le raisonnement savant indépendant pour dériver de nouveaux jugements juridiques"}},
    ],
}


# ── Helper functions ────────────────────────────────────────────────────────


def create_random_public_id() -> str:
    """Create a random 5-character public ID for rooms."""
    return "".join(random.choice(string.ascii_letters + string.digits) for _ in range(5))


async def create_test_users(session: AsyncSession) -> list[User]:
    """Create the three fixed test users with hashed passwords.

    Returns:
        List of created User objects.
    """
    users = []
    for user_data in TEST_USERS:
        user = User(
            id=uuid4(),
            username=user_data["username"],
            email_address=user_data["email_address"],
            password=get_password_hash(user_data["password"]),
            country=user_data["country"],
            email_verified=True,
            bio=user_data.get("bio"),
        )
        session.add(user)
        users.append(user)

    await session.commit()
    for user in users:
        await session.refresh(user)

    print(f"  Created {len(users)} test users:")
    for u in TEST_USERS:
        print(f"    - {u['email_address']} / {u['password']}")

    return users


async def create_random_users(session: AsyncSession, count: int) -> list[User]:
    """Create additional random users with hashed passwords.

    Args:
        session: The database session.
        count: Number of random users to create.

    Returns:
        List of created User objects.
    """
    import pycountry

    country_codes = [c.alpha_3 for c in pycountry.countries]
    users = []

    for _ in range(count):
        user = User(
            id=uuid4(),
            username=fake.user_name(),
            email_address=fake.email(),
            password=get_password_hash(fake.password()),
            country=random.choice(country_codes),
        )
        session.add(user)
        users.append(user)

    await session.commit()
    for user in users:
        await session.refresh(user)

    print(f"  Created {count} random users")
    return users


async def create_rooms(session: AsyncSession, users: list[User], count: int = 5) -> list[Room]:
    """Create rooms with various statuses.

    Args:
        session: The database session.
        users: List of users who can own rooms.
        count: Number of rooms to create.

    Returns:
        List of created Room objects.
    """
    rooms = []
    for i in range(count):
        owner = random.choice(users)
        room = Room(
            id=uuid4(),
            public_id=create_random_public_id(),
            owner_id=owner.id,
            status=random.choice(list(RoomStatus)),
            password="".join(random.choice(string.digits) for _ in range(4)),
            type=random.choice(list(RoomType)),
            created_at=fake.date_time_between(start_date="-30d", end_date="now"),
        )
        session.add(room)
        rooms.append(room)

    await session.commit()
    for room in rooms:
        await session.refresh(room)

    print(f"  Created {count} rooms")
    return rooms


async def create_games(
    session: AsyncSession, users: list[User], count: int = 30
) -> list[Game]:
    """Create games with various types and configurations.

    Args:
        session: The database session.
        users: List of users who can participate in games.
        count: Number of games to create.

    Returns:
        List of created Game objects.
    """
    games = []
    for _ in range(count):
        user = random.choice(users)
        start_time = fake.date_time_between(start_date="-30d", end_date="now")
        has_ended = random.choice([True, False])
        end_time = start_time + timedelta(minutes=random.randint(5, 45)) if has_ended else None
        game_type = random.choice(list(GameType))
        num_players = random.randint(3, 12) if game_type == GameType.UNDERCOVER else random.randint(4, 10)

        game = Game(
            id=uuid4(),
            user_id=user.id,
            start_time=start_time,
            end_time=end_time,
            number_of_players=num_players,
            type=game_type,
            game_configurations={
                "game_type": game_type.value,
                "created_by": str(user.id),
            },
        )
        session.add(game)
        games.append(game)

    await session.commit()
    for game in games:
        await session.refresh(game)

    print(f"  Created {count} games")
    return games


async def seed_undercover_words(session: AsyncSession) -> dict[str, Word]:
    """Seed all Undercover words and return a mapping of word text to Word object.

    Args:
        session: The database session.

    Returns:
        Dictionary mapping word text to Word objects.
    """
    word_map: dict[str, Word] = {}

    for word_data in UNDERCOVER_WORDS:
        word = Word(
            id=uuid4(),
            word=word_data["word"],
            category=word_data["category"],
            short_description=word_data["short_description"],
            long_description=word_data["long_description"],
            hint=word_data.get("hint", {"en": word_data["long_description"]}),
        )
        session.add(word)
        word_map[word_data["word"]] = word

    await session.commit()
    for word in word_map.values():
        await session.refresh(word)

    print(f"  Seeded {len(word_map)} Undercover words")
    return word_map


async def seed_undercover_pairs(session: AsyncSession, word_map: dict[str, Word]) -> None:
    """Seed Undercover word pairs.

    Args:
        session: The database session.
        word_map: Dictionary mapping word text to Word objects.
    """
    count = 0
    for word1_text, word2_text in UNDERCOVER_WORD_PAIRS:
        w1 = word_map.get(word1_text)
        w2 = word_map.get(word2_text)
        if w1 is None or w2 is None:
            print(f"    Warning: Skipping pair ({word1_text}, {word2_text}) - word not found")
            continue

        pair = TermPair(
            id=uuid4(),
            word1_id=w1.id,
            word2_id=w2.id,
        )
        session.add(pair)
        count += 1

    await session.commit()
    print(f"  Seeded {count} Undercover word pairs")


async def seed_codenames_words(session: AsyncSession) -> None:
    """Seed Codenames word packs and words.

    Args:
        session: The database session.
    """
    total_words = 0

    for pack_name, words in CODENAMES_WORD_PACKS.items():
        pack = CodenamesWordPack(
            id=uuid4(),
            name=pack_name,
            description=f"Islamic terms related to {pack_name.lower()}",
            is_active=True,
        )
        session.add(pack)
        await session.flush()

        for word_data in words:
            word = CodenamesWord(
                id=uuid4(),
                word=word_data["word"],
                hint=word_data.get("hint"),
                word_pack_id=pack.id,
            )
            session.add(word)
            total_words += 1

    await session.commit()
    print(f"  Seeded {len(CODENAMES_WORD_PACKS)} Codenames word packs with {total_words} words")


async def seed_achievements(session: AsyncSession) -> None:
    """Seed achievement definitions using the AchievementController.

    Args:
        session: The database session.
    """
    controller = AchievementController(session)
    await controller.seed_achievements()
    print("  Seeded achievement definitions")


async def create_user_stats(session: AsyncSession, users: list[User]) -> None:
    """Create sample UserStats entries for test users.

    Args:
        session: The database session.
        users: List of users to create stats for.
    """
    roles_undercover = ["civilian", "undercover", "mr_white"]
    roles_codenames = ["spymaster", "operative"]

    for user in users:
        total_played = random.randint(5, 100)
        total_won = random.randint(1, total_played)
        total_lost = total_played - total_won

        uc_played = random.randint(2, total_played // 2 + 1)
        uc_won = random.randint(0, uc_played)
        cn_played = total_played - uc_played
        cn_won = total_won - uc_won if total_won > uc_won else random.randint(0, cn_played)

        times_civilian = random.randint(1, max(1, uc_played // 2))
        times_undercover = random.randint(1, max(1, uc_played // 3))
        times_mr_white = max(0, uc_played - times_civilian - times_undercover)

        civilian_wins = random.randint(0, times_civilian)
        undercover_wins = random.randint(0, times_undercover)
        mr_white_wins = random.randint(0, times_mr_white)

        times_spymaster = random.randint(1, max(1, cn_played // 2))
        times_operative = max(0, cn_played - times_spymaster)

        spymaster_wins = random.randint(0, times_spymaster)
        operative_wins = random.randint(0, times_operative)

        current_win_streak = random.randint(0, 5)
        longest_win_streak = random.randint(current_win_streak, 10)

        current_play_streak = random.randint(0, 7)
        longest_play_streak = random.randint(current_play_streak, 30)

        stats = UserStats(
            id=uuid4(),
            user_id=user.id,
            total_games_played=total_played,
            total_games_won=total_won,
            total_games_lost=total_lost,
            undercover_games_played=uc_played,
            undercover_games_won=uc_won,
            codenames_games_played=cn_played,
            codenames_games_won=cn_won,
            times_civilian=times_civilian,
            times_undercover=times_undercover,
            times_mr_white=times_mr_white,
            civilian_wins=civilian_wins,
            undercover_wins=undercover_wins,
            mr_white_wins=mr_white_wins,
            times_spymaster=times_spymaster,
            times_operative=times_operative,
            spymaster_wins=spymaster_wins,
            operative_wins=operative_wins,
            total_votes_cast=random.randint(10, 200),
            correct_votes=random.randint(5, 100),
            times_eliminated=random.randint(0, 30),
            times_survived=random.randint(0, 50),
            current_win_streak=current_win_streak,
            longest_win_streak=longest_win_streak,
            current_play_streak_days=current_play_streak,
            longest_play_streak_days=longest_play_streak,
            last_played_at=fake.date_time_between(start_date="-7d", end_date="now"),
            mr_white_correct_guesses=random.randint(0, 5),
            codenames_words_guessed=random.randint(5, 80),
            codenames_perfect_rounds=random.randint(0, 5),
            rooms_created=random.randint(0, 20),
            games_hosted=random.randint(0, 15),
        )
        session.add(stats)

    await session.commit()
    print(f"  Created UserStats for {len(users)} users")


async def seed_challenges(session: AsyncSession) -> None:
    """Seed challenge definitions using the ChallengeController.

    Args:
        session: The database session.
    """
    controller = ChallengeController(session)
    await controller.seed_challenges()
    print("  Seeded challenge definitions")


async def create_friendships(session: AsyncSession, users: list[User]) -> None:
    """Create sample friendship records between test users.

    Args:
        session: The database session.
        users: List of users to create friendships between.
    """
    if len(users) < 4:
        return

    count = 0
    # Create accepted friendships between first few users
    pairs_accepted = [(0, 1), (0, 2), (1, 3), (2, 4), (3, 5)]
    for i, j in pairs_accepted:
        if i < len(users) and j < len(users):
            friendship = Friendship(
                id=uuid4(),
                requester_id=users[i].id,
                addressee_id=users[j].id,
                status=FriendshipStatus.ACCEPTED,
            )
            session.add(friendship)
            count += 1

    # Create some pending requests
    pairs_pending = [(4, 0), (5, 1), (6, 2)]
    for i, j in pairs_pending:
        if i < len(users) and j < len(users):
            friendship = Friendship(
                id=uuid4(),
                requester_id=users[i].id,
                addressee_id=users[j].id,
                status=FriendshipStatus.PENDING,
            )
            session.add(friendship)
            count += 1

    await session.commit()
    print(f"  Created {count} friendships")


async def create_chat_messages(session: AsyncSession, users: list[User], rooms: list[Room]) -> None:
    """Create sample chat messages in rooms.

    Args:
        session: The database session.
        users: List of users who can send messages.
        rooms: List of rooms to add messages to.
    """
    if not rooms or not users:
        return

    count = 0
    messages_pool = [
        "Assalamu Alaikum!",
        "Who's ready to play?",
        "Let's go!",
        "Good game everyone",
        "That was close!",
        "MashaAllah, well played!",
        "Ready for another round?",
        "SubhanAllah, what a game!",
        "Who's the undercover?",
        "I think I know the word...",
        "Great clue!",
        "Let's vote!",
        "Bismillah, here we go",
        "AlhamduliLlah, good win",
        "JazakAllah khair for playing",
    ]

    for room in rooms[:5]:  # Only first 5 rooms
        num_messages = random.randint(3, 10)
        for _ in range(num_messages):
            user = random.choice(users[:10])  # Use first 10 test users
            msg = ChatMessage(
                id=uuid4(),
                room_id=room.id,
                user_id=user.id,
                username=user.username,
                message=random.choice(messages_pool),
            )
            session.add(msg)
            count += 1

    await session.commit()
    print(f"  Created {count} chat messages")


async def create_user_achievements(session: AsyncSession, users: list[User]) -> None:
    """Create sample UserAchievement records for test users.

    Some achievements are unlocked (with unlocked_at), some are in-progress.

    Args:
        session: The database session.
        users: List of users to create achievements for.
    """
    # Fetch all achievement definitions
    definitions = list((await session.exec(select(AchievementDefinition))).all())
    if not definitions:
        print("  No achievement definitions found — skipping")
        return

    count = 0
    for user in users[:10]:  # First 10 test users
        # Give each user 3-6 random achievements
        num_achievements = random.randint(3, min(6, len(definitions)))
        selected = random.sample(definitions, num_achievements)

        for defn in selected:
            is_unlocked = random.random() < 0.6  # 60% chance unlocked
            progress = defn.threshold if is_unlocked else random.randint(0, defn.threshold - 1)
            unlocked_at = (
                fake.date_time_between(start_date="-30d", end_date="now")
                if is_unlocked
                else None
            )

            achievement = UserAchievement(
                id=uuid4(),
                user_id=user.id,
                achievement_id=defn.id,
                progress=progress,
                unlocked_at=unlocked_at,
            )
            session.add(achievement)
            count += 1

    await session.commit()
    print(f"  Created {count} user achievements")


async def create_user_challenges(session: AsyncSession, users: list[User]) -> None:
    """Assign active challenges to test users.

    Each user gets 3 daily + 2 weekly challenges (matching the app's assignment logic).

    Args:
        session: The database session.
        users: List of users to assign challenges to.
    """
    # Fetch challenge definitions by type
    all_defs = list((await session.exec(select(ChallengeDefinition))).all())
    if not all_defs:
        print("  No challenge definitions found — skipping")
        return

    daily_defs = [d for d in all_defs if d.challenge_type == ChallengeType.DAILY]
    weekly_defs = [d for d in all_defs if d.challenge_type == ChallengeType.WEEKLY]

    now = datetime.now(UTC)
    daily_expires = now.replace(hour=23, minute=59, second=59) + timedelta(days=1)
    weekly_expires = now + timedelta(days=7 - now.weekday())  # Next Monday

    count = 0
    for user in users[:10]:  # First 10 test users
        # 3 daily challenges
        chosen_daily = random.sample(daily_defs, min(3, len(daily_defs)))
        for defn in chosen_daily:
            progress = random.randint(0, defn.target_count)
            challenge = UserChallenge(
                id=uuid4(),
                user_id=user.id,
                challenge_id=defn.id,
                progress=progress,
                completed=progress >= defn.target_count,
                assigned_at=now,
                expires_at=daily_expires,
            )
            session.add(challenge)
            count += 1

        # 2 weekly challenges
        chosen_weekly = random.sample(weekly_defs, min(2, len(weekly_defs)))
        for defn in chosen_weekly:
            progress = random.randint(0, defn.target_count)
            challenge = UserChallenge(
                id=uuid4(),
                user_id=user.id,
                challenge_id=defn.id,
                progress=progress,
                completed=progress >= defn.target_count,
                assigned_at=now,
                expires_at=weekly_expires,
            )
            session.add(challenge)
            count += 1

    await session.commit()
    print(f"  Created {count} user challenges")


# ── Main operations ─────────────────────────────────────────────────────────


async def delete_all_data(engine: AsyncEngine) -> None:
    """Delete all data by dropping and recreating tables.

    Args:
        engine: The database engine.
    """
    print("Dropping and recreating all tables...")
    await create_db_and_tables(engine, drop_all=True)
    print("All tables dropped and recreated successfully!")


async def generate_all_data(
    engine: AsyncEngine,
    num_users: int = 15,
    num_games: int = 30,
) -> None:
    """Create tables and generate all fake data.

    Args:
        engine: The database engine.
        num_users: Number of additional random users to generate.
        num_games: Number of games to generate.
    """
    print("Creating database tables...")
    await create_db_and_tables(engine)

    async with AsyncSession(engine, expire_on_commit=False) as session:
        # 1. Create test users
        print("\n[1/12] Creating test users...")
        test_users = await create_test_users(session)

        # 2. Create random users
        print(f"\n[2/12] Creating {num_users} random users...")
        random_users = await create_random_users(session, num_users)
        all_users = test_users + random_users

        # 3. Create rooms
        print("\n[3/12] Creating rooms...")
        rooms = await create_rooms(session, all_users, count=max(5, len(all_users) // 3))

        # 4. Seed Undercover words and pairs
        print("\n[4/12] Seeding Undercover words and pairs...")
        word_map = await seed_undercover_words(session)
        await seed_undercover_pairs(session, word_map)

        # 5. Seed Codenames words
        print("\n[5/12] Seeding Codenames word packs...")
        await seed_codenames_words(session)

        # 6. Seed achievements
        print("\n[6/12] Seeding achievement definitions...")
        await seed_achievements(session)

        # 7. Seed challenges
        print("\n[7/12] Seeding challenge definitions...")
        await seed_challenges(session)

        # 8. Create games and stats
        print(f"\n[8/12] Creating {num_games} games and user stats...")
        await create_games(session, all_users, count=num_games)
        await create_user_stats(session, test_users)

        # 9. Create friendships
        print("\n[9/12] Creating friendships...")
        await create_friendships(session, test_users)

        # 10. Create chat messages
        print("\n[10/12] Creating chat messages...")
        await create_chat_messages(session, test_users, rooms)

        # 11. Create user achievements (earned/in-progress)
        print("\n[11/12] Creating user achievements...")
        await create_user_achievements(session, test_users)

        # 12. Create user challenges (assigned daily/weekly)
        print("\n[12/12] Creating user challenges...")
        await create_user_challenges(session, test_users)

    print("\nFake data generation complete!")


async def seed_game_content(engine: AsyncEngine) -> None:
    """Seed only game content (words, term pairs, codenames, achievements, challenges).

    Safe for production — does not create fake users, rooms, or games.

    Args:
        engine: The database engine.
    """
    print("Creating database tables (if not exist)...")
    await create_db_and_tables(engine)

    async with AsyncSession(engine, expire_on_commit=False) as session:
        print("\n[1/4] Seeding Undercover words and pairs...")
        word_map = await seed_undercover_words(session)
        await seed_undercover_pairs(session, word_map)

        print("\n[2/4] Seeding Codenames word packs...")
        await seed_codenames_words(session)

        print("\n[3/4] Seeding achievement definitions...")
        await seed_achievements(session)

        print("\n[4/4] Seeding challenge definitions...")
        await seed_challenges(session)

    print("\nGame content seeding complete!")


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Generate fake data for IPG platform testing",
    )

    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--create-db", "-c",
        action="store_true",
        help="Create database tables and generate fake data",
    )
    group.add_argument(
        "--delete", "-d",
        action="store_true",
        help="Delete all data by dropping and recreating tables",
    )
    group.add_argument(
        "--seed", "-s",
        action="store_true",
        help="Seed game content only (words, term pairs, codenames, achievements, challenges). Safe for production.",
    )

    parser.add_argument(
        "--users",
        type=int,
        default=15,
        help="Number of additional random users to generate (default: 15)",
    )
    parser.add_argument(
        "--games",
        type=int,
        default=30,
        help="Number of games to generate (default: 30)",
    )

    return parser.parse_args()


async def main() -> None:
    """Main entry point for the fake data generation script."""
    global fake
    args = parse_args()

    # Import dev-only dependencies only when needed (not in production image)
    if args.create_db:
        from faker import Faker

        fake = Faker()

    settings = Settings()  # type: ignore[call-arg]
    engine = await create_app_engine(settings)

    try:
        if args.delete:
            await delete_all_data(engine)
        elif args.seed:
            await seed_game_content(engine)
        elif args.create_db:
            await generate_all_data(
                engine,
                num_users=args.users,
                num_games=args.games,
            )
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
