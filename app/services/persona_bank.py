"""A bank of 100 Sri Lankan consumer personas for the Pre-Launch Ad Test.

Each persona is a short, structured description (age, place, background, language, job, income, media habits, mindset), not a long prompt, so a whole panel
can be sent to Gemini in one compact call. The mix follows the country broadly (about three quarters Sinhala, the rest Tamil, Muslim and others; Colombo,
other towns, villages, estates, the North and East) and spreads ages from 16 to 75 and twelve mindsets. Backgrounds are listed because religion, language and
region change how an ad is read; the traits describe circumstances and habits, never a stereotype.
"""
from __future__ import annotations

from dataclasses import dataclass

# name | age | gender | place | background | main language | occupation | income | media habits | mindset | one line of character
ROWS = """
Sanduni|22|F|Colombo|Sinhala Buddhist|Singlish|University student|Lower-middle|TikTok, Instagram|Digital native|Meme-savvy, decides in a second, roasts cringe ads, values vibe over price
Kamala|42|F|Kandy|Sinhala Buddhist|Sinhala|Homemaker|Lower-middle|TV, Facebook, WhatsApp|Thrifty planner|Runs the household budget, family and tradition first
Dinesh|31|M|Colombo|Sinhala Buddhist|English|Corporate executive|Upper-middle|LinkedIn, YouTube, Instagram|Climber|Tech-savvy, time-poor, pays for quality, spots weak design
Chaminda|28|M|Galle|Sinhala Buddhist|Sinhala|Small shop owner|Middle|Facebook, TV, WhatsApp|Value hunter|Practical, thinks in daily costs, likes straight talk and clear offers
Tharushi|16|F|Gampaha|Sinhala Buddhist|Singlish|School student (O/L)|Middle|TikTok, YouTube, Instagram|Trend chaser|Follows creators, shares what looks fun, little money of her own
Kavindu|17|M|Matara|Sinhala Buddhist|Sinhala|School student (A/L)|Lower-middle|YouTube, Facebook, gaming streams|Digital native|Cricket and games, tuition-heavy week, tests data-heavy offers
Nethmi|19|F|Kurunegala|Sinhala Buddhist|Sinhala|Diploma student|Lower-middle|TikTok, Facebook|Trend chaser|First phone upgrade, loves K-pop and fashion, watches ads for ideas
Ishara|20|M|Colombo|Sinhala Buddhist|Singlish|Undergraduate (IT)|Middle|Reddit, YouTube, Instagram|Skeptic|Distrusts polished marketing, reads comments before believing a claim
Sachini|21|F|Peradeniya|Sinhala Buddhist|Sinhala|Undergraduate (arts)|Lower-middle|Instagram, Facebook, TV dramas|Community voice|Active in the student union, cares about social messages
Ravindu|23|M|Negombo|Sinhala Catholic|Singlish|Call centre agent|Lower-middle|TikTok, Netflix, Facebook|Trend chaser|Night shifts, wants fun and convenience, spends on data and food delivery
Fathima|20|F|Colombo|Muslim|English|Undergraduate (law)|Middle|Instagram, YouTube|Digital native|Articulate, watches for respectful portrayal of women and faith
Ayesha|18|F|Kalmunai|Muslim|Tamil|A/L student|Lower-middle|YouTube, Facebook, TV|Tradition keeper|Close to family, careful about modesty, shares via WhatsApp groups
Arjun|22|M|Jaffna|Sri Lankan Tamil Hindu|Tamil|Engineering undergraduate|Middle|YouTube, Instagram, Tamil cinema|Aspirer|Thinks of studying abroad, follows Tamil film and music trends
Thivya|19|F|Batticaloa|Sri Lankan Tamil Hindu|Tamil|Nursing student|Lower-middle|Facebook, TV serials, YouTube|Family provider|Wants to support her family, practical about every rupee
Janani|24|F|Colombo|Sri Lankan Tamil Hindu|English|Graphic designer|Middle|Instagram, Behance, Spotify|Trend chaser|Notices typography and layout, judges ads as design first
Chamodi|25|F|Colombo|Sinhala Buddhist|Singlish|Junior bank officer|Middle|Instagram, TV dramas, Facebook|Climber|Building savings, wants credible brands, reacts to loans and cards
Lahiru|26|M|Maharagama|Sinhala Buddhist|Singlish|Software engineer|Upper-middle|YouTube, X, Instagram|Digital native|Skips ads fast, rewards clever or funny ones, uses ad blockers
Nadeesha|27|F|Kandy|Sinhala Buddhist|Sinhala|Government clerk|Lower-middle|Facebook, TV, Sinhala radio|Thrifty planner|Fixed salary, compares prices before every buy, trusts familiar brands
Pasindu|27|M|Anuradhapura|Sinhala Buddhist|Sinhala|Three-wheeler driver|Lower-middle|Facebook, FM radio, TikTok|Value hunter|Long days on the road, likes simple offers, shares funny clips
Shanika|28|F|Colombo|Sinhala Buddhist|English|Marketing executive|Upper-middle|Instagram, LinkedIn, podcasts|Status seeker|Notices brand image, buys premium when it feels earned
Ruwan|29|M|Dubai|Sinhala Buddhist|Sinhala|Migrant worker (Gulf)|Middle|Facebook, YouTube, IMO|Aspirer|Sends money home, plans a house, responds to savings and remittance ads
Dilini|30|F|Galle|Sinhala Buddhist|Sinhala|Garment factory worker|Lower|Facebook, TV, WhatsApp|Family provider|Overtime for school fees, notices price first, wary of luxury messages
Ashwini|30|F|Jaffna|Sri Lankan Tamil Hindu|Tamil|Primary school teacher|Lower-middle|Facebook, YouTube, Tamil TV|Tradition keeper|Respected in her village, careful about values shown to children
Sivakumar|31|M|Vavuniya|Sri Lankan Tamil Hindu|Tamil|Small trader|Lower-middle|Facebook, Tamil radio, TV|Value hunter|Stock and credit worries, likes straightforward local-language ads
Nuwan|32|M|Kurunegala|Sinhala Buddhist|Sinhala|Farmer and part-time tuk driver|Lower|TV news, Facebook, radio|Thrifty planner|Weather and fertiliser prices drive his mood, trusts word of mouth
Hasini|32|F|Colombo|Sinhala Buddhist|Singlish|Young mother, works in HR|Upper-middle|Instagram, parenting groups, YouTube|Health-first|Reads labels, cares about child safety, wary of exaggerated claims
Sivapalan|34|M|Nuwara Eliya|Up-country Tamil|Tamil|Tea estate supervisor|Lower-middle|TV, Facebook, radio|Family provider|Estate life, saves for his children's education, prefers Tamil messages
Malathi|35|F|Hatton|Up-country Tamil|Tamil|Tea plucker|Lower|TV serials, FM radio|Thrifty planner|Daily wage, buys small packs, notices price and portion size
Suresh|35|M|Colombo|Sri Lankan Tamil Hindu|English|Accountant|Upper-middle|LinkedIn, YouTube, news sites|Skeptic|Reads the small print, asks what is the catch
Anoma|36|F|Gampaha|Sinhala Buddhist|Sinhala|Nurse|Middle|TV, Facebook, Viber|Health-first|Shift work, trusts health claims only with proof, tired at night
Prasanna|36|M|Matara|Sinhala Buddhist|Sinhala|Fisherman|Lower|Radio, TV, Facebook|Community voice|Cooperative society member, trusts what neighbours say
Sharmila|37|F|Colombo|Sri Lankan Tamil Hindu|English|Pharmacist|Upper-middle|Instagram, TV, WhatsApp|Health-first|Knows the facts, annoyed by misleading health or beauty claims
Farzana|38|F|Colombo|Muslim|English|Boutique owner|Upper-middle|Instagram, Facebook, WhatsApp|Climber|Runs her own shop, follows trends, thinks about margin on everything
Selvarani|39|F|Trincomalee|Sri Lankan Tamil Hindu|Tamil|Seamstress|Lower|TV serials, Facebook|Family provider|Sews at home, sends two children to school, buys on offer only
Yoga Rajah|40|M|Jaffna|Sri Lankan Tamil Hindu|Tamil|Shop owner|Middle|Facebook, Tamil TV, radio|Tradition keeper|Festival season matters, likes ads that respect Tamil culture
Sriyani|41|F|Kurunegala|Sinhala Buddhist|Sinhala|Paddy farmer's wife|Lower|TV dramas, radio, Facebook|Tradition keeper|Poya days and temple matter, prefers modest and respectful ads
Nazeer|41|M|Kandy|Muslim|Sinhala|Spice trader|Middle|Facebook, TV, WhatsApp|Value hunter|Negotiates everything, loves a bargain, quick to doubt big promises
Priyanka|42|F|Colombo|Sinhala Buddhist|English|School principal|Upper-middle|TV news, Facebook, Instagram|Tradition keeper|Role model in her community, dislikes vulgar or disrespectful ads
Anton|42|M|Negombo|Sinhala Catholic|Sinhala|Fishing boat owner|Middle|TV, Facebook, radio|Family provider|Church and family first, income rises and falls with the season
Roshini|43|F|Badulla|Sinhala Buddhist|Sinhala|Shopkeeper|Lower-middle|Facebook, TV, radio|Value hunter|Knows what sells in her town, trusts brands she can restock easily
Kumaran|43|M|Batticaloa|Sri Lankan Tamil Hindu|Tamil|Paddy and fish trader|Lower-middle|Facebook, Tamil radio, TV|Community voice|Knows everyone in the market, opinions travel by word of mouth
Dilshan|44|M|Colombo|Sinhala Buddhist|English|Company director|High|News sites, LinkedIn, golf club|Status seeker|Expects quality, notices cheap production at once
Fazna|44|F|Eravur|Muslim|Tamil|Madrasa teacher|Lower-middle|TV, Facebook, WhatsApp|Tradition keeper|Strong views on modesty and family values, shares trusted ads in her groups
Padmini|45|F|Anuradhapura|Sinhala Buddhist|Sinhala|Public health midwife|Lower-middle|TV, Facebook, radio|Health-first|Trusted by mothers in her area, wary of unproven health claims
Gamini|45|M|Polonnaruwa|Sinhala Buddhist|Sinhala|Paddy farmer|Lower|Radio, TV news, Facebook|Thrifty planner|Debt and harvest cycle, buys on credit, trusts the village shop
Jegatheeswaran|46|M|Jaffna|Sri Lankan Tamil Hindu|Tamil|Returnee from Europe|Upper-middle|YouTube, Facebook, Tamil news|Aspirer|Compares everything with abroad, likes international quality
Sumathi|46|F|Colombo|Sri Lankan Tamil Hindu|English|Government officer|Upper-middle|TV, Facebook, WhatsApp|Thrifty planner|Budget for a joint family, prefers trusted brands and clear prices
Lalith|47|M|Galle|Sinhala Buddhist|Sinhala|Bus conductor|Lower-middle|Radio, Facebook, TikTok|Community voice|Hears the public all day, laughs at ads that get local life right
Nilanthi|47|F|Dehiwala|Sinhala Buddhist|Singlish|Beautician|Middle|Instagram, Facebook, TV|Trend chaser|Salon owner, follows beauty and fashion, tries new products first
Rifaya|48|F|Colombo|Muslim|English|Caterer|Middle|Instagram, Facebook, TV|Climber|Grows her business through social media, wants ads that sell
Ariyaratne|48|M|Kurunegala|Sinhala Buddhist|Sinhala|Coconut estate owner|Upper-middle|TV news, Facebook, newspaper|Status seeker|Respected local figure, trusts established names
Kanthi|49|F|Matara|Sinhala Buddhist|Sinhala|Cinnamon peeler's wife|Lower|TV dramas, radio|Thrifty planner|Buys only what is needed, notices price per use
Wijeratne|49|M|Colombo|Sinhala Buddhist|English|Senior engineer, state sector|Upper-middle|Newspapers, TV news, Facebook|Skeptic|Expects facts and numbers, dislikes hype
Mary Josephine|50|F|Mannar|Sri Lankan Tamil Christian|Tamil|Fish seller|Lower|TV, radio, Facebook|Family provider|Early mornings at the market, family and church first
Basheer|50|M|Colombo|Muslim|English|Wholesale merchant|Upper-middle|TV, WhatsApp, newspapers|Value hunter|Thinks in margins and volume, sceptical of free offers
Chandrika|51|F|Kandy|Sinhala Buddhist|Sinhala|Retired teacher|Middle|TV, Facebook, newspaper|Tradition keeper|Pension, grandchildren, values good manners in ads
Ratnayake|52|M|Kalutara|Sinhala Buddhist|Sinhala|Rubber smallholder|Lower-middle|TV, radio, Facebook|Thrifty planner|Price swings worry him, buys brands he has always used
Vasanthi|52|F|Colombo|Sri Lankan Tamil Hindu|English|Senior nurse|Middle|TV, Facebook, WhatsApp|Health-first|Seen it all, believes health ads only with a doctor or data
Hemantha|53|M|Hambantota|Sinhala Buddhist|Sinhala|Hotel cook|Lower-middle|TV, Facebook, radio|Community voice|Proud of his region, likes ads that show local places
Zainab|53|F|Beruwala|Muslim|Sinhala|Gem and jewellery seller's wife|Middle|TV, Facebook, WhatsApp|Status seeker|Cares about appearance at family events, likes quality gold and fabric ads
Ganeshan|54|M|Hatton|Up-country Tamil|Tamil|Estate trade union member|Lower|TV, radio, Facebook|Community voice|Speaks for workers, angry at ads that ignore the poor
Sumanawathi|55|F|Anuradhapura|Sinhala Buddhist|Sinhala|Retired public servant|Lower-middle|TV, radio, newspaper|Tradition keeper|Observes sil, prefers calm and respectful ads, dislikes loud ones
Jayantha|55|M|Colombo|Sinhala Buddhist|Singlish|Taxi owner|Lower-middle|FM radio, Facebook, TV|Value hunter|Fuel price talker, likes ads with a clear saving
Rasika|56|F|Panadura|Sinhala Buddhist|Sinhala|Grocery shop owner|Middle|TV, Facebook, radio|Thrifty planner|Sells the brands she buys, cares about margin and fast movers
Abdul Cader|56|M|Akkaraipattu|Muslim|Tamil|Retired government clerk|Lower-middle|TV, radio, Facebook|Tradition keeper|Mosque and family, distrusts flashy or western-style ads
Pushpa|57|F|Nuwara Eliya|Up-country Tamil|Tamil|Vegetable seller|Lower|TV serials, radio|Thrifty planner|Sells at the market, buys small, notices the cheapest pack
Upali|58|M|Kegalle|Sinhala Buddhist|Sinhala|Retired army sergeant|Lower-middle|TV news, radio, newspaper|Tradition keeper|Duty and discipline, respects national symbols, dislikes mockery of them
Mallika|58|F|Colombo|Sinhala Buddhist|Singlish|Retired bank officer|Upper-middle|TV, Facebook, WhatsApp|Status seeker|Comfortable pension, likes premium brands and well made ads
Selliah|59|M|Jaffna|Sri Lankan Tamil Hindu|Tamil|Retired teacher|Lower-middle|Tamil newspapers, TV, radio|Tradition keeper|Reads ads carefully, notices language errors and poor Tamil
Leela|60|F|Matale|Sinhala Buddhist|Sinhala|Retired farmer|Lower|Radio, TV, temple notice board|Thrifty planner|Pension is small, buys little, trusts what the temple and neighbours say
Marikkar|60|M|Colombo|Muslim|English|Retired businessman|Upper-middle|TV news, newspapers, WhatsApp|Skeptic|Seen many ad campaigns, reads between the lines
Dharmadasa|61|M|Polonnaruwa|Sinhala Buddhist|Sinhala|Retired farmer|Lower|Radio, TV|Tradition keeper|Simple life, likes ads with village scenes and honest tone
Ranjani|62|F|Galle|Sinhala Buddhist|Sinhala|Retired teacher|Middle|TV, newspaper, Facebook|Health-first|Diabetes and blood pressure, interested in ads about medicine and food
Ahamed Lebbe|63|M|Kinniya|Muslim|Tamil|Retired fisherman|Lower|Radio, TV, WhatsApp|Community voice|Sits at the shop every evening, what he says spreads
Soma|64|F|Kandy|Sinhala Buddhist|Sinhala|Grandmother|Lower-middle|TV dramas, radio|Family provider|Looks after grandchildren, notices anything about kids or food
Nadarajah|65|M|Batticaloa|Sri Lankan Tamil Hindu|Tamil|Retired government surveyor|Lower-middle|Tamil radio, newspaper, TV|Skeptic|Careful with money, believes little until he sees proof
Chrishanthi|65|F|Colombo|Burgher|English|Retired secretary|Middle|TV, newspaper, radio|Tradition keeper|Old Colombo, likes well written, polite ads with good English
Wimal|66|M|Moneragala|Sinhala Buddhist|Sinhala|Retired estate clerk|Lower|Radio, TV|Thrifty planner|Fixed pension, very careful, buys in the smallest pack
Rajeswary|67|F|Jaffna|Sri Lankan Tamil Hindu|Tamil|Grandmother with family abroad|Lower-middle|Tamil TV, YouTube on her daughter's phone|Family provider|Receives money from abroad, likes ads about family and festivals
Pathmanathan|68|M|Colombo|Sri Lankan Tamil Hindu|English|Retired lawyer|Upper-middle|Newspapers, TV news|Skeptic|Reads every claim as a lawyer would, dislikes vague promises
Gunapala|70|M|Ratnapura|Sinhala Buddhist|Sinhala|Retired gem miner|Lower|Radio, TV news|Tradition keeper|Listens to the radio all day, trusts the voice of the announcer
Lucy|70|F|Negombo|Sinhala Catholic|Sinhala|Retired seamstress|Lower|TV, radio, parish bulletin|Family provider|Church community, helps her grandchildren, buys with care
Hussain|72|M|Galle|Muslim|English|Retired ship's officer|Middle|TV news, newspaper|Status seeker|Travelled widely, expects polish and clear English in ads
Kusuma|75|F|Kurunegala|Sinhala Buddhist|Sinhala|Retired village midwife|Lower|Radio, TV, temple|Tradition keeper|Elders' voice in the village, quick to judge what is disrespectful
Sajini|24|F|Colombo|Sinhala Buddhist|Singlish|Content creator|Middle|TikTok, Instagram, YouTube|Trend chaser|Lives on engagement, knows what travels and what flops
Dasun|25|M|Colombo|Sinhala Buddhist|English|Startup founder|Upper-middle|X, LinkedIn, YouTube|Climber|Pitches daily, drawn to bold ads with a clear offer
Ishani|26|F|Kandy|Sinhala Buddhist|Sinhala|Pre-school teacher|Lower-middle|Facebook, TikTok, TV|Community voice|Parents' groups decide what she believes, shares useful posts
Kasun|26|M|Kurunegala|Sinhala Buddhist|Sinhala|Apparel sales rep|Lower-middle|Facebook, TikTok, YouTube|Value hunter|Always on the move, loves discounts, forwards deals to friends
Amali|27|F|Colombo|Sinhala Christian|English|Event planner|Middle|Instagram, Pinterest|Trend chaser|Builds weddings and launches, loves strong visuals
Sivaranjani|28|F|Colombo|Sri Lankan Tamil Hindu|Tamil|Customer service agent|Lower-middle|YouTube, Facebook, Tamil TV|Aspirer|Saving for a flat, watches ads for loans and housing
Imran|29|M|Colombo|Muslim|English|Delivery rider|Lower-middle|TikTok, Facebook, YouTube|Value hunter|Counts fuel and time, notices any app offer
Thanuja|30|F|Galle|Sinhala Buddhist|Singlish|Tour guide|Middle|Instagram, TripAdvisor, TV|Climber|Meets foreigners daily, likes ads that make Sri Lanka look proud
Eranga|31|M|Kandy|Sinhala Buddhist|Sinhala|Cricket coach|Middle|YouTube, Facebook, TV|Community voice|Young players copy what he uses, shares gear and sports ads
Sharifa|33|F|Colombo|Muslim|English|Architect|Upper-middle|Instagram, Pinterest, LinkedIn|Status seeker|Eye for craft and detail, will pay more for good design
Prabath|34|M|Jaffna|Sri Lankan Tamil Hindu|Tamil|Doctor|Upper-middle|YouTube, Facebook, news|Health-first|Corrects misinformation daily, hostile to false health claims
Vindya|35|F|Colombo|Sinhala Buddhist|Singlish|Working mother, finance|Upper-middle|Instagram, parenting groups, TV|Family provider|No time, wants quick clear benefits, notices child-safety messages
Anwar|43|M|Colombo|Muslim|Sinhala|Garment exporter|High|TV news, LinkedIn, WhatsApp|Status seeker|Does business abroad, likes brands that feel world class
Sulochana|45|F|Hambantota|Sinhala Buddhist|Sinhala|Women's society leader|Lower-middle|Facebook, TV, radio|Community voice|Organises village women, endorses what she trusts
Rev. Daniel|48|M|Colombo|Sri Lankan Tamil Christian|English|Church youth pastor|Middle|Facebook, YouTube, WhatsApp|Community voice|Speaks to young people weekly, protective of values in ads
Pearl|55|F|Colombo|Burgher|English|Retired hotelier|Upper-middle|TV, newspaper, Facebook|Status seeker|Loves classic brands, notices polish and good taste
""".strip().splitlines()


