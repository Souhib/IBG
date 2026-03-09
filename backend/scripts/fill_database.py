import asyncio
import random
import string
from datetime import timedelta

import pycountry
from faker import Faker
from sqlmodel import Session, SQLModel, create_engine

from ipg.api.controllers.room import RoomController
from ipg.api.controllers.undercover import UndercoverController
from ipg.api.controllers.user import UserController
from ipg.api.models.game import GameType
from ipg.api.models.room import RoomCreate, RoomJoin, RoomStatus
from ipg.api.models.table import Game, User
from ipg.api.models.undercover import Word
from ipg.api.models.user import UserCreate

DATABASE_URL = "sqlite:///database.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

fake = Faker()


def create_db_and_tables():
    SQLModel.metadata.create_all(engine)


sample_words = [
    {
        "id": fake.uuid4(),
        "word": "Hajj",
        "category": "Pillars of Islam",
        "short_description": "Pilgrimage to Mecca.",
        "long_description": "Hajj is the fifth pillar of Islam, requiring Muslims who are physically and financially able to undertake a pilgrimage to Mecca at least once in their lifetime.",
        "hint": {
            "en": "The annual pilgrimage to Mecca, one of the five pillars of Islam",
            "ar": "الحج السنوي إلى مكة، أحد أركان الإسلام الخمسة",
            "fr": "Le pèlerinage annuel à La Mecque, l'un des cinq piliers de l'islam",
        },
    },
    {
        "id": fake.uuid4(),
        "word": "Umrah",
        "category": "Islamic Rituals",
        "short_description": "Minor pilgrimage to Mecca.",
        "long_description": "Umrah, the minor pilgrimage to Mecca, can be undertaken at any time of the year, unlike Hajj, which has specific dates according to the Islamic lunar calendar.",
        "hint": {
            "en": "The minor pilgrimage to Mecca, can be performed at any time of year",
            "ar": "العمرة، الحج الأصغر إلى مكة، يمكن أداؤها في أي وقت من السنة",
            "fr": "Le petit pèlerinage à La Mecque, peut être accompli à tout moment de l'année",
        },
    },
    {
        "id": fake.uuid4(),
        "word": "Salah",
        "category": "Pillars of Islam",
        "short_description": "Islamic ritual prayer.",
        "long_description": "Salah is the second pillar of Islam, consisting of five daily prayers that are obligatory for all adult Muslims.",
        "hint": {
            "en": "The five daily prayers, the second pillar of Islam",
            "ar": "الصلوات الخمس اليومية، الركن الثاني من أركان الإسلام",
            "fr": "Les cinq prières quotidiennes, le deuxième pilier de l'islam",
        },
    },
    {
        "id": fake.uuid4(),
        "word": "Sawm",
        "category": "Pillars of Islam",
        "short_description": "Fasting during Ramadan.",
        "long_description": "Sawm, or fasting, is the fourth pillar of Islam, observed during the month of Ramadan, where Muslims fast from dawn until sunset.",
        "hint": {
            "en": "Fasting from dawn to sunset during Ramadan, the fourth pillar of Islam",
            "ar": "الصيام من الفجر حتى غروب الشمس خلال رمضان، الركن الرابع من أركان الإسلام",
            "fr": "Le jeûne de l'aube au coucher du soleil pendant le Ramadan, le quatrième pilier de l'islam",
        },
    },
    {
        "id": fake.uuid4(),
        "word": "Zakat",
        "category": "Pillars of Islam",
        "short_description": "Compulsory charity.",
        "long_description": "Zakat is the third pillar of Islam, requiring Muslims to give a fixed portion of their wealth to the needy.",
        "hint": {
            "en": "Obligatory charity — giving a fixed portion of wealth to the needy",
            "ar": "الزكاة — إعطاء نسبة محددة من المال للمحتاجين",
            "fr": "L'aumône obligatoire — donner une part fixe de sa richesse aux nécessiteux",
        },
    },
    {
        "id": fake.uuid4(),
        "word": "Sadaqah",
        "category": "Islamic Charitable Practices",
        "short_description": "Voluntary charity.",
        "long_description": "Sadaqah refers to voluntary charitable acts performed by Muslims, extending beyond monetary donations to include acts of kindness and generosity.",
        "hint": {
            "en": "Voluntary charity and acts of kindness beyond obligatory giving",
            "ar": "الصدقة التطوعية وأعمال الخير التي تتجاوز العطاء الواجب",
            "fr": "La charité volontaire et les actes de bonté au-delà du don obligatoire",
        },
    },
    {
        "id": fake.uuid4(),
        "word": "Shahada",
        "category": "Pillars of Islam",
        "short_description": "Islamic declaration of faith.",
        "long_description": "The Shahada is the first pillar of Islam, expressing the declaration of faith in the oneness of Allah and the prophethood of Muhammad.",
        "hint": {
            "en": "The declaration of faith — 'There is no god but Allah, and Muhammad is His messenger'",
            "ar": "شهادة أن لا إله إلا الله وأن محمداً رسول الله",
            "fr": "La déclaration de foi — 'Il n'y a de dieu qu'Allah et Muhammad est Son messager'",
        },
    },
    {
        "id": fake.uuid4(),
        "word": "Tawhid",
        "category": "Islamic Beliefs",
        "short_description": "Oneness of God in Islam.",
        "long_description": "Tawhid is the principle of monotheism in Islam, affirming the oneness and absolute sovereignty of God as the central tenet of the Islamic faith.",
        "hint": {
            "en": "The fundamental principle of God's oneness and absolute sovereignty",
            "ar": "المبدأ الأساسي لوحدانية الله وسيادته المطلقة",
            "fr": "Le principe fondamental de l'unicité de Dieu et de Sa souveraineté absolue",
        },
    },
    {
        "id": fake.uuid4(),
        "word": "Jihad",
        "category": "Islamic Concepts",
        "short_description": "Struggle or effort in the way of God.",
        "long_description": "Jihad represents a broad Islamic concept that encompasses struggle against evil inclinations, effort in the way of God, and in some contexts, warfare in defense of the Islamic community.",
        "hint": {
            "en": "Struggle and effort in the way of God, including inner spiritual struggle",
            "ar": "الجهاد في سبيل الله، بما في ذلك الجهاد الروحي الداخلي",
            "fr": "L'effort et la lutte dans la voie de Dieu, y compris la lutte spirituelle intérieure",
        },
    },
    {
        "id": fake.uuid4(),
        "word": "Hijrah",
        "category": "Islamic History",
        "short_description": "Prophet Muhammad's migration to Medina.",
        "long_description": "The Hijrah refers to the migration of the Prophet Muhammad and his followers from Mecca to Medina in 622 CE, marking the beginning of the Islamic calendar.",
        "hint": {
            "en": "The Prophet's migration from Mecca to Medina in 622 CE, start of the Islamic calendar",
            "ar": "هجرة النبي من مكة إلى المدينة عام 622 م، بداية التقويم الهجري",
            "fr": "La migration du Prophète de La Mecque à Médine en 622, début du calendrier islamique",
        },
    },
]

