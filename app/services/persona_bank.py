"""A bank of 200 Sri Lankan consumer personas for the Pre-Launch Ad Test.

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
Hiruni|16|F|Embilipitiya|Sinhala Buddhist|Sinhala|School student (O/L)|Lower|TikTok, YouTube|Trend chaser|Shares dance clips, saves pocket money for a phone, mother decides most buys
Yasith|17|M|Kuliyapitiya|Sinhala Buddhist|Sinhala|School student (A/L, commerce)|Lower-middle|YouTube, Facebook, FM radio|Aspirer|Dreams of studying business, watches finance creators, careful with exam-year time
Kavishka|18|M|Horana|Sinhala Buddhist|Singlish|Vocational trainee (electrician)|Lower|TikTok, Facebook, gaming|Value hunter|Data packages and cheap food deals rule his budget
Dinithi|19|F|Kegalle|Sinhala Buddhist|Sinhala|Nursing trainee|Lower-middle|Facebook, Instagram, TV dramas|Health-first|Learning about health, quick to notice misleading medicine claims
Sahan|20|M|Ampara|Sinhala Buddhist|Sinhala|Army recruit|Lower-middle|Facebook, YouTube, radio|Tradition keeper|Proud and disciplined, dislikes anything that mocks the forces
Rizna|20|F|Puttalam|Muslim|Tamil|Undergraduate (education)|Lower-middle|Instagram, YouTube, WhatsApp|Community voice|Speaks for her friends group, careful about modest dress in ads
Pradeep|21|M|Ratnapura|Sinhala Buddhist|Sinhala|Gem cutter apprentice|Lower|Facebook, TikTok|Value hunter|Earns by the piece, loves a lucky draw or cash-back offer
Sewwandi|22|F|Matara|Sinhala Buddhist|Singlish|Undergraduate (management)|Lower-middle|Instagram, TikTok, LinkedIn|Climber|Building a CV, likes brands that feel modern and fair
Tharindu|22|M|Kurunegala|Sinhala Buddhist|Sinhala|Delivery rider|Lower|TikTok, Facebook, YouTube|Value hunter|Lives on fuel and phone credit, reacts to anything that saves rupees
Malsha|23|F|Gampaha|Sinhala Catholic|Singlish|Bank trainee|Middle|Instagram, Facebook|Status seeker|First salary, buys small luxuries, follows fashion pages
Ishan|23|M|Galle|Sinhala Buddhist|English|Surf instructor|Lower-middle|Instagram, TikTok, YouTube|Trend chaser|Beach crowd and tourists, loves bold visuals and humour
Nisansala|24|F|Polonnaruwa|Sinhala Buddhist|Sinhala|Pre-school teacher|Lower|Facebook, TV dramas|Family provider|Helps her parents' paddy family, careful and practical
Jathushan|24|M|Kilinochchi|Sri Lankan Tamil Hindu|Tamil|Mobile repair shop worker|Lower|Facebook, YouTube, Tamil cinema|Aspirer|Wants to open his own shop, follows tech and film news in Tamil
Sudu Banda|60|M|Mahiyanganaya|Sinhala Buddhist|Sinhala|Paddy farmer|Lower|Radio, TV news|Tradition keeper|Village elder, trusts the temple and radio, wary of city ways
Imasha|24|F|Seoul|Sinhala Buddhist|Sinhala|Factory worker in Korea|Middle|Facebook, YouTube, IMO|Aspirer|Saves to build a house at home, watches remittance and land ads
Lakshitha|25|M|Kandy|Sinhala Buddhist|Singlish|Hotel front office|Lower-middle|Instagram, Facebook, TV|Status seeker|Dresses well for work, notices brand image and grooming ads
Nuwanthika|26|F|Hambantota|Sinhala Buddhist|Sinhala|Garment factory supervisor|Lower-middle|Facebook, TikTok, TV|Family provider|Sends money home, buys family packs, distrusts hard selling
Chathura|27|M|Badulla|Sinhala Buddhist|Sinhala|Tea factory technician|Lower-middle|Facebook, YouTube, radio|Thrifty planner|Plans every month's spend, buys trusted brands in bulk
Sajeewani|28|F|Dambulla|Sinhala Buddhist|Sinhala|Vegetable wholesaler|Middle|Facebook, WhatsApp, TV|Value hunter|Trades at the economic centre at dawn, quick with numbers
Naveen|28|M|Doha|Sinhala Buddhist|Singlish|Driver in Qatar|Middle|Facebook, YouTube, TikTok|Aspirer|Away from family, buys gifts and insurance for home, emotional about family ads
Shalini|29|F|Jaffna|Sri Lankan Tamil Hindu|Tamil|Bank clerk|Middle|Instagram, Facebook, Tamil TV|Climber|Modern but traditional at home, notices how Tamil is written in ads
Mahesh|29|M|Avissawella|Sinhala Buddhist|Sinhala|Rubber estate supervisor|Lower-middle|Facebook, radio, TV|Community voice|Respected in the estate line rooms, shares useful information
Gayathri|30|F|Weligama|Sinhala Buddhist|Sinhala|Homestay owner|Middle|Facebook, Instagram, Booking sites|Climber|Tourism runs her income, likes ads that show the south coast proudly
Thilak|31|M|Chilaw|Sinhala Catholic|Sinhala|Fish trader|Lower-middle|Facebook, radio, TV|Value hunter|Up at three for the auction, buys what lasts
Ruwani|31|F|Kuliyapitiya|Sinhala Buddhist|Sinhala|Government development officer|Middle|Facebook, TV, WhatsApp|Thrifty planner|Steady salary, loan for a house, compares interest rates carefully
Mohamed Fazil|32|M|Kattankudy|Muslim|Tamil|Textile shop owner|Middle|Facebook, WhatsApp, YouTube|Value hunter|Busy before festivals, knows his customers and their budgets
Kumari|33|F|Welimada|Sinhala Buddhist|Sinhala|Vegetable farmer|Lower|Radio, TV, Facebook|Thrifty planner|Up-country farming family, every rupee goes to the children
Ravi|33|M|Talawakele|Up-country Tamil|Tamil|Estate driver|Lower|TV, radio, Facebook|Family provider|Long shifts, family of five, respects ads that show estate life with dignity
Prabodhini|34|F|Homagama|Sinhala Buddhist|Singlish|IT business analyst|Upper-middle|LinkedIn, Instagram, YouTube|Skeptic|Reads reviews before any buy, hates exaggeration
Shiyam|34|M|Mullaitivu|Sri Lankan Tamil Hindu|Tamil|Fisherman|Lower|Radio, Facebook|Community voice|Village rebuilt after the war, distrusts outsiders' promises
Chandani|35|F|Bandarawela|Sinhala Buddhist|Sinhala|Grocery shop owner|Lower-middle|Facebook, TV, radio|Value hunter|Sells small packs to neighbours on credit, knows what moves
Indika|36|M|Wennappuwa|Sinhala Catholic|Sinhala|Coconut mill worker|Lower|Radio, TV, Facebook|Family provider|Works with his hands, church and family first
Thushari|36|F|Kalutara|Sinhala Buddhist|Sinhala|Garment machine operator|Lower|Facebook, TikTok, TV|Thrifty planner|Shift work, buys on payday, watches dramas with her mother
Rafeek|37|M|Akurana|Muslim|Sinhala|Spice and tea trader|Upper-middle|WhatsApp, Facebook, news|Status seeker|Family business, likes premium brands and respectful ads
Dilrukshi|37|F|Gampaha|Sinhala Buddhist|Singlish|Insurance team leader|Middle|Facebook, LinkedIn, TV|Climber|Target driven, admires confident and clear ads
Sivanesan|38|M|Maskeliya|Up-country Tamil|Tamil|Tea factory clerk|Lower-middle|TV, Facebook, radio|Tradition keeper|Temple festivals and family, wants his children to do better
Anusha|38|F|Matale|Sinhala Buddhist|Sinhala|Spice garden owner|Middle|Facebook, TV|Health-first|Grows and sells herbs, believes in natural products, suspicious of chemicals
Sujith|39|M|Moneragala|Sinhala Buddhist|Sinhala|Sugarcane farmer|Lower|Radio, TV|Thrifty planner|Remote village, buys at the weekly fair, trusts the shopkeeper
Rohini|40|F|Kalmunai|Sri Lankan Tamil Hindu|Tamil|Primary teacher|Lower-middle|Facebook, Tamil TV, WhatsApp|Tradition keeper|Notices respect for culture and correct Tamil wording
Asanka|40|M|Kadawatha|Sinhala Buddhist|Singlish|Logistics supervisor|Middle|Facebook, YouTube, TV|Skeptic|Long commute, cynical about adverts that overpromise
Kanthimathi|41|F|Haputale|Up-country Tamil|Tamil|Tea plucker|Lower|TV serials, radio|Family provider|Daily wage, watches serials at night, buys the smallest pack
Nalaka|42|M|Tissamaharama|Sinhala Buddhist|Sinhala|Safari jeep driver|Lower-middle|Facebook, TikTok, radio|Community voice|Talks to tourists and villagers, loves a good joke in ads
Sandya|42|F|Ja-Ela|Sinhala Catholic|Sinhala|Tailoring shop owner|Lower-middle|Facebook, TV, WhatsApp|Family provider|Church groups and school parents, shares useful offers
Jayalath|43|M|Kurunegala|Sinhala Buddhist|Sinhala|Bus owner|Middle|Facebook, radio, TV news|Status seeker|Local businessman, likes strong brands and big promotions
Nirmala|44|F|Panadura|Sinhala Buddhist|Sinhala|School canteen owner|Lower-middle|Facebook, TV|Health-first|Feeds children daily, cares about food safety and sugar
Senthil|44|M|Trincomalee|Sri Lankan Tamil Hindu|Tamil|Port worker|Lower-middle|Facebook, Tamil radio, TV|Thrifty planner|Shift work at the harbour, careful and practical spender
Pushpakumari|45|F|Anuradhapura|Sinhala Buddhist|Sinhala|Ayurvedic oil maker|Lower-middle|TV, radio, Facebook|Tradition keeper|Herbal knowledge from her mother, trusts natural and local
Ajith|45|M|Galle|Sinhala Buddhist|Sinhala|Three-wheeler driver|Lower|Radio, Facebook, TikTok|Value hunter|Hears every rumour in town, laughs at ads that get local talk right
Fathima Rinoza|46|F|Mawanella|Muslim|Sinhala|Home baker and caterer|Lower-middle|Facebook, WhatsApp, YouTube|Climber|Grows orders through WhatsApp groups, watches food ads closely
Sunil|46|M|Hambantota|Sinhala Buddhist|Sinhala|Salt pan worker|Lower|Radio, TV|Family provider|Hard physical work, buys the same trusted brands every month
Indrani|47|F|Kandy|Sinhala Buddhist|Sinhala|Temple dayaka society member|Lower-middle|TV, radio, Facebook|Tradition keeper|Organises alms givings, quick to spot disrespect to religion
Rajkumar|47|M|Badulla|Up-country Tamil|Tamil|Small trader|Lower-middle|Tamil TV, Facebook, radio|Value hunter|Runs a boutique near the estate, knows what workers can afford
Sriyalatha|48|F|Matara|Sinhala Buddhist|Sinhala|Lace maker|Lower|TV dramas, radio|Thrifty planner|Works from home, careful with money, loves family dramas
Upul|48|M|Moratuwa|Sinhala Christian|Sinhala|Carpenter and furniture maker|Lower-middle|Facebook, YouTube, radio|Community voice|Proud craftsman, admires good workmanship and honest ads
Kalyani|49|F|Polonnaruwa|Sinhala Buddhist|Sinhala|Women's farmer society secretary|Lower|Radio, TV, Facebook|Community voice|Village women listen to her, shares what she trusts
Gnanasekaran|50|M|Vavuniya|Sri Lankan Tamil Hindu|Tamil|Rice mill owner|Middle|Tamil newspaper, Facebook, TV|Skeptic|Seen many promises, believes numbers and proof
Malini|50|F|Kegalle|Sinhala Buddhist|Sinhala|Retired garment worker|Lower|TV, radio|Family provider|Looks after grandchildren while her daughter works
Sarath|51|M|Embilipitiya|Sinhala Buddhist|Sinhala|Banana farmer|Lower-middle|Radio, TV news, Facebook|Thrifty planner|Prices at the market decide his month, slow to try new brands
Hemamali|52|F|Gampaha|Sinhala Buddhist|Sinhala|Pharmacy assistant|Lower-middle|TV, Facebook, WhatsApp|Health-first|Customers ask her advice, dislikes miracle claims
Nazar|52|M|Puttalam|Muslim|Tamil|Fish dryer and trader|Lower-middle|Facebook, WhatsApp, radio|Value hunter|Seasonal income, negotiates hard, wary of hidden charges
Kusumawathi|53|F|Ratnapura|Sinhala Buddhist|Sinhala|Gem merchant's wife|Middle|TV dramas, Facebook|Status seeker|Family weddings and gold jewellery matter, likes elegant ads
Ananda|54|M|Kandy|Sinhala Buddhist|Sinhala|Retired school principal|Middle|Newspaper, TV news|Skeptic|Corrects grammar in ads, values honesty and education
Sumithra|55|F|Kurunegala|Sinhala Buddhist|Sinhala|Coconut land owner|Middle|TV, newspaper, Facebook|Tradition keeper|Old family, values good manners, dislikes loud ads
Weerasinghe|56|M|Avissawella|Sinhala Buddhist|Sinhala|Retired railway guard|Lower-middle|Radio, TV news|Thrifty planner|Fixed pension, reads the price before the name
Selvi|56|F|Nuwara Eliya|Up-country Tamil|Tamil|Vegetable stall owner|Lower|TV serials, radio|Thrifty planner|Up before dawn at the market, buys the cheapest good option
Bandula|57|M|Dambulla|Sinhala Buddhist|Sinhala|Farmer and village council member|Lower-middle|Radio, TV, Facebook|Community voice|Influences his village, opinions spread at the temple
Premawathi|58|F|Galle|Sinhala Buddhist|Sinhala|Retired midwife|Lower-middle|TV, radio|Health-first|Trusted on health in her village, wary of exaggerated claims
Mohideen|58|M|Kalmunai|Muslim|Tamil|Retired teacher|Lower-middle|Tamil radio, newspaper, WhatsApp|Tradition keeper|Mosque committee member, quick to object to disrespect
Chandralatha|59|F|Matale|Sinhala Buddhist|Sinhala|Housewife|Lower-middle|TV dramas, radio|Family provider|Cooks for a big family, trusts brands her mother used
Jinadasa|60|M|Badulla|Sinhala Buddhist|Sinhala|Retired tea estate manager|Middle|Newspaper, TV news|Status seeker|Proud of a career in tea, prefers classic, dignified ads
Rasammah|60|F|Jaffna|Sri Lankan Tamil Christian|Tamil|Retired nurse|Lower-middle|Tamil TV, radio, WhatsApp|Health-first|Children abroad send money, careful about health products
Siripala|61|M|Hambantota|Sinhala Buddhist|Sinhala|Retired farmer|Lower|Radio, TV|Tradition keeper|Simple village life, trusts the radio announcer and the monk
Karunawathi|62|F|Anuradhapura|Sinhala Buddhist|Sinhala|Retired teacher|Lower-middle|TV, newspaper|Thrifty planner|Pension and savings, careful with every purchase
Thambiah|63|M|Batticaloa|Sri Lankan Tamil Hindu|Tamil|Retired fisherman|Lower|Tamil radio, TV|Community voice|Sits with friends at the tea shop, views travel fast
Leelawathi|64|F|Kegalle|Sinhala Buddhist|Sinhala|Grandmother|Lower|TV dramas, radio|Family provider|Minds grandchildren, notices anything about food and safety
Piyadasa|65|M|Kurunegala|Sinhala Buddhist|Sinhala|Retired bus driver|Lower|Radio, TV news|Skeptic|Has seen prices rise for decades, doubts big promises
Sitti|65|F|Akurana|Muslim|Sinhala|Grandmother in a trading family|Middle|TV, WhatsApp on her son's phone|Tradition keeper|Strong views on modesty and family values
Ranjith|66|M|Matara|Sinhala Buddhist|Sinhala|Retired postmaster|Lower-middle|Newspaper, radio, TV|Thrifty planner|Reads every word, trusts official looking information
Dayawathi|67|F|Polonnaruwa|Sinhala Buddhist|Sinhala|Retired farmer|Lower|Radio, TV|Tradition keeper|Observes sil on poya, prefers calm and respectful ads
Kandiah|68|M|Kilinochchi|Sri Lankan Tamil Hindu|Tamil|Retired farmer|Lower|Tamil radio|Family provider|Rebuilt his home twice, values reliability over fashion
Soma Kanthi|69|F|Gampaha|Sinhala Buddhist|Sinhala|Retired seamstress|Lower|TV, radio|Thrifty planner|Small pension, watches every rupee, buys in small amounts
Wickramasinghe|70|M|Kandy|Sinhala Buddhist|English|Retired lawyer|Upper-middle|Newspaper, TV news|Skeptic|Reads claims like contracts, values understatement
Nandawathi|71|F|Kurunegala|Sinhala Buddhist|Sinhala|Grandmother|Lower|Radio, TV dramas|Tradition keeper|Elder of a large family, offended by vulgar or loud ads
Mariyadas|72|M|Mannar|Sri Lankan Tamil Christian|Tamil|Retired fisherman|Lower|Radio, TV|Community voice|Church and village life, trusts familiar voices
Gunawathi|73|F|Moneragala|Sinhala Buddhist|Sinhala|Retired farmer|Lower|Radio|Thrifty planner|Remote village, few purchases, loyal to old brands
Hemapala|74|M|Galle|Sinhala Buddhist|Sinhala|Retired fisherman|Lower|Radio, TV|Tradition keeper|Proud of the sea and the old ways, laughs at honest humour
Abeysekara|75|M|Colombo|Sinhala Buddhist|English|Retired civil servant|Upper-middle|Newspaper, TV news|Status seeker|Old Colombo gentleman, expects courtesy and good English
Nethra|21|F|Batticaloa|Sri Lankan Tamil Hindu|Tamil|Undergraduate (arts)|Lower-middle|Instagram, YouTube, Tamil music|Digital native|Follows Tamil creators, roasts ads that get Tamil wrong
Shehan|26|M|Negombo|Sinhala Catholic|Singlish|Airline ground staff|Middle|Instagram, TikTok, Netflix|Trend chaser|Fashion conscious, likes slick international style ads
Ayodya|27|F|Kurunegala|Sinhala Buddhist|Sinhala|Government school teacher|Lower-middle|Facebook, TikTok, TV|Thrifty planner|New teacher on a small salary, careful but likes good design
Riyaz|31|M|Kurunegala|Muslim|Sinhala|Electronics shop owner|Middle|Facebook, YouTube, WhatsApp|Value hunter|Knows every phone deal, quick to check claims
Dilani|33|F|Bandarawela|Sinhala Buddhist|Sinhala|Up-country hotel housekeeper|Lower|Facebook, TV|Family provider|Seasonal tourism job, two children, buys family packs
Prasad|35|M|Ratnapura|Sinhala Buddhist|Sinhala|Police constable|Lower-middle|Facebook, TV news, radio|Tradition keeper|Respects order and authority, dislikes ads that mock officials
Thamara|39|F|Kelaniya|Sinhala Buddhist|Singlish|Online clothing seller|Middle|Facebook, Instagram, TikTok|Climber|Runs her shop through social media, studies what goes viral
Lalani|43|F|Ampara|Sinhala Buddhist|Sinhala|Paddy farming widow|Lower|Radio, TV|Family provider|Runs the farm alone, very careful with money and trust
Velu|45|M|Agarapathana|Up-country Tamil|Tamil|Estate field officer|Lower-middle|Tamil TV, Facebook|Community voice|Speaks for estate families, sensitive to how workers are shown
Jayanthi|51|F|Colombo|Sinhala Buddhist|English|NGO programme manager|Upper-middle|LinkedIn, news sites, Facebook|Skeptic|Spots stereotypes and tone-deaf messages at once
Faiz|23|M|Colombo|Malay|English|Graphic design student|Lower-middle|Instagram, Behance, TikTok|Digital native|Judges ads on design and wit, small but vocal community
Vinoth|19|M|Hatton|Up-country Tamil|Tamil|Estate youth, part-time shop help|Lower|TikTok, Tamil music, Facebook|Aspirer|Wants a city job, follows Tamil creators, money is tight
Upeksha|18|F|Anuradhapura|Sinhala Buddhist|Sinhala|A/L student (science)|Lower-middle|YouTube, Facebook, TV|Health-first|Wants to be a doctor, trusts science, quick to doubt fake claims
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

    @property
    def ethnic_group(self) -> str:
        return ethnic_group(self.background)

    def line(self) -> str:
        """The compact line sent to Gemini (about 45 tokens)."""
        return (f"{self.id}: {self.name}, {self.age} {self.gender}, {self.place}, {self.background}, speaks {self.language}, {self.job}, {self.income} income, "
                f"uses {self.media}. {self.mindset}: {self.trait}.")

    def profile(self) -> str:
        return f"{self.age} year old {self.job.lower()} in {self.place}. {self.background}. {self.mindset}."


def age_group(age: int) -> str:
    return "16 to 24" if age < 25 else "25 to 34" if age < 35 else "35 to 44" if age < 45 else "45 to 54" if age < 55 else "55 and over"


AGE_GROUPS = ["16 to 24", "25 to 34", "35 to 44", "45 to 54", "55 and over"]
COLOMBO = {"Colombo", "Dehiwala", "Moratuwa", "Maharagama", "Kelaniya"}
NORTH_EAST = {"Jaffna", "Vavuniya", "Mannar", "Batticaloa", "Trincomalee", "Kalmunai", "Eravur", "Akkaraipattu", "Kinniya", "Kilinochchi", "Mullaitivu", "Ampara", "Kattankudy"}
ESTATE = {"Nuwara Eliya", "Hatton", "Talawakele", "Maskeliya", "Haputale", "Agarapathana"}
ABROAD = {"Dubai", "Doha", "Seoul"}
REGIONS = ["Colombo", "Other towns and villages", "North and East", "Estates", "Working abroad"]


ETHNIC_GROUPS = ["Sinhala", "Sri Lankan Tamil", "Muslim", "Up-country Tamil", "Other"]


def ethnic_group(background: str) -> str:
    b = background.lower()
    if b.startswith("sinhala"):
        return "Sinhala"
    if b.startswith("sri lankan tamil"):
        return "Sri Lankan Tamil"
    if b.startswith("up-country tamil"):
        return "Up-country Tamil"
    if b in ("muslim", "malay"):
        return "Muslim"
    return "Other"


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
PANEL_SIZES = {"quick": 12, "standard": 30, "full": 100, "complete": 200}


def filter_bank(age_min: int = 0, age_max: int = 120, gender: str = "", region: str = "") -> list[Persona]:
    return [p for p in BANK if age_min <= p.age <= age_max and (not gender or p.gender == gender) and (not region or p.region == region)]


def select_panel(size: int, pool: list[Persona] | None = None) -> list[Persona]:
    """A panel that looks like the country. The core four go first; then each step adds the persona who best fills the biggest gap between the
    panel and the population shares (gender, ethnic group, age group, region, from app/config/population_lk.json), with mindsets kept varied.
    Weighting then fixes what is left (see adtest_weights). Deterministic, so the same settings always give the same panel (and the cache works)."""
    import json
    from pathlib import Path

    pool = list(pool if pool is not None else BANK)
    if size >= len(pool):
        return sorted(pool, key=lambda p: p.id)
    cfg = json.loads((Path(__file__).resolve().parent.parent / "config" / "population_lk.json").read_text(encoding="utf-8"))
    dims = ("gender", "ethnic_group", "age_group", "region")
    share = {d: {k: v / sum(cfg[d].values()) for k, v in cfg[d].items()} for d in dims}
    minds = sorted({p.mindset for p in pool})
    chosen: list[Persona] = [p for p in pool if p.core][:size]
    left = [p for p in pool if p not in chosen]
    count: dict[tuple[str, str], int] = {}

    def add(p: Persona) -> None:
        for d in dims:
            count[(d, getattr(p, d))] = count.get((d, getattr(p, d)), 0) + 1
        count[("mind", p.mindset)] = count.get(("mind", p.mindset), 0) + 1

    for p in chosen:
        add(p)
    while len(chosen) < size and left:
        n = len(chosen) + 1

        def gap(p: Persona) -> float:
            g = sum(share[d].get(getattr(p, d), 0.0) * n - count.get((d, getattr(p, d)), 0) for d in dims)
            return g + 0.5 * (n / max(1, len(minds)) - count.get(("mind", p.mindset), 0))

        best = max(left, key=lambda p: (round(gap(p), 6), -int(p.id[1:])))
        chosen.append(best)
        left.remove(best)
        add(best)
    return sorted(chosen, key=lambda p: p.id)
