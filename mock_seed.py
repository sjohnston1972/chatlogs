"""Generate removable mock data for the chatlogs dashboard demo.
Writes mock_chatlogs.sql (-> chat-logs) and mock_dashboard.sql (-> chatlogs-dashboard).
All rows use demo-*.test sites and 198.51.100.x IPs so they're easy to delete."""
import json
from datetime import datetime, timedelta

TODAY = datetime(2026, 6, 19, 12, 0, 0)


def iso(days_ago, hour=10):
    d = TODAY - timedelta(days=days_ago)
    d = d.replace(hour=hour % 24, minute=(hour * 7) % 60, second=0)
    return d.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def sqlstr(s):
    return "'" + s.replace("'", "''") + "'"


# site, ip, country, cc, city, days_ago, hour, reqs, intent, sentiment, lead, is_lead, bot_failed, cta, summary, messages
ROWS = [
    # demo-acme.test — busy / hot, strong leads
    ("demo-acme.test", "198.51.100.10", "United States", "US", "Austin", 0, 9, 6, "lead", "positive", 92, 1, 0, 1,
     "Enterprise buyer requested pricing and a demo for 200 seats; ready to purchase this quarter.",
     [("user", "Hi, we're a 200-person team evaluating your platform. What's enterprise pricing?"),
      ("assistant", "Happy to help! Enterprise starts at $40/seat/mo with volume discounts above 100 seats. Want me to set up a demo?"),
      ("user", "Yes please, we want to buy this quarter."),
      ("assistant", "Great — I'll have our team reach out today to schedule it.")]),
    ("demo-acme.test", "198.51.100.11", "United Kingdom", "GB", "London", 0, 14, 3, "pricing", "neutral", 64, 1, 0, 0,
     "Visitor compared Pro vs Enterprise tiers; leaning toward Pro, asked about annual billing.",
     [("user", "What's the difference between Pro and Enterprise?"),
      ("assistant", "Pro is $20/seat with core features; Enterprise adds SSO, audit logs, and SLA."),
      ("user", "Is annual billing cheaper?"),
      ("assistant", "Yes, annual saves about 17%.")]),
    ("demo-acme.test", "198.51.100.12", "Germany", "DE", "Berlin", 1, 11, 2, "booking", "positive", 78, 1, 0, 1,
     "Prospect booked a product demo for next Tuesday after asking about integrations.",
     [("user", "Do you integrate with Salesforce?"),
      ("assistant", "Yes, native two-way sync. Want to see it in a demo?"),
      ("user", "Sure, book me for next Tuesday."),
      ("assistant", "Done — calendar invite on the way.")]),
    ("demo-acme.test", "198.51.100.13", "United States", "US", "Denver", 2, 16, 4, "support", "frustrated", 20, 0, 1, 0,
     "Visitor repeatedly asked how to reset SSO; assistant could not resolve and did not escalate.",
     [("user", "How do I reset our SSO config? It's broken."),
      ("assistant", "You can find settings under Admin."),
      ("user", "That doesn't work, the page errors out."),
      ("assistant", "I'm not sure, please check the docs.")]),
    ("demo-acme.test", "198.51.100.14", "France", "FR", "Paris", 5, 13, 1, "smalltalk", "neutral", 8, 0, 0, 0,
     "Casual visitor asked what the company does; brief informational reply.",
     [("user", "What does Acme do?"),
      ("assistant", "We build collaboration software for teams.")]),
    ("demo-acme.test", "198.51.100.15", "United States", "US", "Seattle", 9, 10, 2, "complaint", "negative", 30, 0, 0, 0,
     "Existing user complained about slow dashboards; assistant apologized and logged feedback.",
     [("user", "Your dashboards have been really slow this week."),
      ("assistant", "Sorry about that — I've logged this for the team to investigate.")]),

    # demo-shop.test — medium activity
    ("demo-shop.test", "198.51.100.20", "Canada", "CA", "Toronto", 1, 15, 3, "pricing", "positive", 55, 1, 0, 1,
     "Shopper asked about bulk discount and shipping; added items toward checkout.",
     [("user", "Do you offer bulk discounts on orders over 50 units?"),
      ("assistant", "Yes! 15% off orders over 50 units, free shipping over $500."),
      ("user", "Perfect, adding to cart now.")]),
    ("demo-shop.test", "198.51.100.21", "Australia", "AU", "Sydney", 3, 12, 2, "support", "neutral", 22, 0, 0, 0,
     "Customer asked about return policy window; answered clearly.",
     [("user", "What's your return window?"),
      ("assistant", "30 days, unworn with tags. Refunds in 3-5 business days.")]),
    ("demo-shop.test", "198.51.100.22", "United States", "US", "Miami", 4, 18, 5, "complaint", "frustrated", 35, 0, 0, 0,
     "Customer angry about a delayed order; assistant provided tracking and a discount code.",
     [("user", "My order is 2 weeks late and no one has responded!"),
      ("assistant", "I'm sorry for the delay. Your order ships tomorrow; here's a 10% code for the trouble."),
      ("user", "Fine, but I'm not impressed.")]),
    ("demo-shop.test", "198.51.100.23", "United Kingdom", "GB", "Manchester", 7, 11, 1, "other", "positive", 14, 0, 0, 0,
     "Visitor asked about store opening hours.",
     [("user", "What time do you open Saturdays?"),
      ("assistant", "9am to 6pm on Saturdays.")]),
    ("demo-shop.test", "198.51.100.24", "Spain", "ES", "Madrid", 12, 17, 2, "booking", "positive", 48, 0, 1, 0,
     "Customer tried to book a fitting appointment; assistant failed to find a slot.",
     [("user", "Can I book a fitting this weekend?"),
      ("assistant", "Let me check... I can't access the calendar right now."),
      ("user", "Okay, never mind then.")]),

    # demo-clinic.test — quieter / cold
    ("demo-clinic.test", "198.51.100.30", "United States", "US", "Boston", 2, 9, 2, "booking", "positive", 70, 1, 0, 1,
     "New patient requested an appointment and asked if insurance is accepted.",
     [("user", "Do you accept BlueCross and can I book a checkup?"),
      ("assistant", "Yes we accept BlueCross. I can book you Thursday at 2pm — does that work?"),
      ("user", "Yes, book it please.")]),
    ("demo-clinic.test", "198.51.100.31", "United States", "US", "Chicago", 6, 14, 1, "support", "neutral", 18, 0, 0, 0,
     "Visitor asked for the clinic's address and parking info.",
     [("user", "Where are you located and is there parking?"),
      ("assistant", "123 Main St, free parking in the rear lot.")]),
    ("demo-clinic.test", "198.51.100.32", "United States", "US", "Phoenix", 10, 16, 3, "complaint", "negative", 28, 0, 0, 0,
     "Patient unhappy about wait times; assistant apologized and offered to flag it.",
     [("user", "I waited 90 minutes past my appointment last time."),
      ("assistant", "I'm sorry — I'll flag this with the office manager.")]),
    ("demo-clinic.test", "198.51.100.33", "United States", "US", "Portland", 13, 10, 1, "smalltalk", "neutral", 6, 0, 0, 0,
     "Visitor asked a general health question; assistant gave a generic pointer.",
     [("user", "Do you have tips for cold season?"),
      ("assistant", "Rest, fluids, and a flu shot help — see your provider for specifics.")]),
]

