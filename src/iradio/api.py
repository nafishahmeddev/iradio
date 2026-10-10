"""Radio Browser transport, with server failover."""

import json
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .config import API_SERVERS


class RadioAPI:
    def __init__(self, timeout=8):
        self.timeout = timeout

    def search(self, query, offset=0, limit=50):
        params = dict(query)
        params.update(
            codec="MP3",
            hidebroken="true",
            order="votes",
            reverse="true",
            limit=limit,
            offset=offset,
        )
        error = None
        for server in API_SERVERS:
            try:
                request = Request(
                    server + "/json/stations/search?" + urlencode(params),
                    headers={"User-Agent": "iRadio/0.1"},
                )
                with urlopen(request, timeout=self.timeout) as response:
                    data = json.load(response)
                if not isinstance(data, list):
                    raise ValueError("Unexpected station response")
                return [
                    s
                    for s in data
                    if isinstance(s, dict) and (s.get("url_resolved") or s.get("url"))
                ]
            except (OSError, ValueError) as exc:
                error = exc
        raise RuntimeError(f"Could not reach the station directory: {error}")