sample_pairs = [
    {
        "word1_id": sample_words[0]["id"],
        "word2_id": sample_words[1]["id"],
        "category": "Pilgrimages",
        "short_description": "Hajj and Umrah",
        "long_description": "Both Hajj and Umrah are Islamic pilgrimages to Mecca, but Hajj is mandatory and performed on specific dates, while Umrah is voluntary and can be performed any time.",
    },
    {
        "word1_id": sample_words[2]["id"],
        "word2_id": sample_words[3]["id"],
        "category": "Pillars of Islam",
        "short_description": "Salah and Sawm",
        "long_description": "Salah and Sawm are both pillars of Islam, emphasizing the spiritual practices of prayer and fasting, respectively.",
    },
    {
        "word1_id": sample_words[4]["id"],
        "word2_id": sample_words[5]["id"],
        "category": "Charitable Practices",
        "short_description": "Zakat and Sadaqah",
        "long_description": "Zakat and Sadaqah represent forms of charity in Islam, with Zakat being compulsory and Sadaqah being voluntary.",
    },
    {
        "word1_id": sample_words[6]["id"],
        "word2_id": sample_words[7]["id"],
        "category": "Fundamental Beliefs",
        "short_description": "Shahada and Tawhid",
        "long_description": "Shahada, the declaration of faith, and Tawhid, the oneness of God, are central to Islamic belief, emphasizing monotheism and the acceptance of Muhammad as God's prophet.",
    },
    {
        "word1_id": sample_words[8]["id"],
        "word2_id": sample_words[9]["id"],
        "category": "Islamic Concepts and History",
        "short_description": "Jihad and Hijrah",
        "long_description": "Jihad, denoting struggle in the way of God, and Hijrah, the migration to Medina, are significant in Islamic teachings and history, symbolizing spiritual and physical journeys for faith.",
    },
]


def generate_fake_users(num_users: int) -> list[User]:
    users = [
        User(
            username=fake.user_name(),
            email_address=fake.email(),
            country=fake.country(),
            password=fake.password(),
        )
        for _ in range(num_users)
    ]
    return users


def generate_sample_games(users: list[User], num_games: int) -> list[Game]:
    return [
        Game(
            user_id=(random.choice(users)).id,
            start_time=(start_time := fake.past_datetime(start_date="-30d")),
            end_time=(start_time + timedelta(minutes=random.randint(1, 15)) if random.choice([True, False]) else None),
            number_of_players=random.randint(1, 8),
            type=random.choice(list(GameType)),
        )
        for _ in range(num_games)
    ]


async def insert_sample_data() -> None:
    with Session(engine, expire_on_commit=False) as session:
        user_controller = UserController(session)
        room_controller = RoomController(session)
        # game_controller = GameController(session)
        undercover_controller = UndercoverController(session)

        users = [
            await user_controller.create_user(
                UserCreate(
                    username=fake.user_name(),
                    email_address=fake.email(),
                    country=random.choice([country.alpha_3 for country in pycountry.countries]),
                    password=fake.password(),
                )
            )
            for _ in range(4)
        ]

        owner = random.choice(users)

        room = await room_controller.create_room(
            RoomCreate(
                status=random.choice(list(RoomStatus)),
                password="".join(random.choice(string.digits) for _ in range(4)),
                owner_id=owner.id,
            )
        )

        for user in users:
            if user.id != room.owner_id:
                await room_controller.join_room(RoomJoin(room_id=room.id, user_id=user.id, password=room.password))

        for sample_word in sample_words:
            new_word = Word(**sample_word)
            session.add(new_word)
            session.commit()

        for sample_pair in sample_pairs:
            await undercover_controller.create_term_pair(
                word1_id=sample_pair["word1_id"], word2_id=sample_pair["word2_id"]
            )

    # game = await game_controller.create_game(
    #     GameCreate(
    #         room_id=room.id,
    #         number_of_players=len(users),
    #         type=GameType.UNDERCOVER
    #     )
    # )


if __name__ == "__main__":
    create_db_and_tables()
    asyncio.run(insert_sample_data())
    print("Database populated with sample data.")