@dataclass(frozen=True)
class Persona:
    id: str
    name: str
    age: int
    gender: str
    place: str
    background: str
    language: str
    job: str
    income: str
    media: str
    mindset: str
    trait: str
    core: bool

    @property
    def age_group(self) -> str:
        return age_group(self.age)

    @property
    def region(self) -> str:
        return region_of(self.place)

    def line(self) -> str:
        """The compact line sent to Gemini (about 45 tokens)."""
        return (f"{self.id}: {self.name}, {self.age} {self.gender}, {self.place}, {self.background}, speaks {self.language}, {self.job}, {self.income} income, "
                f"uses {self.media}. {self.mindset}: {self.trait}.")

    def profile(self) -> str:
        return f"{self.age} year old {self.job.lower()} in {self.place}. {self.background}. {self.mindset}."


def age_group(age: int) -> str:
    return "16 to 24" if age < 25 else "25 to 34" if age < 35 else "35 to 44" if age < 45 else "45 to 54" if age < 55 else "55 and over"


AGE_GROUPS = ["16 to 24", "25 to 34", "35 to 44", "45 to 54", "55 and over"]
COLOMBO = {"Colombo", "Dehiwala", "Moratuwa", "Maharagama"}
NORTH_EAST = {"Jaffna", "Vavuniya", "Mannar", "Batticaloa", "Trincomalee", "Kalmunai", "Eravur", "Akkaraipattu", "Kinniya"}
ESTATE = {"Nuwara Eliya", "Hatton"}
ABROAD = {"Dubai"}
REGIONS = ["Colombo", "Other towns and villages", "North and East", "Estates", "Working abroad"]


