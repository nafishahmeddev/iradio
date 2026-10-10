"""Application defaults and country shortcuts."""

from pathlib import Path

API_SERVERS = (
    "https://de1.api.radio-browser.info",
    "https://nl1.api.radio-browser.info",
)
FAVORITES_PATH = Path.home() / ".haaki_radio_favorites.json"
PAGE_SIZE = 50

COUNTRIES = [
    ("India", "IN"),
    ("Pakistan", "PK"),
    ("Bangladesh", "BD"),
    ("Nepal", "NP"),
    ("Sri Lanka", "LK"),
    ("UAE", "AE"),
    ("Saudi Arabia", "SA"),
    ("Qatar", "QA"),
    ("USA", "US"),
    ("UK", "GB"),
    ("Canada", "CA"),
    ("Australia", "AU"),
    ("Germany", "DE"),
    ("France", "FR"),
    ("Italy", "IT"),
    ("Spain", "ES"),
    ("Netherlands", "NL"),
    ("Turkey", "TR"),
    ("Japan", "JP"),
    ("South Korea", "KR"),
    ("China", "CN"),
    ("Indonesia", "ID"),
    ("Malaysia", "MY"),
    ("Singapore", "SG"),
    ("Thailand", "TH"),
    ("Brazil", "BR"),
    ("Mexico", "MX"),
    ("South Africa", "ZA"),
    ("Egypt", "EG"),
    ("Nigeria", "NG"),
]