chat_sql = ["-- Mock chat_logs rows (demo-*.test). Remove with: DELETE FROM chat_logs WHERE site LIKE 'demo-%.test';"]
dash_sql = ["-- Mock analysis + geo. Remove with: DELETE FROM analysis WHERE site LIKE 'demo-%.test'; DELETE FROM geo WHERE ip LIKE '198.51.100.%';"]

for (site, ip, country, cc, city, days_ago, hour, reqs, intent, sentiment, lead, is_lead, bot_failed, cta, summary, msgs) in ROWS:
    updated = iso(days_ago, hour)
    created = iso(days_ago + reqs, hour)  # created earlier
    transcript = json.dumps({"messages": [{"role": r, "content": c} for (r, c) in msgs], "cta": bool(cta)})
    chat_sql.append(
        "INSERT OR REPLACE INTO chat_logs (site, ip, created_at, updated_at, request_count, transcript) VALUES ("
        f"{sqlstr(site)}, {sqlstr(ip)}, {sqlstr(created)}, {sqlstr(updated)}, {reqs}, {sqlstr(transcript)});"
    )
    topics = json.dumps([intent, "demo"])
    dash_sql.append(
        "INSERT OR REPLACE INTO analysis (site, ip, source_updated_at, summary, intent, sentiment, lead_score, is_lead, bot_failed, topics, model, analyzed_at) VALUES ("
        f"{sqlstr(site)}, {sqlstr(ip)}, {sqlstr(updated)}, {sqlstr(summary)}, {sqlstr(intent)}, {sqlstr(sentiment)}, {lead}, {is_lead}, {bot_failed}, {sqlstr(topics)}, 'mock', {sqlstr(updated)});"
    )
    dash_sql.append(
        "INSERT OR REPLACE INTO geo (ip, country, country_code, region, city, asn, org, looked_up_at) VALUES ("
        f"{sqlstr(ip)}, {sqlstr(country)}, {sqlstr(cc)}, {sqlstr(city)}, {sqlstr(city)}, 'AS64500', 'Demo ISP', {sqlstr(updated)});"
    )

with open("mock_chatlogs.sql", "w", encoding="utf-8") as f:
    f.write("\n".join(chat_sql) + "\n")
with open("mock_dashboard.sql", "w", encoding="utf-8") as f:
    f.write("\n".join(dash_sql) + "\n")

print(f"generated {len(ROWS)} mock conversations across 3 sites")