def region_of(place: str) -> str:
    return ("Colombo" if place in COLOMBO else "North and East" if place in NORTH_EAST else "Estates" if place in ESTATE
            else "Working abroad" if place in ABROAD else "Other towns and villages")


def _parse() -> tuple[Persona, ...]:
    out = []
    for i, row in enumerate(ROWS, 1):
        f = [x.strip() for x in row.split("|")]
        if len(f) != 11:
            raise ValueError(f"Persona row {i} has {len(f)} fields: {row[:60]}")
        out.append(Persona(f"P{i:03d}", f[0], int(f[1]), f[2], f[3], f[4], f[5], f[6], f[7], f[8], f[9], f[10], core=i <= 4))
    return tuple(out)


BANK: tuple[Persona, ...] = _parse()
BY_ID = {p.id: p for p in BANK}
PANEL_SIZES = {"quick": 12, "standard": 30, "full": 100}


def filter_bank(age_min: int = 0, age_max: int = 120, gender: str = "", region: str = "") -> list[Persona]:
    return [p for p in BANK if age_min <= p.age <= age_max and (not gender or p.gender == gender) and (not region or p.region == region)]


def select_panel(size: int, pool: list[Persona] | None = None) -> list[Persona]:
    """A balanced panel: take the core four first, then keep adding the persona that fills the thinnest age group, region, background, gender and mindset.
    Deterministic, so the same ad and settings always give the same panel (and the cache works)."""
    pool = list(pool if pool is not None else BANK)
    if size >= len(pool):
        return pool
    chosen: list[Persona] = [p for p in pool if p.core][:size]
    left = [p for p in pool if p not in chosen]
    counts: dict[tuple[str, str], int] = {}

    def keys(p: Persona) -> list[tuple[str, str]]:
        return [("age", p.age_group), ("region", p.region), ("bg", p.background), ("g", p.gender), ("mind", p.mindset)]

    for p in chosen:
        for k in keys(p):
            counts[k] = counts.get(k, 0) + 1
    while len(chosen) < size and left:
        best = min(left, key=lambda p: (sum(counts.get(k, 0) for k in keys(p)), p.id))
        chosen.append(best)
        left.remove(best)
        for k in keys(best):
            counts[k] = counts.get(k, 0) + 1
    return sorted(chosen, key=lambda p: p.id)
